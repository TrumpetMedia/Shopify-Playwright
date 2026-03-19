/**
 * One-time: convert Shopify scraper stores.json → Playwright stores/stores.json
 * Run: node scripts/migrate-stores-from-legacy.js
 *
 * Google Sheets writes use the same fixed row-1 headers as the old scraper (code — not JSON).
 */
const fs = require('fs');
const path = require('path');

const legacyPath = path.resolve(__dirname, '../../Shopify scraper/stores.json');
const outPath = path.resolve(__dirname, '../stores/stores.json');

if (!fs.existsSync(legacyPath)) {
  console.error('Legacy file not found:', legacyPath);
  process.exit(1);
}

const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
const out = legacy.map((s) => ({
  name: s.storeName,
  scrapeMode: 'legacy_shopify_table',
  reportUrl: s.reportUrl,
  spreadsheetId: s.spreadsheetId,
  sheetTab: s.sheetName,
}));

fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('Wrote', out.length, 'stores to', outPath);
