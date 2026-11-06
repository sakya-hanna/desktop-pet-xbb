'use strict';
// Portable, dependency-free test entry. Does not run Electron/Python scripts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.test.js')).sort()
  .map(name => path.join(root, 'tests', name));
if (!files.length) throw new Error('No Node test files found');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xbb-tests-'));
try {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
