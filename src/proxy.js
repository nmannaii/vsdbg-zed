'use strict';

const { spawn } = require('child_process');

const config = require('./config');
const log = require('./log');
const { createParser, frame } = require('./framing');
const { buildResponse } = require('./handshake');

// Zed sends a netcoredbg-shaped launch config; vsdbg needs a few extra keys.
// Only fills gaps — anything the user set in .zed/debug.json wins.
const LAUNCH_DEFAULTS = {
  type: 'coreclr',
  console: 'internalConsole',
  justMyCode: true,
  enableStepFiltering: true,
};

// Zed consumes these as debug-scenario fields, so they should never arrive in
// launch arguments. Dropped defensively in case a future Zed forwards them.
// `request` stays: VS Code sends it to vsdbg too, so keeping it matches the
// known-good payload.
const ZED_ONLY_KEYS = ['label', 'adapter', 'build', 'tcp_connection'];

function patchLaunch(message) {
  if (config.noPatch) return message;
  if (message.type !== 'request' || message.command !== 'launch') return message;

  const args = message.arguments || (message.arguments = {});

  const dropped = [];
  for (const key of ZED_ONLY_KEYS) {
    if (key in args) {
      delete args[key];
      dropped.push(key);
    }
  }
  if (dropped.length) log.note(`launch keys dropped: ${dropped.join(', ')}`);

  const added = [];
  for (const [key, value] of Object.entries(LAUNCH_DEFAULTS)) {
    if (args[key] === undefined) {
      args[key] = value;
      added.push(key);
    }
  }
  if (added.length) log.note(`launch defaults added: ${added.join(', ')}`);
  return message;
}

// vsdbg only answers to its own adapter id. Zed derives adapterID from the
// adapter name it is hijacking ("netcoredbg"), which vsdbg rejects outright with
// "Error processing 'initialize' request". Unlike LAUNCH_DEFAULTS this is an
// override: Zed always sends a value, and it is always the wrong one.
const VSDBG_ADAPTER_ID = 'coreclr';

function patchInitialize(message) {
  if (config.noPatch) return message;
  if (message.type !== 'request' || message.command !== 'initialize') return message;

  const args = message.arguments || (message.arguments = {});
  if (args.adapterID !== VSDBG_ADAPTER_ID) {
    log.note(`initialize adapterID rewritten: ${args.adapterID} -> ${VSDBG_ADAPTER_ID}`);
    args.adapterID = VSDBG_ADAPTER_ID;
  }
  return message;
}

// The log is a plaintext file that never rotates; env values can be secrets.
// Redacts for logging only — the wire payload is untouched, so this must never
// mutate the message that is about to be framed.
function redactForLog(message) {
  if (config.logEnv) return message;
  if (!message || typeof message !== 'object') return message;

  const args = message.arguments;
  if (!args || typeof args !== 'object') return message;
  if (!args.env || typeof args.env !== 'object' || Array.isArray(args.env)) return message;

  const env = {};
  for (const key of Object.keys(args.env)) env[key] = '<redacted>';
  return { ...message, arguments: { ...args, env } };
}

const patchClient = (message) => patchInitialize(patchLaunch(message));

function run() {
  log.note(`spawning ${config.vsdbgPath} ${config.vsdbgArgs.join(' ')}`);

  const child = spawn(config.vsdbgPath, config.vsdbgArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  let shuttingDown = false;

  const ignoreEpipe = (stream, label) =>
    stream.on('error', (err) => {
      if (err.code === 'EPIPE') return;
      log.note(`${label} error: ${err.message}`);
    });

  ignoreEpipe(child.stdin, 'vsdbg stdin');
  ignoreEpipe(process.stdout, 'client stdout');

  const forLog = (message) =>
    typeof message === 'string' ? message : JSON.stringify(redactForLog(message));

  const toAdapter = (message) => {
    const text = frame(message);
    log.toAdapter(forLog(message));
    child.stdin.write(text);
  };

  const toClient = (message) => {
    const text = frame(message);
    log.toClient(forLog(message));
    process.stdout.write(text);
  };

  // Zed -> vsdbg
  const clientParser = createParser((body) => {
    let message;
    try {
      message = JSON.parse(body);
    } catch (err) {
      log.note(`unparseable client message: ${err.message}`);
      child.stdin.write(frame(body));
      return;
    }
    toAdapter(patchClient(message));
  });

  // vsdbg -> Zed
  const adapterParser = createParser((body) => {
    let message;
    try {
      message = JSON.parse(body);
    } catch (err) {
      log.note(`unparseable adapter message: ${err.message}`);
      process.stdout.write(frame(body));
      return;
    }

    // The whole reason this proxy exists: Zed has no reverse-request hook, so
    // the handshake is answered here and never reaches the editor.
    if (message.type === 'request' && message.command === 'handshake') {
      log.note(`handshake request seq=${message.seq} — signing locally`);
      const response = buildResponse(message);
      log.note(`handshake response success=${response.success}`);
      toAdapter(response);
      return;
    }

    // runInTerminal and everything else are Zed's job.
    toClient(message);
  });

  process.stdin.on('data', clientParser);
  child.stdout.on('data', adapterParser);

  child.stderr.on('data', (chunk) => log.stderr(chunk.toString('utf8')));

  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.note(`exiting with code ${code}`);
    log.close(() => process.exit(code));
  };

  child.on('error', (err) => {
    log.note(`failed to spawn vsdbg: ${err.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    log.note(`vsdbg exited code=${code} signal=${signal}`);
    shutdown(code === null ? 1 : code);
  });

  process.stdin.on('end', () => {
    log.note('client closed stdin — terminating vsdbg');
    child.kill();
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
}

module.exports = {
  run,
  patchLaunch,
  patchInitialize,
  redactForLog,
  LAUNCH_DEFAULTS,
  ZED_ONLY_KEYS,
  VSDBG_ADAPTER_ID,
};
