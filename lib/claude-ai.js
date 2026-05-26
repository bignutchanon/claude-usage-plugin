// Unofficial claude.ai client. Uses the same session cookie a browser uses.
// Do not log or return the cookie to clients. Endpoints are not public and
// may change without notice.

const keychain = require('./keychain');

const BASE = 'https://claude.ai';

function buildHeaders() {
  const creds = keychain.readAll();
  const h = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      process.env.CLAUDE_AI_USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    Referer: 'https://claude.ai/recents',
    Origin: 'https://claude.ai',
    'anthropic-client-platform': 'web_claude_ai',
    'anthropic-client-version': creds.clientVersion || '1.0.0',
  };
  if (creds.clientSha) h['anthropic-client-sha'] = creds.clientSha;
  if (creds.deviceId) h['anthropic-device-id'] = creds.deviceId;
  if (creds.anonymousId) h['anthropic-anonymous-id'] = creds.anonymousId;
  return h;
}

// Headers claude.ai often returns that we care about (rate limits, server time)
const INTERESTING_HEADER_PREFIXES = ['anthropic-ratelimit', 'x-ratelimit', 'retry-after'];

function config() {
  return {
    sessionKey: keychain.get('sessionKey'),
    orgId: keychain.get('orgId'),
  };
}

function pickInterestingHeaders(headers) {
  const out = {};
  headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (INTERESTING_HEADER_PREFIXES.some((p) => lk.startsWith(p))) out[lk] = v;
  });
  return out;
}

async function call(path) {
  const { sessionKey, orgId } = config();
  if (!sessionKey || !orgId) return { configured: false };

  const url = `${BASE}${path.replace('{org}', encodeURIComponent(orgId))}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { ...buildHeaders(), Cookie: `sessionKey=${sessionKey}` },
      redirect: 'manual',
    });
  } catch (err) {
    return { configured: true, error: `network: ${err.message}` };
  }

  const responseHeaders = pickInterestingHeaders(res.headers);

  if (res.status === 401 || res.status === 403) {
    return {
      configured: true,
      status: res.status,
      responseHeaders,
      error: 'sessionKey is invalid or expired — re-copy it from claude.ai cookies',
    };
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      configured: true,
      status: res.status,
      responseHeaders,
      error: `non-JSON response (status ${res.status}). Cookie likely expired.`,
    };
  }
  if (!res.ok) {
    return {
      configured: true,
      status: res.status,
      responseHeaders,
      error: data?.error || text.slice(0, 300),
    };
  }
  return { configured: true, status: res.status, responseHeaders, data };
}

async function fetchOrg() {
  return call('/api/organizations/{org}');
}

async function fetchOrgs() {
  return call('/api/organizations');
}

async function fetchUsage() {
  return call('/api/organizations/{org}/usage');
}

async function fetchRateLimits() {
  return call('/api/organizations/{org}/rate_limits');
}

// Hitting any authenticated endpoint causes claude.ai to return rate-limit
// headers. chat_conversations_v2 is cheap and confirmed working.
async function probeRateLimitHeaders() {
  return call('/api/organizations/{org}/chat_conversations_v2?limit=1&offset=0&consistency=eventual');
}

// One-shot validation used by the setup wizard. Tests a (sessionKey, orgId)
// pair WITHOUT persisting them, by calling /api/organizations/{org} with the
// proposed cookie. Used by POST /api/setup/save to verify before storing in
// Keychain.
async function validateCredentials({ sessionKey, orgId, headers = {} }) {
  if (!sessionKey || !orgId) {
    return { ok: false, error: 'sessionKey and orgId are both required' };
  }
  const url = `${BASE}/api/organizations/${encodeURIComponent(orgId)}`;
  const h = buildHeaders();
  if (headers.clientSha) h['anthropic-client-sha'] = headers.clientSha;
  if (headers.deviceId) h['anthropic-device-id'] = headers.deviceId;
  if (headers.anonymousId) h['anthropic-anonymous-id'] = headers.anonymousId;
  let res;
  try {
    res = await fetch(url, {
      headers: { ...h, Cookie: `sessionKey=${sessionKey}` },
      redirect: 'manual',
    });
  } catch (err) {
    return { ok: false, error: `network: ${err.message}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'sessionKey is invalid or expired' };
  }
  if (res.status === 404) {
    return { ok: false, error: 'orgId not found for this sessionKey' };
  }
  if (!res.ok) {
    return { ok: false, error: `claude.ai returned HTTP ${res.status}` };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: 'unexpected response from claude.ai' };
  }
  return {
    ok: true,
    org: {
      name: data.name || null,
      tier: data.rate_limit_tier || null,
      email: data.contact_email || null,
      uuid: data.uuid || orgId,
    },
  };
}

// Best-effort extraction of rate-limit-ish fields from the org payload.
// claude.ai changes these often, so this is intentionally permissive.
function extractLimitInfo(org) {
  if (!org || typeof org !== 'object') return null;
  const out = {
    rateLimitTier: org.rate_limit_tier || org.subscription?.rate_limit_tier || null,
    capabilities: org.capabilities || null,
    settings: org.settings || null,
    raw: {},
  };
  for (const k of Object.keys(org)) {
    if (/rate|usage|limit|quota|reset|window/i.test(k)) {
      out.raw[k] = org[k];
    }
  }
  return out;
}

module.exports = {
  validateCredentials,
  fetchOrg,
  fetchOrgs,
  fetchUsage,
  fetchRateLimits,
  probeRateLimitHeaders,
  extractLimitInfo,
};
