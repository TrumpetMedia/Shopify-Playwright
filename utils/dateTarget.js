const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Target date for sheet matching (YYYY-MM-DD).
 * Prefer SHEET_DATE_TZ or TZ (e.g. Asia/Kolkata) for "yesterday" to match legacy scraper.
 */
function getTargetDateIso(explicit) {
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
    return explicit;
  }
  const tzName = process.env.SHEET_DATE_TZ || process.env.TZ;
  if (tzName) {
    return dayjs().tz(tzName).subtract(1, 'day').format('YYYY-MM-DD');
  }
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalize a cell value from Sheets to YYYY-MM-DD when possible.
 * @param {string|number|undefined} cell
 */
function normalizeSheetDate(cell) {
  if (cell == null || cell === '') return null;
  const s = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Serial date (Google Sheets)
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = epoch.getTime() + Math.round(cell * 86400000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

module.exports = { getTargetDateIso, normalizeSheetDate };
