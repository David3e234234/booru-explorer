import os from 'os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent } from 'undici';
import { BOORU_USER_AGENT, BROWSER_USER_AGENT } from '../config/constants.js';
import { logError, logInfo } from './logger.js';

// Cache for active Undici Dispatchers keyed by normalized proxy URL
const proxyAgentCache = new Map();

/**
 * Returns or creates an Undici Dispatcher (ProxyAgent or Socks5ProxyAgent) for a given proxy URL
 * @param {string} proxyUrl - Proxy URL (http://, https://, socks5://, socks5h://, socks4://, socks://)
 * @returns {import('undici').Dispatcher|null}
 */
export function getProxyAgent(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string') return null;
  let cleanUrl = proxyUrl.trim();
  if (!cleanUrl) return null;

  // Add default protocol if missing (e.g. 127.0.0.1:8080 -> http://127.0.0.1:8080)
  if (!cleanUrl.includes('://')) {
    cleanUrl = `http://${cleanUrl}`;
  }

  if (proxyAgentCache.has(cleanUrl)) {
    return proxyAgentCache.get(cleanUrl);
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

    proxyAgentCache.set(cleanUrl, agent);
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
      return specific.trim();
    }
  }
  if (typeof settings.globalProxy === 'string' && settings.globalProxy.trim()) {
    return settings.globalProxy.trim();
  }
  return '';
}

// ── SSRF guard ──────────────────────────────────────────────────────────────
// Every user-controlled URL that leaves this process (media proxy, ffmpeg input,
// AI embeddings, downloads) must pass through here first. It rejects non-http(s)
// schemes and any address that lands inside the local network or on a cloud
// metadata endpoint (169.254.169.254).
// Limitation: the hostname is checked literally, so a DNS name that resolves to
// 127.0.0.1 (rebinding / attacker-controlled A record) is not caught here.
export function isSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  let host = (parsed.hostname || '').toLowerCase();
  // Node strips IPv6 brackets already, but keep this defensive
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return false;

  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return false;

  // IPv6: loopback, unspecified, unique-local, link-local
  if (host === '::1' || host === '::' || host === '0.0.0.0') return false;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return false;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return false;

  // WHATWG URL already normalizes decimal/hex/octal IPv4 (2130706433 -> 127.0.0.1)
  const plainV4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const mappedV4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  let octets = null;
  if (plainV4) octets = [plainV4[1], plainV4[2], plainV4[3], plainV4[4]].map(Number);
  else if (mappedV4) octets = mappedV4[1].split('.').map(Number);

  if (octets) {
    if (octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return false;
    const [a, b, c] = octets;
    if (a === 0) return false;                          // 0.0.0.0/8
    if (a === 10) return false;                         // private
    if (a === 127) return false;                        // loopback
    if (a === 169 && b === 254) return false;           // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;  // private
    if (a === 192 && b === 0 && c === 0) return false;  // 192.0.0.0/24
    if (a === 192 && b === 168) return false;           // private
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false;                         // multicast + reserved
  }

  return true;
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
    const isDanbooru = typeof url === 'string' && url.includes('donmai.us');
    const defaultUa = isDanbooru ? BOORU_USER_AGENT : BROWSER_USER_AGENT;

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

    const fetchOptions = {
      ...requestOptions,
      signal,
      headers: {
        'User-Agent': defaultUa,
        'Accept': 'application/json, text/xml, text/html, */*',
        ...(requestOptions.headers || {})
      }
    };

    if (dispatcher) {
      fetchOptions.dispatcher = dispatcher;
    }

    headerTimer = setTimeout(abort, timeout);
    const response = await undiciFetch(url, fetchOptions);
    stopTimers();

    if (streamBody) return response;

    const bodyDeadline = bodyTimeout ?? timeout;
    bodyTimer = setTimeout(abort, bodyDeadline);
    return withBodyTimeout(response, bodyDeadline, () => {
      if (bodyTimer) clearTimeout(bodyTimer);
      bodyTimer = null;
    });
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
    if (h.includes('pawchive.pw') || h.includes('pawchive.st')) return 'https://pawchive.pw/';
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'https://danbooru.donmai.us/';
  }
}

export function getFfmpegHeaders(targetUrl, currentSettings = {}) {
  let authHeader = '';
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.includes('donmai.us') && currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
      authHeader = `Authorization: Basic ${Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64')}\r\n`;
    }
  } catch {}
  return `User-Agent: ${BROWSER_USER_AGENT}\r\nReferer: ${resolveSiteReferer(targetUrl)}\r\n${authHeader}`;
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
