// Per-million-token prices in USD. Cache write prices use the 5m ephemeral tier by default;
// 1h cache writes are billed at ~2x the 5m rate, so we apply a multiplier when present.
// Update these as Anthropic publishes new pricing.

const PRICE_PER_MTOK = {
  // Claude 4.x Opus
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
  'claude-opus-4-5': { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
  'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },

  // Claude 4.x Sonnet
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },

  // Claude 4.x Haiku
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },

  // Legacy 3.x (rough defaults; adjust if needed)
  'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite5m: 1, cacheWrite1h: 1.6 },
  'claude-3-opus': { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
};

const FALLBACK = PRICE_PER_MTOK['claude-sonnet-4-6'];

function normalizeModel(model) {
  if (!model) return 'unknown';
  // Strip date suffixes like "-20250101" and bracketed tags like "[1m]"
  return String(model)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '')
    .trim();
}

function priceForModel(model) {
  const key = normalizeModel(model);
  if (PRICE_PER_MTOK[key]) return PRICE_PER_MTOK[key];
  // Fuzzy prefix match (handles minor version drift)
  const match = Object.keys(PRICE_PER_MTOK).find((k) => key.startsWith(k));
  return match ? PRICE_PER_MTOK[match] : FALLBACK;
}

function costForUsage(model, usage) {
  if (!usage) return 0;
  const p = priceForModel(model);
  const input = (usage.input_tokens || 0) * p.input;
  const output = (usage.output_tokens || 0) * p.output;
  const cacheRead = (usage.cache_read_input_tokens || 0) * p.cacheRead;

  // Split cache creation between 5m and 1h tiers if reported, else assume 5m.
  const ephem5m = usage.cache_creation?.ephemeral_5m_input_tokens;
  const ephem1h = usage.cache_creation?.ephemeral_1h_input_tokens;
  let cacheWrite = 0;
  if (ephem5m != null || ephem1h != null) {
    cacheWrite =
      (ephem5m || 0) * p.cacheWrite5m + (ephem1h || 0) * p.cacheWrite1h;
  } else {
    cacheWrite = (usage.cache_creation_input_tokens || 0) * p.cacheWrite5m;
  }

  return (input + output + cacheRead + cacheWrite) / 1_000_000;
}

module.exports = { priceForModel, costForUsage, normalizeModel, PRICE_PER_MTOK };
