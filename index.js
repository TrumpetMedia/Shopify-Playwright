const fs = require('fs');
const readline = require('readline');

const { launchPersistentContext } = require('./services/browser');
const {
  scrapeLegacyShopifyAnalyticsTable,
  scrapeSingleMetric,
  scrapeMetricFromTableRow,
} = require('./services/scraper');
const {
  getSheetsClient,
  findRowByDate,
  updateMetricsRow,
  resolveLegacyScraperColumns,
} = require('./services/sheets');
const {
  getProfileDir,
  getStoresPath,
  spreadsheetId,
  defaultSheetTab,
  dateColumn,
  colSessions,
  colAddToCart,
  colReachedCheckout,
  targetDate: envTargetDate,
  scrapeRetries,
  postLoadDelayMs,
  navigationTimeoutMs,
  sheetDateTz,
  sheetDateMaxRows,
} = require('./utils/config');
const { getTargetDateIso } = require('./utils/dateTarget');
const { logger } = require('./utils/logger');
const { acquireProfileLock, releaseProfileLock } = require('./utils/lock');
const { withRetry } = require('./utils/retry');
const { assertNotLoggedOut } = require('./utils/loginDetection');
const { browserHeadless } = require('./utils/browserHeadless');
const { sendRunReportEmailIfEnabled } = require('./services/emailReport');

const START_URL = process.env.LOGIN_START_URL || 'https://admin.shopify.com/store';

function loadStores() {
  const p = getStoresPath();
  if (!fs.existsSync(p)) {
    throw new Error(`Missing stores config: ${p}. Copy stores/stores.json.example or run scripts/migrate-stores-from-legacy.js.`);
  }
  const raw = fs.readFileSync(p, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('stores.json must be a non-empty array.');
  }
  for (const s of data) {
    if (!s.name) {
      throw new Error(`Store entry must have "name": ${JSON.stringify(s)}`);
    }
    const mode = s.scrapeMode || 'summary';

    if (mode === 'legacy_shopify_table') {
      if (!s.reportUrl) {
        throw new Error(`Store "${s.name}" (legacy_shopify_table) needs "reportUrl".`);
      }
      continue;
    }

    if (!s.reports) {
      throw new Error(`Store entry must have "reports" (or use scrapeMode "legacy_shopify_table"): ${JSON.stringify(s)}`);
    }
    for (const key of ['sessions', 'addToCart', 'reachedCheckout']) {
      if (!s.reports[key]) {
        throw new Error(`Store "${s.name}" missing reports.${key} URL`);
      }
    }
    if (mode === 'summary') {
      s.selectors = s.selectors || {};
      for (const key of ['sessions', 'addToCart', 'reachedCheckout']) {
        if (!s.selectors[key]) {
          throw new Error(
            `Store "${s.name}" needs selectors.${key} (CSS) for summary mode. Inspect the analytics page in DevTools.`
          );
        }
      }
    } else if (mode === 'table') {
      if (!s.tableOptions || typeof s.tableOptions !== 'object') {
        throw new Error(`Store "${s.name}" with scrapeMode "table" needs tableOptions (tableSelector, rowDateSelector, etc.).`);
      }
      s.tableMetricSelectors = s.tableMetricSelectors || {};
      for (const key of ['sessions', 'addToCart', 'reachedCheckout']) {
        if (!s.tableMetricSelectors[key]) {
          throw new Error(`Store "${s.name}" needs tableMetricSelectors.${key} (CSS for the metric cell in each row).`);
        }
      }
    } else {
      throw new Error(`Store "${s.name}" has invalid scrapeMode (summary | table | legacy_shopify_table).`);
    }
  }
  return data;
}

function assertSpreadsheetConfigured(stores) {
  const anyStoreMissingId = stores.some((s) => !s.spreadsheetId);
  if (anyStoreMissingId && !spreadsheetId) {
    throw new Error('Set SPREADSHEET_ID in .env or set "spreadsheetId" on every store.');
  }
}

