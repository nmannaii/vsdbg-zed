'use strict';

const SEPARATOR = Buffer.from('\r\n\r\n');
const CONTENT_LENGTH = /Content-Length:\s*(\d+)/i;

// DAP frames are `Content-Length: N\r\n\r\n<N bytes of JSON>`. Bodies contain
// newlines and stream chunks split anywhere, so this has to be byte-driven
// rather than line-driven.
function createParser(onMessage) {
  let buf = Buffer.alloc(0);

  return function feed(chunk) {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);

    for (;;) {
      const headerEnd = buf.indexOf(SEPARATOR);
      if (headerEnd === -1) return;

      const match = CONTENT_LENGTH.exec(buf.subarray(0, headerEnd).toString('ascii'));
      if (!match) {
        // Desynced: skip the bad header and resync on the next separator.
        buf = buf.subarray(headerEnd + SEPARATOR.length);
        continue;
      }

      const length = Number(match[1]);
      const start = headerEnd + SEPARATOR.length;
      if (buf.length < start + length) return;

      const body = buf.subarray(start, start + length).toString('utf8');
      buf = buf.subarray(start + length);
      onMessage(body);
    }
  };
}

function frame(message) {
  const json = typeof message === 'string' ? message : JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

module.exports = { createParser, frame };
