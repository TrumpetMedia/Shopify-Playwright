/**
 * Visible browser for local debugging when HEADFUL_RUN=1|true|yes.
 * Omit or set HEADFUL_RUN=0 for headless (e.g. VPS cron).
 */
function browserHeadless() {
  const v = String(process.env.HEADFUL_RUN || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') {
    return false;
  }
  return true;
}

module.exports = { browserHeadless };
