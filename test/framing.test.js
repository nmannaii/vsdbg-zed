'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createParser, frame } = require('../src/framing');

const collect = () => {
  const seen = [];
  return { seen, feed: createParser((body) => seen.push(body)) };
};

test('parses a whole message in one chunk', () => {
  const { seen, feed } = collect();
  feed(Buffer.from(frame({ seq: 1, type: 'request', command: 'initialize' })));
  assert.deepStrictEqual(JSON.parse(seen[0]).command, 'initialize');
});

test('reassembles a message split across chunks', () => {
  const { seen, feed } = collect();
  const buf = Buffer.from(frame({ seq: 1, command: 'launch' }));
  for (let i = 0; i < buf.length; i++) feed(buf.subarray(i, i + 1));
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(JSON.parse(seen[0]).command, 'launch');
});

test('splits two messages arriving in one chunk', () => {
  const { seen, feed } = collect();
  feed(Buffer.from(frame({ seq: 1 }) + frame({ seq: 2 })));
  assert.deepStrictEqual(seen.map((s) => JSON.parse(s).seq), [1, 2]);
});

test('holds a partial body until the rest arrives', () => {
  const { seen, feed } = collect();
  const buf = Buffer.from(frame({ seq: 7, command: 'setBreakpoints' }));
  feed(buf.subarray(0, buf.length - 5));
  assert.strictEqual(seen.length, 0);
  feed(buf.subarray(buf.length - 5));
  assert.strictEqual(JSON.parse(seen[0]).seq, 7);
});

test('length is bytes, not characters', () => {
  const { seen, feed } = collect();
  // Emoji and accents make byte length exceed string length; a char-based
  // parser truncates here and desyncs the stream.
  const message = { seq: 1, body: { output: 'héllo 🌍 débogueur' } };
  feed(Buffer.from(frame(message)));
  assert.deepStrictEqual(JSON.parse(seen[0]), message);
});

test('a body containing \\r\\n\\r\\n is not treated as a header break', () => {
  const { seen, feed } = collect();
  const message = { seq: 1, body: { output: 'line\r\n\r\nnext' } };
  feed(Buffer.from(frame(message)));
  assert.deepStrictEqual(JSON.parse(seen[0]), message);
});

test('resyncs past a header with no Content-Length', () => {
  const { seen, feed } = collect();
  feed(Buffer.from('X-Nonsense: 1\r\n\r\n' + frame({ seq: 42 })));
  assert.strictEqual(JSON.parse(seen[0]).seq, 42);
});

test('frame round-trips through the parser', () => {
  const { seen, feed } = collect();
  const message = { type: 'response', seq: 0, command: 'handshake', body: { signature: 'abc+/=' } };
  feed(Buffer.from(frame(message)));
  assert.deepStrictEqual(JSON.parse(seen[0]), message);
});
