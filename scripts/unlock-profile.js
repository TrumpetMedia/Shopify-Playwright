/**
 * Remove stale .scraper.lock under profiles/main (use if login/run crashed).
 */
const path = require('path');
const { getProfileDir } = require('../utils/config');
const { removeStaleProfileLock } = require('../utils/lock');

const lockPath = path.join(getProfileDir(), '.scraper.lock');
const removed = removeStaleProfileLock(lockPath);
if (removed) {
  console.log('Removed lock:', lockPath);
} else if (!require('fs').existsSync(lockPath)) {
  console.log('No lock file at', lockPath);
} else {
  console.log('Lock still held by a running process — close the other terminal/browser run first, or stop that Node process.');
  process.exit(1);
}
