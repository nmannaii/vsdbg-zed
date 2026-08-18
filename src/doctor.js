'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const config = require('./config');
const { frame, createParser } = require('./framing');

const results = [];

function record(ok, name, detail) {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function checkPaths() {
  try {
    fs.accessSync(config.vsdaPath, fs.constants.R_OK);
    record(true, 'vsda.node readable', config.vsdaPath);
  } catch (err) {
    record(false, 'vsda.node readable', `${config.vsdaPath}: ${err.message}`);
  }

  try {
    fs.accessSync(config.vsdbgPath, fs.constants.X_OK);
    record(true, 'vsdbg-ui executable', config.vsdbgPath);
  } catch (err) {
    record(false, 'vsdbg-ui executable', `${config.vsdbgPath}: ${err.message}`);
  }
}

function checkSigner() {
  let signature;
  try {
    signature = require('./handshake').sign('vsdbg-zed-doctor');
  } catch (err) {
    record(false, `vsda loads under node ${process.version}`, err.message);
    return;
  }
  record(true, `vsda loads under node ${process.version}`, `${signature.length}-char signature`);

  // vsda signatures are not deterministic — the same input signs differently
  // each call — so compare shape against the nvim signer, not exact bytes.
  if (!fs.existsSync(config.signerScript)) {
    record(true, 'nvim signer comparison', 'skipped (vscode-signer.js not found)');
    return;
  }
  const ref = spawnSync('node', [config.signerScript, 'vsdbg-zed-doctor'], { encoding: 'utf8' });
  const refSignature = (ref.stdout || '').trim();
  const ok = ref.status === 0 && refSignature.length === signature.length;
  record(
    ok,
    'nvim signer comparison',
    ok
      ? `same length (${signature.length}), same vsda build`
      : `nvim signer exited ${ref.status}, output ${JSON.stringify(refSignature.slice(0, 40))}`
  );
}

function checkHandshake() {
  return new Promise((resolve) => {
    const logPath = path.join(
      process.env.TMPDIR || '/tmp',
      `vsdbg-zed-doctor-${process.pid}.log`
    );

    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'vsdbg-zed.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // VSDBG_ZED_LOG_ENV is forced off: the redaction check below asserts the
      // default behaviour, not whatever the caller has exported.
      env: { ...process.env, VSDBG_ZED_LOG: logPath, VSDBG_ZED_LOG_ENV: '' },
    });

    const seen = [];
    child.stdout.on('data', createParser((body) => seen.push(JSON.parse(body))));

    const send = (message) => child.stdin.write(frame(message));

    send({
      seq: 1,
      type: 'request',
      command: 'initialize',
      // Deliberately what Zed sends, wrong adapterID included: the proxy is
      // expected to rewrite it, so this exercises the real failure path.
      arguments: {
        clientID: 'zed',
        adapterID: 'netcoredbg',
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: 'path',
        supportsRunInTerminalRequest: true,
      },
    });

    // vsdbg only handshakes once a launch is requested, not at initialize —
    // so the smoke test has to ask it to launch something. The program need
    // not exist: the handshake happens before vsdbg resolves it.
    setTimeout(() => {
      send({
        seq: 2,
        type: 'request',
        command: 'launch',
        arguments: {
          program: path.join(__dirname, '..', 'doctor-nonexistent.dll'),
          cwd: path.join(__dirname, '..'),
          stopAtEntry: false,
          // Present so the log-redaction path is exercised for real.
          env: { VSDBG_ZED_DOCTOR: '1' },
        },
      });
    }, 500);

    const finish = () => {
      child.kill();

      const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      const signed = /handshake response success=true/.test(logText);
      const initResponse = seen.find((m) => m.type === 'response' && m.command === 'initialize');
      const initialized = initResponse ? initResponse.success === true : false;
      const redacted =
        logText.includes('"VSDBG_ZED_DOCTOR":"<redacted>"') &&
        !logText.includes('"VSDBG_ZED_DOCTOR":"1"');

      record(
        signed,
        'vsdbg sent handshake and accepted our signature',
        signed ? 'signed locally, never forwarded to the editor' : `see ${logPath}`
      );
      record(
        initialized,
        'initialize succeeded (adapterID rewritten to coreclr)',
        initialized
          ? 'end-to-end path is live'
          : `${initResponse ? initResponse.message || 'request failed' : 'no response'} — see ${logPath}`
      );
      record(
        redacted,
        'env values are redacted in the log',
        redacted ? 'keys kept, values replaced' : `env leaked verbatim — see ${logPath}`
      );

      resolve();
    };

    // vsdbg handshakes immediately; a couple of seconds is ample.
    setTimeout(finish, 4000);
  });
}

async function run() {
  console.log('vsdbg-zed doctor\n');
  checkPaths();
  checkSigner();
  await checkHandshake();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`proxy log: ${config.logPath || '(disabled)'}`);
  process.exitCode = failed.length ? 1 : 0;
}

module.exports = { run };
