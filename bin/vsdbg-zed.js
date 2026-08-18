#!/usr/bin/env node
'use strict';

const command = process.argv[2];

if (command === 'doctor') {
  require('../src/doctor').run();
} else if (command === '--help' || command === '-h') {
  // Help goes to stderr: stdout belongs to the DAP stream.
  process.stderr.write(
    [
      'vsdbg-zed — DAP proxy that answers vsdbg-ui\'s handshake reverse request.',
      '',
      'Usage:',
      '  vsdbg-zed           run as a debug adapter (stdio); this is what Zed invokes',
      '  vsdbg-zed doctor    verify vsda/vsdbg wiring and the handshake end to end',
      '',
      'Env: VSDA_PATH, VSDBG_PATH, VSDBG_ZED_LOG, VSDBG_ZED_LOG_ENV, VSDBG_ZED_NO_PATCH',
      '',
    ].join('\n')
  );
} else {
  require('../src/proxy').run();
}
