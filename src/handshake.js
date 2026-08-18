'use strict';

const config = require('./config');

let signer = null;

// vsda is a native addon; load it once and keep the signer, rather than
// spawning a node process per handshake the way vscode-signer.js does.
function getSigner() {
  if (!signer) {
    const vsda = require(config.vsdaPath);
    signer = new vsda.signer();
  }
  return signer;
}

function sign(value) {
  return getSigner().sign(value);
}

// vsdbg-ui will not proceed until it gets this back. Shape mirrors the
// nvim-dap handler that is known to work (lua/plugins/dap.lua RunHandshake),
// including seq: 0 — vsdbg matches on request_seq, not seq.
function buildResponse(request) {
  const base = {
    type: 'response',
    seq: 0,
    command: 'handshake',
    request_seq: request.seq,
  };

  try {
    const value = request.arguments && request.arguments.value;
    if (typeof value !== 'string') {
      throw new Error('handshake request has no arguments.value');
    }
    return { ...base, success: true, body: { signature: sign(value) } };
  } catch (err) {
    // Fail loudly instead of hanging: vsdbg exits and the log has the reason.
    return { ...base, success: false, message: `vsdbg-zed: ${err.message}` };
  }
}

module.exports = { sign, buildResponse };
