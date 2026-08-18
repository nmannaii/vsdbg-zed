'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { redactForLog } = require('../src/proxy');

const launch = (env) => ({
  seq: 2,
  type: 'request',
  command: 'launch',
  arguments: { program: 'Api.dll', env },
});

test('keeps env keys and replaces every value', () => {
  const redacted = redactForLog(launch({ ASPNETCORE_ENVIRONMENT: 'Development', DB: 'secret' }));
  assert.deepStrictEqual(redacted.arguments.env, {
    ASPNETCORE_ENVIRONMENT: '<redacted>',
    DB: '<redacted>',
  });
});

test('leaves the rest of the message intact', () => {
  const redacted = redactForLog(launch({ DB: 'secret' }));
  assert.strictEqual(redacted.command, 'launch');
  assert.strictEqual(redacted.seq, 2);
  assert.strictEqual(redacted.arguments.program, 'Api.dll');
});

test('never mutates the message that goes on the wire', () => {
  const message = launch({ DB: 'secret' });
  redactForLog(message);
  assert.strictEqual(message.arguments.env.DB, 'secret');
});

test('passes through messages with nothing to redact', () => {
  const noArgs = { type: 'request', command: 'configurationDone' };
  assert.strictEqual(redactForLog(noArgs), noArgs);

  const noEnv = { type: 'request', command: 'launch', arguments: { program: 'x.dll' } };
  assert.strictEqual(redactForLog(noEnv), noEnv);

  const arrayEnv = { type: 'request', command: 'launch', arguments: { env: ['A=1'] } };
  assert.strictEqual(redactForLog(arrayEnv), arrayEnv);

  const nullEnv = { type: 'request', command: 'launch', arguments: { env: null } };
  assert.strictEqual(redactForLog(nullEnv), nullEnv);
});

test('an empty env object stays an empty object', () => {
  assert.deepStrictEqual(redactForLog(launch({})).arguments.env, {});
});
