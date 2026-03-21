const { chromium } = require('playwright');

/**
 * Reduces "automation" fingerprinting; many sites (Shopify / Google sign-in) stall or skip
 * the password step when default Playwright flags are present.
 */
const STEALTHISH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

/**
 * Optional extra flags from .env (space-separated), e.g. on Linux VPS if Chromium
 * crashes with SIGTRAP: --disable-gpu --disable-software-rasterizer --disable-crash-reporter
 */
function parseExtraChromiumArgs() {
  const raw = process.env.PLAYWRIGHT_CHROMIUM_ARGS || '';
  if (!raw.trim()) return [];
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} profileDir Absolute path to user data dir (persistent profile)
 * @param {{ headless: boolean }} options
 */
async function launchPersistentContext(profileDir, { headless }) {
  const launchOpts = {
    headless,
    // Removes "--enable-automation" so the browser looks more like a normal install.
    ignoreDefaultArgs: ['--enable-automation'],
    args: [...STEALTHISH_ARGS, ...parseExtraChromiumArgs()],
    // Sensible default; some login UIs misbehave on tiny default viewports.
    viewport: { width: 1365, height: 900 },
  };

  const channel = process.env.PLAYWRIGHT_CHANNEL;
  if (channel && channel !== 'chromium') {
    launchOpts.channel = channel;
  }

  return chromium.launchPersistentContext(profileDir, launchOpts);
}

module.exports = { launchPersistentContext };
