const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { normalizeSheetDate } = require('../utils/dateTarget');
const {
  sheetDateMaxRows,
  sheetsApiTimeoutMs,
} = require('../utils/config');

/** gaxios / googleapis: timeout is the 2nd argument, NOT part of the API request body. */
function gaxiosOpts() {
  return { timeout: sheetsApiTimeoutMs };
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** Row 1 header titles — same as legacy `Shopify scraper/index.js` writeToSheet(). */
const LEGACY_SCRAPER_HEADER_MAP = {
  sessions: 'Visits',
  addToCart: 'Add To Cart',
  reachedCheckout: 'Reached checkout',
};

/**
 * 0-based column index → A, B, …, Z, AA, …
 */
function columnIndexToLetter(index) {
  let result = '';
  let n = index + 1;
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Service account JSON, or OAuth desktop credentials + token (legacy Shopify scraper).
 */
async function getSheetsClient() {
  const root = path.join(__dirname, '..');
  const saPath =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    '';

  if (saPath && fs.existsSync(path.resolve(saPath))) {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(saPath),
      scopes: SCOPES,
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
  }

  const credPath = path.resolve(process.env.GOOGLE_OAUTH_CREDENTIALS || path.join(root, 'credentials.json'));
  const tokenPath = path.resolve(process.env.GOOGLE_OAUTH_TOKEN || path.join(root, 'token.json'));

  if (!fs.existsSync(credPath)) {
    throw new Error(
      'No Google auth: add service account JSON (GOOGLE_SERVICE_ACCOUNT_JSON) or OAuth credentials.json + token.json from the legacy project.'
    );
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`OAuth token missing: ${tokenPath}. Copy token.json from the legacy scraper or re-authorize.`);
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  if (!credentials.installed) {
    throw new Error('credentials.json must be "Desktop app" OAuth client (installed) like the legacy scraper.');
  }
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));

  return google.sheets({ version: 'v4', auth: oAuth2Client });
}

/**
 * Find 1-based row index where date column matches targetDate (YYYY-MM-DD).
 */
async function findRowByDate(sheets, spreadsheetId, sheetTab, dateColumnLetter, targetDateIso) {
  // Full-column A:A on large sheets can stall the run for minutes. Scan a bounded range only.
  const col = dateColumnLetter.toUpperCase();
  const range = `'${escapeSheetTitle(sheetTab)}'!${col}1:${col}${sheetDateMaxRows}`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range }, gaxiosOpts());
  const values = res.data.values || [];
  for (let i = 0; i < values.length; i++) {
    const cell = values[i][0];
    const normalized = normalizeSheetDate(cell);
    if (normalized === targetDateIso) {
      return i + 1;
    }
  }
  return null;
}

function escapeSheetTitle(title) {
  return String(title).replace(/'/g, "''");
}

/**
 * Map metrics to column letters using row 1 headers (legacy scraper behavior).
 * @param {import('googleapis').sheets_v4.Sheets} sheets
 * @param {Record<string, string>} headerMapping — e.g. { sessions: 'Visits', addToCart: 'Add To Cart', reachedCheckout: 'Reached checkout' }
 */
async function resolveMetricColumnsFromHeaders(sheets, spreadsheetId, sheetTab, headerMapping) {
  const range = `'${escapeSheetTitle(sheetTab)}'!1:1`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range }, gaxiosOpts());
  const headers = res.data.values?.[0];
  if (!headers || !headers.length) {
    throw new Error(`No header row in tab "${sheetTab}"`);
  }

  const trimmed = headers.map((h) => (h == null ? '' : String(h).trim()));

  const out = {};
  for (const [metricKey, headerName] of Object.entries(headerMapping)) {
    const idx = trimmed.indexOf(headerName);
    if (idx === -1) {
      throw new Error(`Header "${headerName}" not found in row 1 of "${sheetTab}" (available: ${trimmed.slice(0, 15).join(', ')}…)`);
    }
    out[metricKey] = columnIndexToLetter(idx);
  }
  return out;
}

/**
 * Resolve write columns from tab row 1 using the fixed legacy scraper header names.
 */
async function resolveLegacyScraperColumns(sheets, spreadsheetId, sheetTab) {
  return resolveMetricColumnsFromHeaders(sheets, spreadsheetId, sheetTab, LEGACY_SCRAPER_HEADER_MAP);
}

/**
 * Update only existing row K,L,M (or custom columns). Does not append rows.
 */
async function updateMetricsRow(sheets, spreadsheetId, sheetTab, rowNumber, metrics, columns) {
  const tab = escapeSheetTitle(sheetTab);
  const ordered = [
    { col: columns.sessions, val: metrics.sessions },
    { col: columns.addToCart, val: metrics.addToCart },
    { col: columns.reachedCheckout, val: metrics.reachedCheckout },
  ];

  const data = ordered.map((o) => ({
    range: `'${tab}'!${o.col}${rowNumber}`,
    values: [[o.val]],
  }));

  await sheets.spreadsheets.values.batchUpdate(
    {
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    },
    gaxiosOpts()
  );
}

module.exports = {
  getSheetsClient,
  findRowByDate,
  updateMetricsRow,
  resolveMetricColumnsFromHeaders,
  resolveLegacyScraperColumns,
  LEGACY_SCRAPER_HEADER_MAP,
  columnIndexToLetter,
};
