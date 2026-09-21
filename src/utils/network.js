import os from 'os';
import dns from 'node:dns';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent } from 'undici';
import { BOORU_USER_AGENT, BROWSER_USER_AGENT } from '../config/constants.js';
import { logError, logInfo } from './logger.js';

// Cache for active Undici Dispatchers keyed by normalized proxy URL.
// Bounded on purpose: without a cap every proxy URL anyone tried pinned a
// dispatcher (and its sockets) for the life of the process, and /api/proxy/test
// is reachable without a token, so a LAN caller could mint entries at will.
const PROXY_AGENT_CACHE_LIMIT = 16;
const proxyAgentCache = new Map();

// Inserts an agent as the most recently used one and closes the least recently
// used entry once the cap is exceeded. Map iteration follows insertion order and
// cache hits re-insert their key, so the first key is always the coldest.
function rememberProxyAgent(cleanUrl, agent) {
  proxyAgentCache.set(cleanUrl, agent);
  if (proxyAgentCache.size <= PROXY_AGENT_CACHE_LIMIT) return;

  const oldestKey = proxyAgentCache.keys().next().value;
  const evicted = proxyAgentCache.get(oldestKey);
  proxyAgentCache.delete(oldestKey);
  // close() is graceful: requests already running on the agent keep their sockets
  Promise.resolve(evicted.close()).catch(() => {});
}

/**
 * Normalizes user-entered proxy strings into valid WHATWG URLs.
 * Supports:
 * - standard URLs: http://user:pass@host:port, socks5://host:port
 * - host:port -> http://host:port
 * - host:port:user:pass -> http://user:pass@host:port
 * - user:pass:host:port -> http://user:pass@host:port
 */
export function normalizeProxyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let clean = rawUrl.trim();
  if (!clean) return '';

  let protocol = 'http';
  const protoMatch = clean.match(/^([a-zA-Z0-9+.-]+):\/\//);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    clean = clean.slice(protoMatch[0].length);
  }

  // Already standard user:pass@host:port format
  if (clean.includes('@')) {
    return `${protocol}://${clean}`;
  }

  // Check for colon-separated formats: host:port:user:pass or user:pass:host:port
  const parts = clean.split(':');
  if (parts.length === 4) {
    // Case A: host:port:user:pass (part 1 is numeric port)
    if (/^\d+$/.test(parts[1]) && !/^\d+$/.test(parts[3])) {
      const [ip, port, user, pass] = parts;
      return `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}`;
    }
    // Case B: user:pass:host:port (part 3 is numeric port)
    if (/^\d+$/.test(parts[3]) && !/^\d+$/.test(parts[1])) {
      const [user, pass, ip, port] = parts;
      return `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}`;
    }
  }

  return `${protocol}://${clean}`;
}

/**
 * Returns or creates an Undici Dispatcher (ProxyAgent or Socks5ProxyAgent) for a given proxy URL
 * @param {string} proxyUrl - Proxy URL (http://, https://, socks5://, socks5h://, socks4://, socks://)
 * @returns {import('undici').Dispatcher|null}
 */
export function getProxyAgent(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string') return null;
  const cleanUrl = normalizeProxyUrl(proxyUrl);
  if (!cleanUrl) return null;

  const cached = proxyAgentCache.get(cleanUrl);
  if (cached) {
    // Re-inserting moves the key to the end of the LRU order, so a cache hit can
    // never be the entry the next insert evicts and closes
    proxyAgentCache.delete(cleanUrl);
    proxyAgentCache.set(cleanUrl, cached);
    return cached;
  }

  try {
    const parsed = new URL(cleanUrl);
    const proto = parsed.protocol.toLowerCase();
    let agent = null;

    if (proto === 'socks5:' || proto === 'socks5h:' || proto === 'socks:' || proto === 'socks4:') {
      // undici's Socks5ProxyAgent supports socks5/socks5h
      agent = new Socks5ProxyAgent(cleanUrl);
    } else if (proto === 'http:' || proto === 'https:') {
      agent = new ProxyAgent(cleanUrl);
    } else {
      logError('Proxy', `Неподдерживаемый протокол прокси: ${proto}`);
      return null;
    }

    rememberProxyAgent(cleanUrl, agent);
    return agent;
  } catch (err) {
    logError('Proxy', `Ошибка инициализации прокси ${cleanUrl}`, err);
    return null;
  }
}

