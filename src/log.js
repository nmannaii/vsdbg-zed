'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./config');

let stream = null;

if (config.logPath) {
  try {
    fs.mkdirSync(path.dirname(config.logPath), { recursive: true });
    stream = fs.createWriteStream(config.logPath, { flags: 'a' });
    // A broken log must never take the proxy down with it.
    stream.on('error', () => {
      stream = null;
    });
  } catch {
    stream = null;
  }
}

// stdout carries the DAP stream — anything written there outside frame()
// corrupts the protocol. Every diagnostic goes to the log file instead.
function write(tag, text) {
  if (!stream) return;
  stream.write(`[${new Date().toISOString()}] ${tag} ${text}\n`);
}

module.exports = {
  toAdapter: (text) => write('-->', text),
  toClient: (text) => write('<--', text),
  note: (text) => write('!!', text),
  stderr: (text) => write('err', text.replace(/\s+$/, '')),
  path: config.logPath,
  close: (cb) => (stream ? stream.end(cb) : cb()),
};
