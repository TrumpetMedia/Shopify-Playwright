const fs = require('fs');
const path = require('path');

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    // EPERM: no permission to signal — assume process may still exist
    return true;
  }
}

/**
 * Remove lock file if it is orphaned (crashed / killed Node, closed terminal mid-login).
 */
function removeStaleProfileLock(lockPath) {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const data = JSON.parse(raw);
    const pid = typeof data.pid === 'number' ? data.pid : parseInt(String(data.pid), 10);
    if (!isPidAlive(pid)) {
      fs.unlinkSync(lockPath);
      return true;
    }
  } catch {
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Prevents two scraper processes from using the same profile simultaneously.
 */
function acquireProfileLock(profileDir) {
  const lockPath = path.join(profileDir, '.scraper.lock');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
      fs.writeSync(fd, payload, 0, 'utf8');
      fs.closeSync(fd);
      return lockPath;
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        const cleared = removeStaleProfileLock(lockPath);
        if (cleared) {
          continue;
        }
        const err = new Error(
          `Profile lock exists at ${lockPath}. Another run is using this profile (or delete the lock if the other process already exited).`
        );
        err.code = 'PROFILE_LOCKED';
        throw err;
      }
      throw e;
    }
  }

  const err = new Error(`Could not acquire profile lock at ${lockPath}.`);
  err.code = 'PROFILE_LOCKED';
  throw err;
}

function releaseProfileLock(lockPath) {
  try {
    if (lockPath && fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // ignore
  }
}

module.exports = { acquireProfileLock, releaseProfileLock, removeStaleProfileLock };
