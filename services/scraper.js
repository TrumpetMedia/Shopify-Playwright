const { assertNotLoggedOut } = require('../utils/loginDetection');
const { parseMetricText } = require('../utils/numberParse');
const { sleep } = require('../utils/retry');
const { logger } = require('../utils/logger');

/**
 * Same layout as legacy Puppeteer scraper: div[role="table"], data on row index 1,
 * cells: visits[0], reached checkout[2], add to cart[3].
 *
 * @param {import('playwright').Page} page
 * @param {{
 *   url: string,
 *   navigationTimeoutMs?: number,
 *   postLoadDelayMs?: number,
 *   dataRowIndex?: number,
 *   cellIndexByMetric?: { sessions: number, addToCart: number, reachedCheckout: number },
 * }} opts
 * @returns {Promise<{ sessions: string, addToCart: string, reachedCheckout: string }>}
 */
async function scrapeLegacyShopifyAnalyticsTable(page, opts) {
  const navigationTimeoutMs = opts.navigationTimeoutMs ?? 120000;
  const postLoadDelayMs = opts.postLoadDelayMs ?? 8000;
  const dataRowIndex = opts.dataRowIndex ?? 1;
  const cellIndexByMetric = opts.cellIndexByMetric || {
    sessions: 0,
    reachedCheckout: 2,
    addToCart: 3,
  };

  logger.info('  [scrape] Navigating to report…');
  await page.goto(opts.url, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  });
  logger.info(`  [scrape] Loaded: ${page.url().split('?')[0].slice(0, 90)}…`);
  // Shopify admin never reaches "networkidle" reliably — do not wait on it (was causing long stalls).
  await assertNotLoggedOut(page);

  logger.info('  [scrape] Waiting for analytics table (div[role="table"])…');
  await page.waitForSelector('div[role="table"]', {
    timeout: navigationTimeoutMs,
  });

  logger.info(`  [scrape] Table found; waiting ${postLoadDelayMs}ms for numbers to settle…`);
  await sleep(postLoadDelayMs);

  const raw = await page.evaluate(
    ({ dataRowIndex: rowIdx, cellIndexByMetric: ci }) => {
      const table = document.querySelector('div[role="table"]');
      if (!table) return { error: 'no_table' };
      const rows = table.querySelectorAll('div[role="row"]');
      const dataRow = rows[rowIdx];
      if (!dataRow) return { error: 'no_row' };
      const cells = dataRow.querySelectorAll('div[role="cell"]');
      const pick = (i) => (cells[i]?.textContent || '').trim();
      return {
        ok: true,
        sessions: pick(ci.sessions),
        reachedCheckout: pick(ci.reachedCheckout),
        addToCart: pick(ci.addToCart),
      };
    },
    { dataRowIndex, cellIndexByMetric }
  );

  if (!raw.ok) {
    throw new Error(`Legacy table scrape failed: ${raw.error}`);
  }

  const sessions = parseMetricText(raw.sessions) ?? (raw.sessions === '' ? '0' : null);
  const addToCart = parseMetricText(raw.addToCart) ?? (raw.addToCart === '' ? '0' : null);
  const reachedCheckout = parseMetricText(raw.reachedCheckout) ?? (raw.reachedCheckout === '' ? '0' : null);

  if (sessions == null || addToCart == null || reachedCheckout == null) {
    throw new Error(
      `Invalid legacy row values: ${JSON.stringify({ sessions: raw.sessions, addToCart: raw.addToCart, reachedCheckout: raw.reachedCheckout })}`
    );
  }

  return { sessions, addToCart, reachedCheckout };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ url: string, selector: string, navigationTimeoutMs?: number, postLoadDelayMs?: number }} opts
 */
async function scrapeSingleMetric(page, opts) {
  const navigationTimeoutMs = opts.navigationTimeoutMs ?? 120000;
  const postLoadDelayMs = opts.postLoadDelayMs ?? 2500;

  await page.goto(opts.url, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  });

  await assertNotLoggedOut(page);

  await page.waitForSelector(opts.selector, {
    state: 'visible',
    timeout: navigationTimeoutMs,
  });

  await sleep(postLoadDelayMs);

  const handle = page.locator(opts.selector).first();
  const raw = await handle.innerText();
  const value = parseMetricText(raw);
  if (value == null) {
    throw new Error(`Invalid or empty metric from selector "${opts.selector}" (raw: ${JSON.stringify(raw)})`);
  }
  return value;
}

/**
 * Table mode: find row where date column matches targetDate, read metric cell.
 * @param {import('playwright').Page} page
 * @param {{
 *   url: string,
 *   targetDate: string,
 *   rowDateSelector?: string,
 *   rowMetricSelector?: string,
 *   tableSelector?: string,
 *   navigationTimeoutMs?: number,
 *   postLoadDelayMs?: number,
 * }} opts
 */
async function scrapeMetricFromTableRow(page, opts) {
  const navigationTimeoutMs = opts.navigationTimeoutMs ?? 120000;
  const postLoadDelayMs = opts.postLoadDelayMs ?? 2500;
  const tableSelector = opts.tableSelector || 'table';
  const rowDateSelector = opts.rowDateSelector || 'td:first-child';
  const rowMetricSelector = opts.rowMetricSelector || 'td:last-child';

  await page.goto(opts.url, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  });
  await assertNotLoggedOut(page);
  await page.waitForSelector(tableSelector, { timeout: navigationTimeoutMs });
  await sleep(postLoadDelayMs);

  const result = await page.evaluate(
    ({ tableSel, dateSel, metricSel, iso }) => {
      const table = document.querySelector(tableSel);
      if (!table) return { error: 'no_table' };
      const rows = table.querySelectorAll('tbody tr, tr');
      for (const row of rows) {
        const dateCell = row.querySelector(dateSel);
        const metricCell = row.querySelector(metricSel);
        if (!dateCell || !metricCell) continue;
        const dateText = (dateCell.textContent || '').trim();
        if (!dateText) continue;
        if (dateText.includes(iso) || dateText.replace(/\//g, '-').includes(iso)) {
          return { ok: true, raw: (metricCell.textContent || '').trim() };
        }
      }
      return { error: 'no_row' };
    },
    {
      tableSel: tableSelector,
      dateSel: rowDateSelector,
      metricSel: rowMetricSelector,
      iso: opts.targetDate,
    }
  );

  if (!result.ok) {
    throw new Error(`Table scrape failed: ${result.error} for date ${opts.targetDate}`);
  }
  const value = parseMetricText(result.raw);
  if (value == null) {
    throw new Error(`Invalid metric in table row (raw: ${JSON.stringify(result.raw)})`);
  }
  return value;
}

module.exports = {
  scrapeLegacyShopifyAnalyticsTable,
  scrapeSingleMetric,
  scrapeMetricFromTableRow,
};