function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function cmdLogin() {
  const profileDir = getProfileDir();
  let lockPath;
  let context;
  try {
    lockPath = acquireProfileLock(profileDir);
    context = await launchPersistentContext(profileDir, { headless: false });
    const pages = context.pages();
    const page = pages.length ? pages[0] : await context.newPage();
    logger.info(`Opening ${START_URL} — log in with your Partner-linked account, then return here.`);
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    await waitForEnter('Press Enter after login is complete and the admin loads… ');
    logger.info('Login session will be saved to profile. Closing browser.');
  } finally {
    releaseProfileLock(lockPath);
    if (context) await context.close();
  }
}

async function scrapeMetricForStore(page, store, metricKey, targetDateIso) {
  const mode = store.scrapeMode || 'summary';
  const url = store.reports[metricKey];

  if (mode === 'table') {
    const t = store.tableOptions || {};
    return scrapeMetricFromTableRow(page, {
      url,
      targetDate: targetDateIso,
      tableSelector: t.tableSelector,
      rowDateSelector: t.rowDateSelector,
      rowMetricSelector: store.tableMetricSelectors[metricKey],
      navigationTimeoutMs,
      postLoadDelayMs,
    });
  }

  return scrapeSingleMetric(page, {
    url,
    selector: store.selectors[metricKey],
    navigationTimeoutMs,
    postLoadDelayMs,
  });
}

