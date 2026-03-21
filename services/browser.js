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
 * Linux + headful (e.g. Xvfb on a VPS): Playwright injects `--enable-unsafe-swiftshader` by default.
 * Together with `--disable-gpu` / virtual display that often triggers immediate Chromium SIGTRAP.
 * Stripping that default fixes many "headful works nowhere" VPS setups.
 */
function linuxHeadfulStabilityArgs() {
  if (process.env.PLAYWRIGHT_LINUX_HEADFUL_EXTRA === '0') {
    return [];
  }
  return [
    // Virtual framebuffer (Xvfb) is X11; be explicit so Ozone doesn't pick a bad backend.
    '--ozone-platform=x11',
    // Software-only rendering on servers (safe with Xvfb).
    '--disable-gpu',
    '--disable-software-rasterizer',
  ];
}

/**
 * @param {string} profileDir Absolute path to user data dir (persistent profile)
 * @param {{ headless: boolean | 'shell' }} options
 */
async function launchPersistentContext(profileDir, { headless }) {
  const ignoreDefaultArgs = ['--enable-automation'];

  // Headful Linux (Xvfb): drop SwiftShader enable — conflicts with disable-gpu / headful GPU path.
  if (process.platform === 'linux' && headless === false) {
    ignoreDefaultArgs.push('--enable-unsafe-swiftshader');
  }

  const args = [...STEALTHISH_ARGS, ...parseExtraChromiumArgs()];
  if (process.platform === 'linux' && headless === false) {
    args.push(...linuxHeadfulStabilityArgs());
  }

  const launchOpts = {
    headless,
    ignoreDefaultArgs,
    args,
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
