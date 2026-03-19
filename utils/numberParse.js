const PLACEHOLDERS = new Set(['—', '-', '–', '…', '...', 'n/a', 'na', '']);

/**
 * @param {string} raw
 * @returns {string | null} normalized numeric string or null if invalid
 */
function parseMetricText(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || PLACEHOLDERS.has(s.toLowerCase())) return null;
  // Keep digits, dot, minus; strip thousands separators and spaces/currency
  const cleaned = s.replace(/[\s,]/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

module.exports = { parseMetricText };
