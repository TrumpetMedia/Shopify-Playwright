/**
 * Force visible Chrome/Chromium for `npm run run` (overrides .env if unset).
 */
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const r = spawnSync(process.execPath, [path.join(root, 'index.js'), 'run'], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, HEADFUL_RUN: '1' },
});
process.exit(r.status === null ? 1 : r.status);
