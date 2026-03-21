# Shopify Analytics Scraper (Playwright + persistent profile)

Automates **Shopify Admin** analytics metrics (Sessions, Add to cart, Reached checkout) using a **single persistent Chromium profile** (full browser state—not manual cookie files), then updates **existing** Google Sheet rows matched by date (columns **K, L, M** by default).

## Principles

- **One machine / one IP** — same VPS, same profile directory.
- **Do not log in on every run** — session lives in the profile; refresh with `npm run login` when Shopify expires the session.
- **No concurrent runs** — a lock file prevents two processes from using the same profile.
- **Headful vs headless** — set `HEADFUL_RUN=1` in `.env` (or run `npm run run:headed`) to **watch Chrome** during `npm run run`. **Cloudflare / “verify human”** usually requires a **headed** browser, so on a **VPS** use **headful + Xvfb** (see [VPS headful (Xvfb)](#vps-headful-xvfb)). Only use plain headless if the site allows it.

## Layout

```
profiles/main/     # persistent browser user data (never delete; back up this folder)
stores/stores.json # store list + report URLs + CSS selectors
services/          # browser, scraper, Google Sheets
utils/             # retry, login detection, lock, logging
logs/run.log
index.js
```

On Linux VPS, set `PROFILE_DIR=/profiles/main` (absolute path on persistent disk).

## Prerequisites

- Node.js 18+
- Playwright browsers: `npx playwright install chromium`
- **Google Sheets API** access via either:
  - **Service account** JSON + share each spreadsheet with `client_email`, or
  - **OAuth** (legacy): `credentials.json` (Desktop app) + `token.json` in the project root (gitignored). Sheets must be accessible to the Google account that authorized the token.
- For **legacy-style stores** (single Shopify analytics URL + `div[role="table"]`), set `SHEET_DATE_TZ=Asia/Kolkata` (or your reporting timezone) so “yesterday” matches column A.

## Migrated from `Shopify scraper` (Puppeteer + cookies)

If you brought files from the older project:

| Old | New |
|-----|-----|
| `credentials.json` + `token.json` | Same filenames in **Playwright project root** (already gitignored) |
| `stores.json` | Run `node scripts/migrate-stores-from-legacy.js` → `stores/stores.json` (only `name`, `reportUrl`, `spreadsheetId`, `sheetTab` + `scrapeMode`) |
| `cookies.json` | **Not used.** Run `npm run login` once to fill `profiles/main`. |
| `.env` Shopify password | **Not used** by this app. Use interactive `npm run login`; keep password out of this repo. |

Re-authorize Google if `token.json` is old: use the legacy scraper’s auth flow or create a small script with `generateAuthUrl` / `getToken` and overwrite `token.json`.

## Setup

1. Copy env and stores config:

   ```bash
   cp .env.example .env
   cp stores/stores.json.example stores/stores.json
   ```

2. Edit `.env`: `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, optional `PROFILE_DIR`, `TZ`.

3. Edit `stores/stores.json`:
   - Set each store’s **report URLs** (open the report in the browser and copy the URL).
   - Set **`selectors.*`** to a CSS selector that targets the **numeric value** you want (use DevTools; Shopify’s DOM changes—verify after upgrades).

4. In Google Sheets, ensure column **A** (or your `dateColumn`) has dates that normalize to `YYYY-MM-DD` for **yesterday** in the server timezone (or set `TARGET_DATE=YYYY-MM-DD` for a one-off).

5. **First-time login (headful):**

   ```bash
   npm run login
   ```

   Sign in to Shopify in the opened window. When the admin is usable, press **Enter** in the terminal. The profile under `profiles/main` is saved.

   **Linux VPS (no monitor):** headed Chrome needs a virtual display or you get *Missing X server or $DISPLAY*. Use the same pattern as `npm run run`:

   ```bash
   export LIBGL_ALWAYS_SOFTWARE=1
   PLAYWRIGHT_CHANNEL=chrome xvfb-run -a -s "-screen 0 1920x1080x24" npm run login
   ```

   Or: `npm run login:xvfb` (runs `xvfb-run … node index.js login`). You still won’t see the browser over SSH unless you use **VNC/noVNC**; for a blind login, copy `profiles/main` from a machine where you already ran `npm run login`, or attach VNC to the Xvfb display.

   **`Profile lock exists … .scraper.lock`** — the previous run exited without cleanup (closed terminal, killed Node, or closed the browser before pressing Enter). Run `npm run unlock-profile`, or the next run will auto-remove the lock if that old process is no longer running.

   **Login stuck after entering email (no password page)?** This is usually automation detection against Playwright’s **bundled Chromium**. Fix:
   - Install **Google Chrome** (stable) on the machine.
   - Set in `.env`: `PLAYWRIGHT_CHANNEL=chrome` (already the default in `.env.example`).
   - Run `npm run login` again. The code also drops `--enable-automation` and uses `AutomationControlled` mitigations in `services/browser.js`.
   - If it still hangs: try `LOGIN_START_URL=https://accounts.shopify.com/lookup` in `.env`, or complete login in a normal Chrome window once and see if Shopify sent a **magic link** or **CAPTCHA** instead of a password step.

6. **Dry-run session check (headless):**

   ```bash
   npm run check-session
   ```

7. **Daily scrape:**

   ```bash
   npm run run
   ```

## Google Sheets behavior

- **No new rows** — the script looks up the row where `dateColumn` equals the target date (default: **yesterday**). If no row exists, that store is **skipped** and logged.
- **`legacy_shopify_table` stores** — writes use the **same method as the old Puppeteer scraper**: read **row 1** and locate columns **`Visits`**, **`Add To Cart`**, **`Reached checkout`** (exact titles). No sheet config in `stores.json`.
- **`summary` / `table` stores** — writes use fixed column letters (default **K, L, M**) or per-store `columns.*`.
- Per-store overrides: `sheetTab`, `dateColumn` (legacy mode still uses header-based metric columns).

## Scraping modes

### `legacy_shopify_table`

One **`reportUrl`** per store; reads **`div[role="table"]`** using the same row/cell layout as the old scraper (hardcoded in `services/scraper.js`). Post-load wait: **`LEGACY_POST_LOAD_DELAY_MS`** (default `9000`).

### `summary` (default)

Each metric has its own admin URL + **CSS selector** for the displayed number (e.g. headline KPI on the report).

### `table`

Use when the report is a **table** and you need the cell on the row for `TARGET_DATE` / yesterday:

```json
"scrapeMode": "table",
"tableOptions": {
  "tableSelector": "table.some-report-table",
  "rowDateSelector": "td:first-child"
},
"tableMetricSelectors": {
  "sessions": "td:nth-child(2)",
  "addToCart": "td:nth-child(2)",
  "reachedCheckout": "td:nth-child(2)"
}
```

## VPS headful (Xvfb)

Headless runs are often blocked by **Cloudflare** or similar. On Linux servers there is no real monitor, so use **Xvfb** (virtual framebuffer) — it’s still a **headed** Chromium process (not `headless: true`), which behaves much closer to a desktop browser.

**Dependencies (once per server):**

```bash
sudo apt update && sudo apt install -y xvfb
cd /path/to/project && npx playwright install-deps chromium
```

**Why Chromium sometimes crashed with `SIGTRAP`:** Playwright’s default `--enable-unsafe-swiftshader` can conflict with GPU-off / virtual-display setups. This project **strips that default** on **Linux + headful** and adds `--ozone-platform=x11`, `--disable-gpu`, and `--disable-software-rasterizer` (unless you set `PLAYWRIGHT_LINUX_HEADFUL_EXTRA=0`).

**Run (example):**

```bash
cd /opt/Shopify-Playwright
export LIBGL_ALWAYS_SOFTWARE=1
HEADFUL_RUN=1 PLAYWRIGHT_CHANNEL=chromium xvfb-run -a -s "-screen 0 1920x1080x24" npm run run
```

Optional extra flags in `.env`: `PLAYWRIGHT_CHROMIUM_ARGS=--disable-crash-reporter` (space-separated list).

**If the browser still exits immediately:** install **Google Chrome** (`google-chrome-stable`), set `PLAYWRIGHT_CHANNEL=chrome`, and run `npx playwright install chrome`.

## Cron (VPS)

Set `TZ` to your reporting timezone. For **headful** daily runs, wrap the same `xvfb-run ... npm run run` command you use manually (do **not** use bare `npm run run` without Xvfb if you rely on headed mode). Example daily at 6:15:

```cron
15 6 * * * cd /opt/Shopify-Playwright && set -a && . ./.env && set +a && /usr/bin/xvfb-run -a -s "-screen 0 1920x1080x24" /usr/bin/npm run run >> /opt/Shopify-Playwright/logs/cron.log 2>&1
```

## Failure handling

| Situation | Behavior |
|-----------|----------|
| Redirect to Shopify login | Process stops with `LOGIN_REQUIRED`; run `npm run login` again. |
| Empty / placeholder metric | Retries (default 3) with backoff. |
| Another process using profile | Exits with `PROFILE_LOCKED`. |

## Environment variables

See `.env.example`. Notable:

| Variable | Purpose |
|----------|---------|
| `PROFILE_DIR` | Persistent profile path |
| `TARGET_DATE` | Force `YYYY-MM-DD` instead of yesterday |
| `SCRAPE_RETRIES` | Per-metric retries (default 3) |
| `POST_LOAD_DELAY_MS` | Extra wait after selectors (async UI) |
| `PLAYWRIGHT_CHANNEL` | Use `chrome` for system Chrome if needed |

## Security & compliance

Automating the Shopify admin may violate Shopify’s terms for your account. Use an account you’re allowed to automate, keep the profile and service account JSON **off git**, and restrict VPS access.
