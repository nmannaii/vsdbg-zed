'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { patchInitialize, VSDBG_ADAPTER_ID } = require('../src/proxy');

// What Zed actually sends. adapterID comes from the adapter name it is
// hijacking, and vsdbg rejects anything but its own id.
const zedInitializeArgs = () => ({
  clientID: 'zed',
  clientName: 'Zed',
  adapterID: 'netcoredbg',
  locale: 'en-US',
  linesStartAt1: true,
  columnsStartAt1: true,
  pathFormat: 'path',
  supportsRunInTerminalRequest: true,
  supportsStartDebuggingRequest: true,
  supportsANSIStyling: true,
});

test('rewrites the adapterID Zed derives from the hijacked adapter name', () => {
  const message = patchInitialize({
    type: 'request',
    command: 'initialize',
    arguments: zedInitializeArgs(),
  });
  assert.strictEqual(message.arguments.adapterID, 'coreclr');
  assert.strictEqual(VSDBG_ADAPTER_ID, 'coreclr');
});

test('leaves a correct adapterID alone', () => {
  const message = patchInitialize({
    type: 'request',
    command: 'initialize',
    arguments: { adapterID: 'coreclr' },
  });
  assert.strictEqual(message.arguments.adapterID, 'coreclr');
});

test('keeps every other capability flag Zed advertises', () => {
  const message = patchInitialize({
    type: 'request',
    command: 'initialize',
    arguments: zedInitializeArgs(),
  });
  const args = message.arguments;
  assert.strictEqual(args.clientID, 'zed');
  assert.strictEqual(args.supportsRunInTerminalRequest, true);
  assert.strictEqual(args.supportsStartDebuggingRequest, true);
  assert.strictEqual(args.supportsANSIStyling, true);
  assert.strictEqual(args.pathFormat, 'path');
});

test('supplies arguments when the request has none', () => {
  const message = patchInitialize({ type: 'request', command: 'initialize' });
  assert.deepStrictEqual(message.arguments, { adapterID: 'coreclr' });
});

test('leaves non-initialize requests alone', () => {
  const launch = patchInitialize({
    type: 'request',
    command: 'launch',
    arguments: { adapterID: 'netcoredbg', program: 'x.dll' },
  });
  assert.strictEqual(launch.arguments.adapterID, 'netcoredbg');

  const attach = patchInitialize({ type: 'request', command: 'attach', arguments: { processId: 9 } });
  assert.deepStrictEqual(attach.arguments, { processId: 9 });
});

test('leaves initialize responses alone', () => {
  const response = patchInitialize({
    type: 'response',
    command: 'initialize',
    arguments: { adapterID: 'netcoredbg' },
  });
  assert.strictEqual(response.arguments.adapterID, 'netcoredbg');
});
