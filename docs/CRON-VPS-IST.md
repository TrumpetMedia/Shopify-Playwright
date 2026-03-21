# Cron on VPS — twice daily (IST)

Runs on the **server** only. Your **PC can be off**.

## Times (IST)

- **10:30** — morning run  
- **13:00** (1:00 PM) — afternoon run  

## One-time on the VPS

1. Ensure `.env` on the server has what you use for manual runs, e.g.  
   `HEADFUL_RUN=1`, `PLAYWRIGHT_CHANNEL=chrome`, `SHEET_DATE_TZ=Asia/Kolkata` (or rely on `TZ`).

2. Create log directory:

   ```bash
   mkdir -p /opt/Shopify-Playwright/logs
   ```

3. Edit root’s crontab:

   ```bash
   crontab -e
   ```

4. Paste **everything** below (adjust `/opt/Shopify-Playwright` if your path differs):

```cron
# Interpret cron times in India Standard Time
CRON_TZ=Asia/Kolkata

# 10:30 AM IST — Shopify scraper
30 10 * * * /usr/bin/flock -n /tmp/shopify-playwright.lock -c 'cd /opt/Shopify-Playwright && export LIBGL_ALWAYS_SOFTWARE=1 && /usr/bin/xvfb-run -a -s "-screen 0 1920x1080x24" /usr/bin/npm run run' >> /opt/Shopify-Playwright/logs/cron.log 2>&1

# 1:00 PM IST — Shopify scraper
0 13 * * * /usr/bin/flock -n /tmp/shopify-playwright.lock -c 'cd /opt/Shopify-Playwright && export LIBGL_ALWAYS_SOFTWARE=1 && /usr/bin/xvfb-run -a -s "-screen 0 1920x1080x24" /usr/bin/npm run run' >> /opt/Shopify-Playwright/logs/cron.log 2>&1
```

- **`flock`**: if a run is still going at the next time, the second start **skips** (no overlapping browser on the same profile).  
- **`xvfb-run`**: virtual display for headed Chrome.  
- **Logs**: `logs/cron.log` (append).

5. Confirm cron sees the lines:

   ```bash
   crontab -l
   ```

## Check `npm` path (if cron says `npm: not found`)

```bash
which npm
```

If it’s not `/usr/bin/npm`, replace `/usr/bin/npm` in the crontab with that full path.

## Test without waiting for 10:30

Run the **inner** command once by hand:

```bash
cd /opt/Shopify-Playwright
export LIBGL_ALWAYS_SOFTWARE=1
/usr/bin/xvfb-run -a -s "-screen 0 1920x1080x24" /usr/bin/npm run run
```

## Notes

- **DST**: India does not observe DST; `Asia/Kolkata` stays consistent year-round.  
- **Session expiry**: if Shopify logs the profile out, run `npm run login` on the VPS again (VNC), then cron will work until the next expiry.
