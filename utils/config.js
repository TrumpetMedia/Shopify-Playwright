const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getProfileDir() {
  const p = process.env.PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'main');
  return path.resolve(p);
}

function getStoresPath() {
  return path.resolve(process.env.STORES_PATH || path.join(__dirname, '..', 'stores', 'stores.json'));
}

module.exports = {
  getProfileDir,
  getStoresPath,
  spreadsheetId: process.env.SPREADSHEET_ID || '',
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  sheetDateTz: process.env.SHEET_DATE_TZ || process.env.TZ || '',
  defaultSheetTab: process.env.DEFAULT_SHEET_TAB || 'Sheet1',
  dateColumn: (process.env.DATE_COLUMN || 'A').toUpperCase(),
  colSessions: (process.env.COL_SESSIONS || 'K').toUpperCase(),
  colAddToCart: (process.env.COL_ADD_TO_CART || 'L').toUpperCase(),
  colReachedCheckout: (process.env.COL_REACHED_CHECKOUT || 'M').toUpperCase(),
  targetDate: process.env.TARGET_DATE || null,
  scrapeRetries: Number(process.env.SCRAPE_RETRIES || 3),
  postLoadDelayMs: Number(process.env.POST_LOAD_DELAY_MS || 2500),
  navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || 120000),
  /** Do not fetch entire column A:A (huge sheets hang). Scan first N rows for the date. */
  sheetDateMaxRows: Number(process.env.SHEET_DATE_MAX_ROWS || 8000),
  sheetsApiTimeoutMs: Number(process.env.SHEETS_API_TIMEOUT_MS || 120000),
};
