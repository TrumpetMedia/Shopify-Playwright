const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
const runLogPath = path.join(logsDir, 'run.log');

function isEmailEnabled() {
  const v = (process.env.EMAIL_ENABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function tailRunLog(maxLines) {
  const n = Number(maxLines || process.env.EMAIL_LOG_TAIL_LINES || 400);
  try {
    if (!fs.existsSync(runLogPath)) {
      return '(run.log not found yet)';
    }
    const content = fs.readFileSync(runLogPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const slice = lines.length > n ? lines.slice(-n) : lines;
    return slice.join('\n');
  } catch (e) {
    return `(could not read run.log: ${e.message})`;
  }
}

function buildSubject(payload) {
  const date = payload.targetDateIso || '?';
  const { outcome } = payload;
  let tag = 'UNKNOWN';
  if (outcome === 'success') tag = 'OK';
  else if (outcome === 'partial') tag = 'PARTIAL';
  else if (outcome === 'error') tag = 'FAILED';
  return `[Shopify scraper] ${tag} — ${date}`;
}

function buildTextBody(payload, logTail) {
  const lines = [
    `Outcome: ${payload.outcome || 'unknown'}`,
    `Target date (sheet): ${payload.targetDateIso || '?'}`,
    '',
  ];
  if (payload.error) {
    lines.push(`Error: ${payload.error}`);
    if (payload.code) lines.push(`Code: ${payload.code}`);
    lines.push('');
  }
  if (payload.detail && payload.outcome === 'error' && !payload.error) {
    lines.push(`Detail: ${payload.detail}`);
    lines.push('');
  }
  lines.push('--- Last lines of logs/run.log ---');
  lines.push(logTail);
  return lines.join('\n');
}

/**
 * @param {object} payload
 * @param {'success'|'partial'|'error'} payload.outcome
 * @param {string} payload.targetDateIso
 * @param {string} [payload.error]
 * @param {string} [payload.code]
 * @param {string} [payload.detail]
 */
async function sendRunReportEmailIfEnabled(payload) {
  if (!isEmailEnabled()) return;

  const host = process.env.SMTP_HOST;
  const to = process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  if (!host || !to || !from) {
    console.error(
      '[email] EMAIL_ENABLED is set but SMTP_HOST, EMAIL_TO, or EMAIL_FROM is missing — skipping email.'
    );
    return;
  }

  // Let winston finish writing the file
  await new Promise((r) => setTimeout(r, 300));

  const logTail = tailRunLog();
  const subject = buildSubject(payload);
  const text = buildTextBody(payload, logTail);

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.error('[email] nodemailer is not installed. Run: npm install nodemailer');
    return;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === '1' ||
    process.env.SMTP_SECURE === 'true' ||
    port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  const toList = to
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    await transporter.sendMail({
      from,
      to: toList.join(', '),
      subject,
      text,
    });
    console.error(`[email] Sent run report to ${toList.join(', ')}`);
  } catch (e) {
    console.error(`[email] Failed to send: ${e.message}`);
  }
}

module.exports = {
  isEmailEnabled,
  sendRunReportEmailIfEnabled,
  tailRunLog,
};
