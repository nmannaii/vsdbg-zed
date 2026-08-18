'use strict';

const os = require('os');
const path = require('path');

const DEFAULT_VSDA =
  '/usr/share/code/resources/app/node_modules.asar.unpacked/vsda/build/Release/vsda.node';

const DEFAULT_VSDBG = path.join(
  os.homedir(),
  '.vscode/extensions/ms-dotnettools.csharp-2.110.4-linux-x64/.debugger/vsdbg-ui'
);

const DEFAULT_LOG = path.join(os.homedir(), '.cache/vsdbg-zed/shim.log');

// An env var that is set but empty means "explicitly off", so `??` is wrong here.
function envOr(name, fallback) {
  return process.env[name] !== undefined ? process.env[name] : fallback;
}

module.exports = {
  vsdaPath: envOr('VSDA_PATH', DEFAULT_VSDA),
  vsdbgPath: envOr('VSDBG_PATH', DEFAULT_VSDBG),
  vsdbgArgs: ['--interpreter=vscode'],
  // Empty string disables logging.
  logPath: envOr('VSDBG_ZED_LOG', DEFAULT_LOG),
  // Escape hatch: forward the launch request exactly as Zed sent it.
  noPatch: envOr('VSDBG_ZED_NO_PATCH', '') !== '',
  // Escape hatch: log env values verbatim when debugging a launch config.
  logEnv: envOr('VSDBG_ZED_LOG_ENV', '') !== '',
  signerScript: path.join(os.homedir(), '.config/nvim/vscode-signer.js'),
};