/**
 * Identifies the Booru site from a given URL or hostname
 * @param {string} targetUrl
 * @returns {string|null}
 */
export function resolveSiteFromUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return null;
  try {
    const h = (targetUrl.includes('://') ? new URL(targetUrl).hostname : targetUrl).toLowerCase();
    if (h.includes('donmai.us')) return 'danbooru';
    if (h.includes('gelbooru.com')) return 'gelbooru';
    if (h.includes('rule34.xxx') || h.includes('paheal.net') || h.includes('paheal-cdn.net')) return 'rule34';
    if (h.includes('rule34video.com') || h.includes('boomio-cdn.com')) return 'rule34video';
    if (h.includes('yande.re')) return 'yandere';
    if (h.includes('konachan')) return 'konachan';
    if (h.includes('safebooru.org')) return 'safebooru';
    if (h.includes('xbooru.com')) return 'xbooru';
    if (h.includes('hypnohub.net')) return 'hypnohub';
    if (h.includes('tbib.org')) return 'tbib';
    if (h.includes('pawchive.pw') || h.includes('pawchive.st')) return 'pawchive';
    if (h.includes('kemono.cr') || h.includes('kemono.su') || h.includes('kemono.party')) return 'kemono';
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves the configured proxy URL for a site from settings
 * Priority: settings[site + 'Proxy'] -> settings.globalProxy -> ''
 * @param {string} site
 * @param {object} settings
 * @returns {string}
 */
export function getProxyForSite(site, settings) {
  if (!settings || typeof settings !== 'object') return '';
  if (site) {
    const specific = settings[`${site}Proxy`];
    if (typeof specific === 'string' && specific.trim()) {
      return normalizeProxyUrl(specific.trim());
    }
  }
  if (typeof settings.globalProxy === 'string' && settings.globalProxy.trim()) {
    return normalizeProxyUrl(settings.globalProxy.trim());
  }
  return '';
}

// ── SSRF guard ──────────────────────────────────────────────────────────────
// Every user-controlled URL that leaves this process (media proxy, ffmpeg input,
// AI embeddings, downloads) must pass through here first. It rejects non-http(s)
// schemes and any address that lands inside the local network or on a cloud
// metadata endpoint (169.254.169.254).
// The host checks read the URL literally, so `isSafeExternalUrlResolved` adds the
// name-based half for request-supplied URLs, and `fetchSafe` runs every redirect
// hop through the same checks. Rebinding (a resolver that answers differently
// between this check and the connect) stays out of reach either way.
const IPV4_LITERAL = /^(\d{1,3}(?:\.\d{1,3}){3})$/;

// `new URL` keeps the root dot of an FQDN, so "localhost." arrives with a trailing
// dot and must not be compared against "localhost" as-is
function normalizeHost(rawHost) {
  let host = (rawHost || '').toLowerCase();
  // Node strips IPv6 brackets already, but keep this defensive
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function isPrivateIpv4(octets) {
  if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return true;
  const [a, b, c] = octets;
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // private
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 0 && c === 0) return true;  // 192.0.0.0/24
  if (a === 192 && b === 168) return true;           // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                         // multicast + reserved
  return false;
}

// IPv6 literal -> 16 bytes, or null when the text does not parse. WHATWG URL
// prints IPv4-mapped addresses in hex (::ffff:7f00:1), but the dotted spelling
// has to be understood as well
function parseIpv6Bytes(text) {
  let value = text;
  const lastColon = value.lastIndexOf(':');
  if (lastColon === -1) return null;

  const tail = value.slice(lastColon + 1);
  if (tail.includes('.')) {
    const quad = tail.split('.').map(Number);
    if (quad.length !== 4 || quad.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    value = `${value.slice(0, lastColon + 1)}${((quad[0] << 8) | quad[1]).toString(16)}:${((quad[2] << 8) | quad[3]).toString(16)}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const readGroups = (part) => part ? part.split(':').map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : [];
  const head = readGroups(halves[0]);
  const tailGroups = halves.length === 2 ? readGroups(halves[1]) : [];

  let groups;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    if (head.length + tailGroups.length > 7) return null;
    groups = [...head, ...Array(8 - head.length - tailGroups.length).fill(0), ...tailGroups];
  }
  if (groups.some(g => Number.isNaN(g))) return null;

  const bytes = [];
  for (const g of groups) bytes.push(g >> 8, g & 0xff);
  return bytes;
}

// Ranges and transition prefixes that hide an address this guard rejects. Worth
// spelling out because the IPv4 target inside ::ffff:a.b.c.d, 64:ff9b::/96 (NAT64)
// and 2002::/16 (6to4) is written in hex, which a literal string comparison misses
function isUnsafeIpv6(host) {
  const bytes = parseIpv6Bytes(host);
  // Contains colons but does not parse: refuse rather than guess
  if (!bytes) return true;

  const zeroRange = (from, to) => bytes.slice(from, to).every(b => b === 0);
  const embeddedV4 = (offset) => isPrivateIpv4(bytes.slice(offset, offset + 4));

  if (zeroRange(0, 16)) return true;                                // ::
  if (zeroRange(0, 15) && bytes[15] === 1) return true;             // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true;                      // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true;                               // multicast
  // ::ffff:0:0/96 (IPv4-mapped) and ::/96 (IPv4-compatible)
  if (zeroRange(0, 10) && (bytes[10] === 0 || (bytes[10] === 0xff && bytes[11] === 0xff))) return embeddedV4(12);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return embeddedV4(12);
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return embeddedV4(2);

  return false;
}

export function isSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = normalizeHost(parsed.hostname);
  if (!host) return false;

  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return false;

  // IPv6 literal: the whole address space has to be classified, not only ::1 and
  // the unique-local/link-local prefixes
  if (host.includes(':')) return !isUnsafeIpv6(host);

  // WHATWG URL already normalizes decimal/hex/octal IPv4 (2130706433 -> 127.0.0.1)
  const literalV4 = host.match(IPV4_LITERAL);
  if (literalV4) return !isPrivateIpv4(literalV4[1].split('.').map(Number));

  // A single label is an intranet name ("router", "metadata"), never a public host
  return host.includes('.');
}

// Name-based half of the guard. The literal checks above cannot see where a
// hostname points, and an A record aimed at 127.0.0.1 or 169.254.169.254 passes
// them. IP literals are classified without resolving, and a resolver error or a
// timeout counts as unknown and lets the request through: the connection would
// fail on its own, while blocking would take every hostname down whenever the
// local resolver is briefly unavailable.
const HOST_LOOKUP_TIMEOUT_MS = 1000;
const HOST_VERDICT_TTL_MS = 60000;
const HOST_VERDICT_UNKNOWN_TTL_MS = 15000;
const HOST_VERDICT_CACHE_MAX = 500;
const hostVerdictCache = new Map();

function lookupHostAddresses(host) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), HOST_LOOKUP_TIMEOUT_MS);
    dns.lookup(host, { all: true }, (err, addresses) => finish(err ? null : addresses));
  });
}

function isPrivateAddress(address) {
  if (address.includes(':')) return isUnsafeIpv6(normalizeHost(address));
  const literalV4 = address.match(IPV4_LITERAL);
  return literalV4 ? isPrivateIpv4(literalV4[1].split('.').map(Number)) : true;
}

// Cached per hostname. The promise itself is cached so a gallery's worth of
// parallel thumbnail requests shares one resolver call instead of one per card.
function hostVerdict(host) {
  const cached = hostVerdictCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = { promise: null, expiresAt: Infinity };
  entry.promise = lookupHostAddresses(host).then((addresses) => {
    const resolved = Array.isArray(addresses);
    entry.expiresAt = Date.now() + (resolved ? HOST_VERDICT_TTL_MS : HOST_VERDICT_UNKNOWN_TTL_MS);
    if (!resolved) return null;
    return addresses.some(a => isPrivateAddress(a.address)) ? 'private' : 'public';
  });

  if (hostVerdictCache.size >= HOST_VERDICT_CACHE_MAX) {
    hostVerdictCache.delete(hostVerdictCache.keys().next().value);
  }
  hostVerdictCache.set(host, entry);
  return entry.promise;
}

/**
 * `isSafeExternalUrl` plus the resolved addresses of the hostname, for the entry
 * points that take a URL straight from the request (media proxy, ffmpeg routes,
 * server-side download): the literal check alone accepts an attacker-controlled
 * domain whose A record points into the local network.
 * @returns {Promise<boolean>}
 */
export async function isSafeExternalUrlResolved(rawUrl) {
  if (!isSafeExternalUrl(rawUrl)) return false;

  const host = normalizeHost(new URL(rawUrl).hostname);
  if (host.includes(':') || IPV4_LITERAL.test(host)) return true;

  const verdict = await hostVerdict(host);
  return verdict !== 'private';
}

export function safeJsonParse(text, fallback = null) {
  if (!text || typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<') || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return fallback;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return fallback;
  }
}

// Node 20.3+ can merge signals natively. On older runtimes fall back to
// forwarding each abort manually - AGENTS.md still advertises Node 18 support.
function combineAbortSignals(signals) {
  const list = signals.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(list);
  }

  const combined = new AbortController();
  for (const source of list) {
    if (source.aborted) {
      try { combined.abort(source.reason); } catch { combined.abort(); }
      return combined.signal;
    }
    source.addEventListener('abort', () => {
      try { combined.abort(source.reason); } catch { combined.abort(); }
    }, { once: true });
  }
  return combined.signal;
}

// Ambient deadline for a subtree of work. `withDeadline` in parsers/index.js races
// each site fetch against a timer; before this existed the losing fetch kept running
// to completion, burning sockets the deadline was supposed to free up. Threading an
// explicit signal through every parser signature would be invasive, so the deadline
// is published here and fetchSafe picks it up from the async context -
// AsyncLocalStorage propagates across await, so it reaches nested parser calls too.
const deadlineStorage = new AsyncLocalStorage();

export function runWithDeadlineSignal(signal, fn) {
  if (!signal) return fn();
  // Nested deadlines must compose: an outer withDeadline() is still in the store,
  // and overwriting it would let the inner work outlive the outer deadline
  const parent = deadlineStorage.getStore();
  const merged = parent ? combineAbortSignals([parent, signal]) : signal;
  return deadlineStorage.run(merged, fn);
}

// Statuses that must not carry a body, so a wrapped Response would be rejected
const BODYLESS_STATUS = new Set([101, 103, 204, 205, 304]);

// Redirects are re-issued from here, so the chain needs its own bound
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

// fetchSafe returns as soon as the headers arrive, so a timeout that stops there
// leaves the socket in undici's pool until the stalled body finally finishes -
// or never does. Wrapping the stream keeps the timer alive until the last chunk.
// Returns the original response when there is no body to read.
function withBodyTimeout(response, timeoutMs, onSettled) {
  if (!response.body || BODYLESS_STATUS.has(response.status)) {
    onSettled();
    return response;
  }

  const reader = response.body.getReader();
  const wrapped = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          onSettled();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        onSettled();
        controller.error(err);
      }
    },
    cancel(reason) {
      onSettled();
      // Release the upstream chunk stream too, otherwise the connection lingers
      reader.cancel(reason).catch(() => {});
    }
  });

  return new Response(wrapped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

/**
 * Fetch with proxy support, a header timeout and - unless the caller opts out -
 * a timeout that also covers reading the body.
 *
 * Options beyond the standard fetch ones:
 *   timeout     - ms until the response headers must arrive (default 25000)
 *   bodyTimeout - ms allowed for reading the body (defaults to `timeout`)
 *   streamBody  - pass true for responses that are piped straight out (video
 *                 ranges, downloads): no body timer is armed for those
 *   settings / site / proxy - used to resolve the proxy dispatcher
 *
 * Redirects are followed here, hop by hop, instead of by undici (which follows
 * them blindly): every Location goes through the SSRF guard before it is used.
 */
export async function fetchSafe(url, options = {}) {
  const {
    timeout = 25000,
    bodyTimeout,
    streamBody = false,
    signal: externalSignal,
    dispatcher: externalDispatcher,
    settings,
    site,
    proxy,
    ...requestOptions
  } = options;

  const controller = new AbortController();
  // A deadline set by an upstream withDeadline() also cancels this request
  const ambientSignal = deadlineStorage.getStore();
  const signal = combineAbortSignals([controller.signal, externalSignal, ambientSignal]);

  let headerTimer = null;
  let bodyTimer = null;
  const abort = () => {
    try { controller.abort(); } catch {}
  };
  const stopTimers = () => {
    if (headerTimer) clearTimeout(headerTimer);
    if (bodyTimer) clearTimeout(bodyTimer);
    headerTimer = null;
    bodyTimer = null;
  };

  try {
    // Resolve proxy dispatcher
    let dispatcher = externalDispatcher || null;
    if (!dispatcher) {
      let proxyUrl = proxy || '';
      if (!proxyUrl && settings) {
        proxyUrl = getProxyForSite(site || resolveSiteFromUrl(url), settings);
      }
      if (proxyUrl) {
        dispatcher = getProxyAgent(proxyUrl);
      }
    }

    // A caller that asked for 'manual' or 'error' keeps undici's own semantics
    const followRedirects = requestOptions.redirect === undefined || requestOptions.redirect === 'follow';
    let requestUrl = url;
    let requestMethod = requestOptions.method ?? 'GET';
    let requestBody = requestOptions.body;
    let requestHeaders = { ...(requestOptions.headers || {}) };
    const requestExtras = { ...requestOptions };
    delete requestExtras.redirect;
    delete requestExtras.method;
    delete requestExtras.body;
    delete requestExtras.headers;

    for (let hop = 0; ; hop++) {
      const isDanbooru = typeof requestUrl === 'string' && requestUrl.includes('donmai.us');
      const isKemonoApi = typeof requestUrl === 'string' && (requestUrl.includes('kemono.cr/api/') || requestUrl.includes('kemono.su/api/') || requestUrl.includes('coomer.st/api/'));
      const defaultUa = isDanbooru ? BOORU_USER_AGENT : BROWSER_USER_AGENT;
      const defaultAccept = isKemonoApi ? 'text/css' : (isDanbooru ? 'application/json, text/xml, text/html, */*' : '*/*');

      const fetchOptions = {
        ...requestExtras,
        method: requestMethod,
        signal,
        headers: {
          'User-Agent': defaultUa,
          'Accept': defaultAccept,
          ...requestHeaders
        }
      };
      if (followRedirects) fetchOptions.redirect = 'manual';
      if (requestBody !== undefined) fetchOptions.body = requestBody;

      // Kemono's DDoS-Guard scraper protection strictly requires Accept: text/css for all API endpoints.
      // Overriding any composite Accept headers prevents HTTP 403 Forbidden.
      if (isKemonoApi) {
        fetchOptions.headers['Accept'] = 'text/css';
      }

      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      headerTimer = setTimeout(abort, timeout);
      const response = await undiciFetch(requestUrl, fetchOptions);
      stopTimers();

      const location = followRedirects && REDIRECT_STATUSES.has(response.status)
        ? response.headers.get('location')
        : null;

      if (location) {
        const nextUrl = new URL(location, requestUrl).toString();
        const bodyReplayable = requestBody === undefined || requestBody === null || typeof requestBody === 'string'
          || Buffer.isBuffer(requestBody) || requestBody instanceof Uint8Array || requestBody instanceof URLSearchParams;
        // 303 and the POST -> GET of 301/302 drop the body; 307/308 re-send it
        const dropsBody = response.status === 303
          || ((response.status === 301 || response.status === 302) && requestMethod !== 'GET' && requestMethod !== 'HEAD');

        if (hop >= MAX_REDIRECTS) {
          await discardResponse(response);
          logError('Fetch', `Слишком много редиректов: ${url}`);
          return new Response('Слишком много редиректов', { status: 502 });
        }

        if (!(await isSafeExternalUrlResolved(nextUrl))) {
          await discardResponse(response);
          logError('Fetch', `Редирект на внутренний адрес заблокирован: ${nextUrl}`);
          return new Response('URL не разрешён', { status: 403 });
        }

        // Nothing left to follow with: a stream body cannot be sent twice, so the
        // 3xx is handed back to the caller as the upstream's answer
        if (!dropsBody && !bodyReplayable) return response;

        // Credentials for the original host must not travel to another one
        if (new URL(nextUrl).origin !== new URL(requestUrl).origin) {
          for (const name of Object.keys(requestHeaders)) {
            if (/^(authorization|cookie)$/i.test(name)) delete requestHeaders[name];
          }
        }
        if (dropsBody) {
          requestMethod = 'GET';
          requestBody = undefined;
        }
        requestUrl = nextUrl;

        await discardResponse(response);
        continue;
      }

      if (streamBody) return response;

      const bodyDeadline = bodyTimeout ?? timeout;
      bodyTimer = setTimeout(abort, bodyDeadline);
      return withBodyTimeout(response, bodyDeadline, () => {
        if (bodyTimer) clearTimeout(bodyTimer);
        bodyTimer = null;
      });
    }
  } catch (err) {
    stopTimers();
    throw err;
  }
}

// undici keeps a connection checked out until the response body is consumed or
// cancelled. Every rejected response - a 404 fallback candidate, a non-ok status,
// a POST whose result we do not care about - has to be released or the pool runs
// dry during gallery scrolling.
export async function discardResponse(response) {
  if (!response || !response.body) return;
  try {
    await response.body.cancel();
  } catch {}
}

// Single host -> Referer map (used by the proxy and FFmpeg)
export function resolveSiteReferer(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const h = parsed.hostname;
    if (h.includes('rule34video.com') || h.includes('boomio-cdn.com')) return 'https://rule34video.com/';
    if (h.includes('paheal.net') || h.includes('paheal-cdn.net')) return 'https://rule34.paheal.net/';
    if (h.includes('rule34.xxx')) return 'https://rule34.xxx/';
    if (h.includes('donmai.us')) return 'https://danbooru.donmai.us/';
    if (h.includes('yande.re')) return 'https://yande.re/';
    if (h.includes('konachan')) return 'https://konachan.com/';
    if (h.includes('gelbooru.com')) return 'https://gelbooru.com/';
    if (h.includes('safebooru.org')) return 'https://safebooru.org/';
    if (h.includes('xbooru.com')) return 'https://xbooru.com/';
    if (h.includes('hypnohub.net')) return 'https://hypnohub.net/';
    if (h.includes('tbib.org')) return 'https://tbib.org/';
    if (h.includes('pawchive.pw') || h.includes('pawchive.st')) return 'https://pawchive.pw/';
    if (h.includes('kemono.cr') || h.includes('kemono.su') || h.includes('kemono.party')) return 'https://kemono.cr/';
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'https://danbooru.donmai.us/';
  }
}

export function getFfmpegHeaders(targetUrl, currentSettings = {}) {
  let authHeader = '';
  let isDanbooru = false;
  try {
    const parsed = new URL(targetUrl);
    isDanbooru = parsed.hostname.includes('donmai.us');
    if (isDanbooru && currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
      authHeader = `Authorization: Basic ${Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64')}\r\n`;
    }
  } catch {}
  const ua = isDanbooru ? BOORU_USER_AGENT : BROWSER_USER_AGENT;
  return `User-Agent: ${ua}\r\nReferer: ${resolveSiteReferer(targetUrl)}\r\n${authHeader}`;
}

export function resolvePreviewUrl(previewUrl, fileUrl, sampleUrl, isVideo) {
  const isVideoExt = (url) => {
    if (!url) return false;
    const clean = url.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mkv') || clean.endsWith('.mov') || clean.endsWith('.m4v');
  };

  if (!previewUrl || isVideoExt(previewUrl)) {
    if (isVideo && (fileUrl || sampleUrl)) {
      return `/api/video-thumbnail?url=${encodeURIComponent(fileUrl || sampleUrl)}`;
    }
    return (!isVideo && sampleUrl && !isVideoExt(sampleUrl)) ? sampleUrl : (fileUrl || '');
  }
  return previewUrl;
}

export function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];

  const isVirtualOrVpn = (name) => {
    const lower = name.toLowerCase();
    return (
      lower.includes('radmin') ||
      lower.includes('hamachi') ||
      lower.includes('tailscale') ||
      lower.includes('zerotier') ||
      lower.includes('virtualbox') ||
      lower.includes('vmware') ||
      lower.includes('vbox') ||
      lower.includes('vethernet') ||
      lower.includes('hyper-v') ||
      lower.includes('wsl') ||
      lower.includes('docker') ||
      lower.includes('teredo') ||
      lower.includes('loopback') ||
      lower.includes('tap') ||
      lower.includes('tun') ||
      lower.includes('nordlynx') ||
      lower.includes('wireguard')
    );
  };

  const isPrivateIp = (ip) => {
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 1;
    return 0;
  };

  for (const name of Object.keys(nets)) {
    const isVpn = isVirtualOrVpn(name);
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const priority = isPrivateIp(net.address);
        candidates.push({
          name,
          address: net.address,
          isVpn,
          priority: isVpn ? -1 : priority
        });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  if (candidates.length > 0) {
    return candidates[0].address;
  }
  return 'localhost';
}
