import { fetchSafe, discardResponse, safeJsonParse } from '../utils/network.js';
import { BROWSER_USER_AGENT } from '../config/constants.js';
import { logInfo, logError } from '../utils/logger.js';

// Exchanges board credentials for a session cookie on the Kemono-family sites.
// A gallery fires dozens of parallel requests, so a login per request would trip
// the upstream anti-flood: every result is cached, single-flighted and rate-limited.

// Kemono answers a JSON login on its API. Pawchive has no such route (404) and
// only the HTML form, which answers 302 back to the login page on bad credentials.
const LOGIN_ENDPOINTS = {
  kemono: {
    url: 'https://kemono.cr/api/v1/authentication/login',
    encode: (login, password) => JSON.stringify({ username: login, password })
  },
  pawchive: {
    url: 'https://pawchive.pw/account/login',
    encode: (login, password) => new URLSearchParams({ username: login, password, location: '/artists' }).toString()
  }
};

const LOGIN_TIMEOUT_MS = 10000;
const SESSION_TTL_MS = 50 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const MIN_LOGIN_INTERVAL_MS = 20 * 1000;
const MAX_CACHE_ENTRIES = 64;

const sessionCache = new Map();
const inflightLogins = new Map();
const lastLoginAt = new Map();

function readSessionCookie(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const cookie of raw) {
    const match = String(cookie).match(/(?:^|;\s*)session=([^;]+)/i);
    if (match && match[1].trim()) return match[1].trim();
  }
  return '';
}

/**
 * Accepts a bare token, `session=token` or a pasted cookie jar and returns the
 * bare token. The parsers already had three divergent copies of this logic.
 */
export function extractSessionToken(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const match = value.match(/(?:^|;\s*)session=([^;]+)/i);
  const token = (match ? match[1] : value).trim().replace(/^["']|["']$/g, '');
  return token.startsWith('session=') ? '' : token;
}

function cacheKey(site, login) {
  return `${site}:${login}`;
}

function remember(key, entry) {
  if (sessionCache.size >= MAX_CACHE_ENTRIES) {
    sessionCache.delete(sessionCache.keys().next().value);
  }
  sessionCache.set(key, entry);
}

function isFresh(entry) {
  return Boolean(entry) && entry.expiresAt > Date.now();
}


async function performLogin(site, login, password, settings) {
  const endpoint = LOGIN_ENDPOINTS[site];
  const headers = {
    'Content-Type': site === 'pawchive' ? 'application/x-www-form-urlencoded' : 'application/json',
    'User-Agent': BROWSER_USER_AGENT
  };
  // Kemono's DDoS-Guard rejects anything but this Accept value on /api routes.
  if (site === 'kemono') headers.Accept = 'text/css';

  let response;
  try {
    response = await fetchSafe(endpoint.url, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: endpoint.encode(login, password),
      timeout: LOGIN_TIMEOUT_MS,
      settings,
      site
    });
  } catch (err) {
    // Never interpolate credentials or the response body into the message
    logError('SiteSession', `Не удалось выполнить вход на ${site}: ${err.message}`);
    return { ok: false, reason: 'network' };
  }

  try {
    if (site === 'kemono') {
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const detail = typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`;
        return { ok: false, reason: 'credentials', detail };
      }
      const token = readSessionCookie(response);
      if (!token) return { ok: false, reason: 'no-session' };
      const data = safeJsonParse(await response.text(), null);
      return { ok: true, token, username: data?.username || login };
    }

    // Pawchive: the HTML form answers 302 either way. A rejected login bounces
    // back to the form; a successful one goes to the requested location.
    const location = String(response.headers.get('location') || '');
    const token = readSessionCookie(response);
    if (response.status >= 300 && response.status < 400 && /\/account\/login/.test(location)) {
      return { ok: false, reason: 'credentials', detail: 'Username or password is incorrect.' };
    }
    if (response.status >= 300 && response.status < 400 && token) {
      return { ok: true, token, username: login };
    }
    return { ok: false, reason: 'no-session' };
  } finally {
    await discardResponse(response);
  }
}

async function loginOnce(site, login, password, settings) {
  const key = cacheKey(site, login);
  const pending = inflightLogins.get(key);
  if (pending) return pending;

  const attempt = (async () => {
    // A flood-guard retry storm is worse than a slightly stale session, so the
    // interval is enforced even after a completed attempt.
    const sinceLast = Date.now() - (lastLoginAt.get(key) || 0);
    if (sinceLast < MIN_LOGIN_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, MIN_LOGIN_INTERVAL_MS - sinceLast));
    }
    lastLoginAt.set(key, Date.now());
    return performLogin(site, login, password, settings);
  })().finally(() => inflightLogins.delete(key));

  inflightLogins.set(key, attempt);
  return attempt;
}

/**
 * Returns `{ token, username }` for a board session.
 * An explicit session token always wins over stored credentials, so an operator
 * can still pin a token when the password path is unwanted.
 */
export async function resolveSiteSession(site, settings = {}, { force = false } = {}) {
  const explicit = extractSessionToken(settings[`${site}Session`]);
  if (explicit) return { token: explicit, username: '' };

  const login = String(settings[`${site}Login`] || '').trim();
  const password = String(settings[`${site}Password`] || '');
  if (!login || !password) return { token: '', username: '' };

  const key = cacheKey(site, login);
  if (!force) {
    const cached = sessionCache.get(key);
    if (isFresh(cached)) {
      // The reason is carried over from the cached verdict, otherwise a second
      // call after a rejected login reports nothing and the settings modal
      // cannot tell the user that the password is wrong.
      if (cached.value?.ok) {
        return { token: cached.value.token, username: cached.value.username };
      }
      return { token: '', username: '', reason: cached.value?.reason, detail: cached.value?.detail || '' };
    }
  }

  const result = await loginOnce(site, login, password, settings);
  remember(key, {
    value: result,
    // A rejection is cached too, otherwise a wrong password in the settings
    // modal would re-attempt a login on every gallery request.
    expiresAt: Date.now() + (result.ok ? SESSION_TTL_MS : FAILURE_TTL_MS)
  });

  if (result.ok) {
    logInfo('SiteSession', `${site}: вход выполнен как ${result.username}`);
    return { token: result.token, username: result.username };
  }
  return { token: '', username: '', reason: result.reason, detail: result.detail || '' };
}

/**
 * Drops a cached session after an upstream 401 so the next call re-authenticates
 * with the stored credentials instead of replaying a dead token.
 */
export function invalidateSiteSession(site, settings = {}) {
  const login = String(settings[`${site}Login`] || '').trim();
  if (!login) return;
  sessionCache.delete(cacheKey(site, login));
  lastLoginAt.delete(cacheKey(site, login));
}

export function clearSiteSessionCache() {
  sessionCache.clear();
  inflightLogins.clear();
  lastLoginAt.clear();
}
