/**
 * @param {() => Promise<T>} fn
 * @param {{ retries?: number, delayMs?: number, factor?: number, onRetry?: (err: Error, attempt: number) => void }} opts
 * @returns {Promise<T>}
 */
async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  const factor = opts.factor ?? 1.5;
  const noRetryCodes = Array.isArray(opts.noRetryCodes) ? opts.noRetryCodes : [];
  let lastErr;
  let wait = delayMs;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err && err.code && noRetryCodes.includes(err.code)) {
        throw err;
      }
      if (attempt === retries) break;
      if (typeof opts.onRetry === 'function') {
        opts.onRetry(err, attempt);
      }
      await sleep(wait);
      wait = Math.round(wait * factor);
    }
  }

  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { withRetry, sleep };