async function cmdRun() {
  const profileDir = getProfileDir();
  const targetDateIso = getTargetDateIso(envTargetDate);
  let report = { outcome: 'error', detail: 'Run did not complete' };
  let lockPath;
  let context;

  try {
    const stores = loadStores();
    assertSpreadsheetConfigured(stores);

    logger.info(`Target date (sheet match): ${targetDateIso}${sheetDateTz ? ` (TZ: ${sheetDateTz})` : ''}`);

    lockPath = acquireProfileLock(profileDir);
    const headless = browserHeadless();
    if (!headless) {
      logger.info('Visible browser (HEADFUL_RUN) — you should see Chrome during this run.');
    }
    context = await launchPersistentContext(profileDir, { headless });
    // Mitigate basic automation detection differences between headful and headless.
    // (Legacy Puppeteer code used evaluateOnNewDocument to override navigator.webdriver.)
    context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      } catch { }
      try {
        // Some sites check presence of chrome runtime object.
        window.chrome = window.chrome || { runtime: {} };
      } catch { }
    });
    const sheets = await getSheetsClient();
    const pages = context.pages();
    const page = pages.length ? pages[0] : await context.newPage();

    let anyStoreScrapeFailed = false;

    for (const store of stores) {
      const sheetTab = store.sheetTab || defaultSheetTab;
      const dateCol = (store.dateColumn || dateColumn).toUpperCase();
      const sid = store.spreadsheetId || spreadsheetId;

      const mode = store.scrapeMode || 'summary';
      let cols;
      if (mode === 'legacy_shopify_table') {
        try {
          cols = await resolveLegacyScraperColumns(sheets, sid, sheetTab);
        } catch (e) {
          logger.error(`Store "${store.name}": ${e.message}`);
          anyStoreScrapeFailed = true;
          continue;
        }
      } else {
        cols = {
          sessions: (store.columns && store.columns.sessions) || colSessions,
          addToCart: (store.columns && store.columns.addToCart) || colAddToCart,
          reachedCheckout: (store.columns && store.columns.reachedCheckout) || colReachedCheckout,
        };
      }

      logger.info(`Store: ${store.name} → spreadsheet …${String(sid).slice(-6)} tab "${sheetTab}"`);

      logger.info(
        `  Looking up date ${targetDateIso} in column ${dateCol} (scanning rows 1–${sheetDateMaxRows}, not full column)…`
      );
      const rowNumber = await findRowByDate(sheets, sid, sheetTab, dateCol, targetDateIso);
      if (rowNumber == null) {
        logger.error(
          `No existing row for date ${targetDateIso} in column ${dateCol} (tab "${sheetTab}"). Skipping store (no new rows policy). If the date is below row ${sheetDateMaxRows}, set SHEET_DATE_MAX_ROWS in .env.`
        );
        continue;
      }
      logger.info(`  Matched sheet row ${rowNumber}.`);

      let metrics = {};
      let storeFailed = false;

      if (mode === 'legacy_shopify_table') {
        const legacyDelay = Number(process.env.LEGACY_POST_LOAD_DELAY_MS || 9000);
        try {
          metrics = await withRetry(
            async () => {
              // Re-create a fresh page per retry to avoid "page/context/browser closed"
              // cascading from a timed-out attempt.
              const attemptPage = await context.newPage();
              try {
                return await scrapeLegacyShopifyAnalyticsTable(attemptPage, {
                  url: store.reportUrl,
                  navigationTimeoutMs,
                  postLoadDelayMs: legacyDelay,
                });
              } finally {
                try {
                  await attemptPage.close({ runBeforeUnload: false });
                } catch {
                  // ignore cleanup errors
                }
              }
            },
            {
              retries: scrapeRetries,
              delayMs: 2000,
              noRetryCodes: ['CLOUDFLARE_CHALLENGE'],
              onRetry: (err, attempt) => {
                logger.warn(`Retry ${attempt} for ${store.name} (legacy table): ${err.message}`);
              },
            }
          );
          logger.info(`  sessions: ${metrics.sessions}, addToCart: ${metrics.addToCart}, reachedCheckout: ${metrics.reachedCheckout}`);
        } catch (err) {
          if (err.code === 'LOGIN_REQUIRED') {
            logger.error(err.message);
            throw err;
          }
          if (err.code === 'CLOUDFLARE_CHALLENGE') {
            logger.error(err.message);
            throw err;
          }
          logger.error(`  Legacy scrape failed: ${err.message}`);
          storeFailed = true;
        }
      } else {
        for (const key of ['sessions', 'addToCart', 'reachedCheckout']) {
          try {
            const val = await withRetry(
              () => scrapeMetricForStore(page, store, key, targetDateIso),
              {
                retries: scrapeRetries,
                delayMs: 2000,
                onRetry: (err, attempt) => {
                  logger.warn(`Retry ${attempt} for ${store.name}.${key}: ${err.message}`);
                },
              }
            );
            metrics[key] = val;
            logger.info(`  ${key}: ${val}`);
          } catch (err) {
            if (err.code === 'LOGIN_REQUIRED') {
              logger.error(err.message);
              throw err;
            }
            logger.error(`  ${key} failed after retries: ${err.message}`);
            storeFailed = true;
            break;
          }
        }
      }

      if (storeFailed) {
        anyStoreScrapeFailed = true;
        logger.error(`Skipping Sheets update for "${store.name}" due to scrape errors.`);
        continue;
      }

      await updateMetricsRow(sheets, sid, sheetTab, rowNumber, metrics, cols);
      logger.info(`  Sheets updated row ${rowNumber} (${cols.sessions}, ${cols.addToCart}, ${cols.reachedCheckout}).`);
    }

    if (anyStoreScrapeFailed) {
      logger.error('Run finished with one or more store scrape failures (see log).');
      process.exitCode = 1;
      report = { outcome: 'partial' };
    } else {
      logger.info('Run completed successfully.');
      report = { outcome: 'success' };
    }
  } catch (e) {
    report = { outcome: 'error', error: e.message, code: e.code };
    throw e;
  } finally {
    releaseProfileLock(lockPath);
    if (context) await context.close();
    await sendRunReportEmailIfEnabled({ ...report, targetDateIso });
  }
}

async function cmdCheckSession() {
  const profileDir = getProfileDir();
  let lockPath;
  let context;
  try {
    lockPath = acquireProfileLock(profileDir);
    const headless = browserHeadless();
    context = await launchPersistentContext(profileDir, { headless });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    await assertNotLoggedOut(page);
    logger.info('Session OK (no login redirect detected).');
  } finally {
    releaseProfileLock(lockPath);
    if (context) await context.close();
  }
}

async function main() {
  const cmd = process.argv[2] || 'run';
  try {
    if (cmd === 'login') {
      await cmdLogin();
    } else if (cmd === 'run') {
      await cmdRun();
    } else if (cmd === 'check-session') {
      await cmdCheckSession();
    } else {
      console.error('Usage: node index.js [login|run|check-session]');
      process.exit(1);
    }
  } catch (e) {
    logger.error(e.message || e);
    if (e.stack) logger.error(e.stack);
    process.exit(1);
  }
}

main();
