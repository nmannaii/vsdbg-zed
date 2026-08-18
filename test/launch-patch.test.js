'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { patchLaunch } = require('../src/proxy');

test('fills the keys vsdbg needs but Zed does not send', () => {
  const message = patchLaunch({
    type: 'request',
    command: 'launch',
    arguments: { program: '/app/bin/Debug/net8.0/Api.dll' },
  });
  assert.strictEqual(message.arguments.type, 'coreclr');
  assert.strictEqual(message.arguments.console, 'internalConsole');
  assert.strictEqual(message.arguments.justMyCode, true);
});

test('never overrides what the user set in debug.json', () => {
  const message = patchLaunch({
    type: 'request',
    command: 'launch',
    arguments: { program: 'x.dll', justMyCode: false, console: 'integratedTerminal' },
  });
  assert.strictEqual(message.arguments.justMyCode, false);
  assert.strictEqual(message.arguments.console, 'integratedTerminal');
});

test('leaves non-launch requests alone', () => {
  const message = patchLaunch({ type: 'request', command: 'attach', arguments: { processId: 9 } });
  assert.deepStrictEqual(message.arguments, { processId: 9 });
});

// The shape Zed actually delivers for a .zed/debug.json entry, plus the
// scenario-level keys Zed normally strips itself.
const zedEntryArgs = () => ({
  label: 'Service',
  adapter: 'netcoredbg',
  request: 'launch',
  program: '/w/group/Service/bin/Debug/net9.0/Service.dll',
  cwd: '/w/group/Service',
  env: { ASPNETCORE_ENVIRONMENT: 'Development' },
  build: {
    command: 'dotnet',
    args: ['build', '/w/group/Service/Service.csproj', '-p:Configuration=Debug'],
  },
});

test('drops the keys Zed owns and keeps the ones vsdbg needs', () => {
  const message = patchLaunch({ type: 'request', command: 'launch', arguments: zedEntryArgs() });
  const args = message.arguments;

  assert.strictEqual('label' in args, false);
  assert.strictEqual('adapter' in args, false);
  assert.strictEqual('build' in args, false);

  assert.strictEqual(args.request, 'launch');
  assert.strictEqual(args.program, '/w/group/Service/bin/Debug/net9.0/Service.dll');
  assert.strictEqual(args.cwd, '/w/group/Service');
});

test('drops tcp_connection too', () => {
  const message = patchLaunch({
    type: 'request',
    command: 'launch',
    arguments: { program: 'x.dll', tcp_connection: { port: 4711 } },
  });
  assert.strictEqual('tcp_connection' in message.arguments, false);
});

test('env reaches vsdbg untouched — redaction is log-only', () => {
  const message = patchLaunch({ type: 'request', command: 'launch', arguments: zedEntryArgs() });
  assert.deepStrictEqual(message.arguments.env, { ASPNETCORE_ENVIRONMENT: 'Development' });
});

test('a clean entry gains only the four defaults', () => {
  const message = patchLaunch({
    type: 'request',
    command: 'launch',
    arguments: { request: 'launch', program: 'Api.dll', cwd: '/w/src/Api' },
  });
  assert.deepStrictEqual(message.arguments, {
    request: 'launch',
    program: 'Api.dll',
    cwd: '/w/src/Api',
    type: 'coreclr',
    console: 'internalConsole',
    justMyCode: true,
    enableStepFiltering: true,
  });
});
