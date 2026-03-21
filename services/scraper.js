const { assertNotLoggedOut } = require('../utils/loginDetection');
const { parseMetricText } = require('../utils/numberParse');
const { sleep } = require('../utils/retry');
const { logger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

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

  // Match the legacy Puppeteer scraper environment (stable desktop UA + viewport).
  // This often reduces Shopify/Polaris rendering differences in headless mode.
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  } catch {
    // ignore capability differences; scraping will still try
  }

  logger.info('  [scrape] Navigating to report…');
  await page.goto(opts.url, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  });
  logger.info(`  [scrape] Loaded: ${page.url().split('?')[0].slice(0, 90)}…`);
  // Shopify admin never reaches "networkidle" reliably — do not wait on it (was causing long stalls).
  await assertNotLoggedOut(page);

  // Best-effort settle: give the client-side report renderer a short window.
  // If it never becomes idle, we continue to avoid long stalls.
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });

  // Small additional delay before waiting for the analytics table node.
  await sleep(1500);

  // Cloudflare / bot interstitials often show up only in headless mode.
  // If we detect the challenge page, stop immediately so we can be instructed to run `npm run run:headed`.
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const t = String(bodyText).toLowerCase();
    if (
      t.includes('verify you are human') ||
      t.includes('cloudflare') ||
      (t.includes('your connection needs to be verified') && t.includes('proceed')) ||
      (t.includes('turnstile') && t.includes('cloudflare'))
    ) {
      const err = new Error(
        'Cloudflare verification challenge detected in headless mode. Run with a visible browser (set HEADFUL_RUN=1 or use npm run run:headed) to clear the challenge, then retry headless.'
      );
      err.code = 'CLOUDFLARE_CHALLENGE';
      throw err;
    }
  } catch {
    // ignore detection failures; proceed with table scrape
  }

  logger.info('  [scrape] Waiting for analytics table (div[role="table"])…');
  // In headless mode, Shopify sometimes renders the table in an iframe.
  // Search across frames, then run extraction inside the correct frame.
  let tableFrame = null;
  const frames = page.frames();

  // Try main frame first.
  const main = page.mainFrame();
  try {
    await main.locator('div[role="table"]').first().waitFor({
      state: 'attached',
      timeout: Math.min(30000, navigationTimeoutMs),
    });
    await main.locator('div[role="table"] div[role="row"]').first().waitFor({
      state: 'attached',
      timeout: Math.min(30000, navigationTimeoutMs),
    });
    tableFrame = main;
  } catch {
    // fall through to scanning other frames
  }

  if (!tableFrame) {
    for (const f of frames) {
      if (!f || f === main) continue;
      try {
        await f.locator('div[role="table"]').first().waitFor({
          state: 'attached',
          timeout: Math.min(30000, navigationTimeoutMs),
        });
        await f.locator('div[role="table"] div[role="row"]').first().waitFor({
          state: 'attached',
          timeout: Math.min(30000, navigationTimeoutMs),
        });
        tableFrame = f;
        break;
      } catch {
        // try next frame
      }
    }
  }

  if (!tableFrame) {
    // Diagnostics: headless-only failures often mean bot/CAPTCHA interstitials
    // where the analytics table never renders.
    try {
      const shotsDir = path.join(__dirname, '..', 'logs', 'screenshots');
      fs.mkdirSync(shotsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const urlBase = String(page.url())
        .slice(0, 80)
        .replace(/[^a-z0-9]+/gi, '_');
      const out = path.join(shotsDir, `table_not_found_${ts}_${urlBase}.png`);
      await page.screenshot({ path: out, fullPage: true });
      logger.error(`  [scrape] Screenshot saved: ${out}`);
    } catch {
      // ignore screenshot errors
    }

    try {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const s = bodyText.toLowerCase();
      if (
        s.includes('captcha') ||
        s.includes('verify') ||
        s.includes('unusual') ||
        s.includes('robot') ||
        s.includes('security') ||
        s.includes('sorry')
      ) {
        throw new Error('Legacy scrape failed: Shopify likely served a bot/CAPTCHA interstitial in headless mode.');
      }
    } catch {
      // ignore detection errors; keep original failure below
    }

    throw new Error('Legacy scrape failed: div[role="table"] not found in any frame');
  }

  logger.info(`  [scrape] Table found; waiting ${postLoadDelayMs}ms for numbers to settle…`);
  await sleep(postLoadDelayMs);

  const raw = await tableFrame.evaluate(
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
