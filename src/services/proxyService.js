import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { BROWSER_USER_AGENT, BOORU_USER_AGENT } from '../config/constants.js';
import { getSettings } from './storageService.js';
import { resolveSiteReferer, fetchSafe, isSafeExternalUrlResolved, discardResponse } from '../utils/network.js';
import { logError, logInfo } from '../utils/logger.js';
import { isDanbooruCredentialHost, sanitizeLogUrl } from '../utils/hostPolicy.js';
import { parseRequestAuth, resolveRequestSettings } from '../utils/settingsValidation.js';
import {
  detectImageType,
  imageCachePath,
  isValidImageBuffer,
  readCacheFileMime,
  touchCacheFile,
  writeCacheFileAtomic
} from './imageCacheService.js';

export { isValidImageBuffer } from './imageCacheService.js';

// Max image size that gets buffered into memory and written to the disk cache
const MAX_CACHED_IMAGE_BYTES = 30 * 1024 * 1024;

// Upstream timeout with headroom for retries while the source throttles
const PROXY_ABORT_MS = 35000;

// Deduplicate concurrent requests for the same image (thundering herd)
const inflightImages = new Map();

function buildUpstreamHeaders(targetUrl, isImage, currentSettings) {
  const isBrowserTarget = targetUrl.includes('rule34video.com') || targetUrl.includes('boomio-cdn.com') || targetUrl.includes('rule34.xxx') || targetUrl.includes('paheal') || targetUrl.includes('gelbooru.com') || targetUrl.includes('xbooru.com') || targetUrl.includes('hypnohub.net') || targetUrl.includes('tbib.org') || targetUrl.includes('pawchive.pw') || targetUrl.includes('pawchive.st') || targetUrl.includes('kemono.cr') || targetUrl.includes('kemono.su') || targetUrl.includes('booru.org');
  const headers = {
    'User-Agent': isBrowserTarget ? BROWSER_USER_AGENT : BOORU_USER_AGENT,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': isImage ? 'image' : 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'Referer': resolveSiteReferer(targetUrl)
  };

  try {
    const parsed = new URL(targetUrl);
    if (isDanbooruCredentialHost(parsed.hostname) && currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64');
    }
  } catch {}

  return headers;
}

// Exhaustive smart fallback over alternative CDN hosts, paths (/samples/ <-> /images/)
// and extensions (jpg, png, jpeg, webp, gif, mp4, webm) on 404
function build404FallbackCandidates(targetUrl) {
  const candidates = [];
  const pushCandidate = (c) => {
    if (c && c !== targetUrl && !candidates.includes(c)) candidates.push(c);
  };
  const expandHosts = (hosts, basePaths, targetExts) => {
    for (const host of hosts) {
      for (const bPath of basePaths) {
        const pathWithoutExt = bPath.replace(/\.[a-zA-Z0-9]+$/, '');
        for (const ext of targetExts) {
          pushCandidate(`${host}${pathWithoutExt}${ext}`);
        }
      }
    }
  };

  const imageExts = ['.jpg', '.png', '.jpeg', '.webp', '.gif'];
  const videoExts = ['.mp4', '.webm'];

  if (targetUrl.includes('rule34.xxx')) {
    const cdnHosts = ['https://api-cdn.rule34.xxx', 'https://us.rule34.xxx', 'https://wimg.rule34.xxx', 'https://api-cdn-mp4.rule34.xxx'];
    const isVid = targetUrl.endsWith('.mp4') || targetUrl.endsWith('.webm') || targetUrl.includes('api-cdn-mp4');
    const targetExts = isVid ? videoExts : imageExts;

    const basePaths = [];
    const cleanNoHost = targetUrl.replace(/https?:\/\/[a-zA-Z0-9.-]+\.rule34\.xxx/i, '');
    basePaths.push(cleanNoHost);
    if (cleanNoHost.includes('/samples/')) {
      basePaths.push(cleanNoHost.replace('/samples/', '/images/').replace('sample_', ''));
    } else if (cleanNoHost.includes('/images/')) {
      const matchDirHash = cleanNoHost.match(/\/images\/+(\d+)\/([a-f0-9]+)\.[a-z0-9]+/i);
      if (matchDirHash) {
        basePaths.push(`/samples/${matchDirHash[1]}/sample_${matchDirHash[2]}.jpg`);
      }
    }
    expandHosts(cdnHosts, basePaths, targetExts);
  } else if (targetUrl.includes('gelbooru.com')) {
    const gelbooruHosts = ['https://img3.gelbooru.com', 'https://img2.gelbooru.com', 'https://img1.gelbooru.com', 'https://video.gelbooru.com'];
    const isVid = targetUrl.endsWith('.mp4') || targetUrl.endsWith('.webm');
    const cleanNoHost = targetUrl.replace(/https?:\/\/[a-zA-Z0-9.-]+\.gelbooru\.com/i, '');
    expandHosts(gelbooruHosts, [cleanNoHost], isVid ? videoExts : imageExts);
  } else if (targetUrl.includes('paheal')) {
    const pahealHosts = ['https://paheal-cdn.net', 'https://rule34.paheal.net', 'https://img.paheal.net'];
    const isVid = targetUrl.endsWith('.mp4') || targetUrl.endsWith('.webm');
    const cleanNoHost = targetUrl.replace(/https?:\/\/[a-zA-Z0-9.-]+(?:paheal\.net|paheal-cdn\.net)/i, '');
    expandHosts(pahealHosts, [cleanNoHost], isVid ? videoExts : imageExts);
  } else if (targetUrl.includes('pawchive.pw') || targetUrl.includes('pawchive.st')) {
    const cleanNoQuery = targetUrl.split('?')[0];
    const isVid = /\.(mp4|webm|mov|m4v|mkv)$/i.test(cleanNoQuery);
    if (!isVid) {
      if (cleanNoQuery.includes('file.pawchive.pw/data/')) {
        pushCandidate(cleanNoQuery.replace('file.pawchive.pw/data/', 'img.pawchive.pw/thumbnail/data/'));
      } else if (cleanNoQuery.includes('img.pawchive.pw/thumbnail/data/')) {
        pushCandidate(cleanNoQuery.replace('img.pawchive.pw/thumbnail/data/', 'file.pawchive.pw/data/'));
      }
    } else if (cleanNoQuery.includes('img.pawchive.pw/thumbnail/data/')) {
      pushCandidate(cleanNoQuery.replace('img.pawchive.pw/thumbnail/data/', 'file.pawchive.pw/data/'));
    }
  } else if (targetUrl.includes('kemono.cr') || targetUrl.includes('kemono.su')) {
    const cleanNoQuery = targetUrl.split('?')[0];
    const isVid = /\.(mp4|webm|mov|m4v|mkv)$/i.test(cleanNoQuery);
    const kemonoNodes = ['https://n1.kemono.cr', 'https://n2.kemono.cr', 'https://n3.kemono.cr', 'https://n4.kemono.cr'];
    const matchedNode = kemonoNodes.find(n => targetUrl.startsWith(n));

    // For images, prioritize DDoS-Guard CDN thumbnail first (bypasses ISP blocks on n1-n4)
    if (!isVid && cleanNoQuery.includes('/data/')) {
      const dataPath = cleanNoQuery.slice(cleanNoQuery.indexOf('/data/'));
      pushCandidate(`https://img.kemono.cr/thumbnail${dataPath}`);
    }

    if (matchedNode) {
      for (const altNode of kemonoNodes) {
        if (altNode !== matchedNode) {
          pushCandidate(targetUrl.replace(matchedNode, altNode));
        }
      }
    }

    if (!isVid && cleanNoQuery.includes('img.kemono.cr/thumbnail/data/')) {
      const dataPath = cleanNoQuery.slice(cleanNoQuery.indexOf('/data/'));
      for (const node of kemonoNodes) {
        pushCandidate(`${node}${dataPath}`);
      }
    }
  } else if (targetUrl.includes('booru.org')) {
    const cleanNoQuery = targetUrl.split('?')[0];
    const pathNoExt = cleanNoQuery.replace(/\.[a-zA-Z0-9]+$/, '');
    for (const ext of imageExts) {
      pushCandidate(`${pathNoExt}${ext}`);
    }
  }

  return candidates;
}

const EXTENSION_MEDIA_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska'
};

function isAllowedMediaType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!type || type === 'application/octet-stream') return false;
  if (type.startsWith('image/')) return type !== 'image/svg+xml';
  return type.startsWith('video/') || type.startsWith('audio/');
}

function resolveSafeMediaType(response, targetUrl) {
  const upstreamType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (upstreamType.startsWith('text/') || upstreamType === 'application/javascript' || upstreamType === 'application/xhtml+xml') {
    return null;
  }
  if (isAllowedMediaType(upstreamType)) return upstreamType;
  const cleanPath = String(targetUrl || '').split('?')[0].split('#')[0].toLowerCase();
  return EXTENSION_MEDIA_TYPES[path.extname(cleanPath)] || null;
}

async function readBodyWithLimit(response, maxBytes) {
  const declaredLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await discardResponse(response);
    const err = new Error('Медиафайл превышает допустимый размер');
    err.statusCode = 413;
    throw err;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        const err = new Error('Медиафайл превышает допустимый размер');
        err.statusCode = 413;
        throw err;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

async function tryFetch(url, headers, signal, settings) {
  // The body is piped straight to the client - a full-length video is far slower
  // than any sane timeout - so the caller's AbortController owns the deadline
  // here and no body timer is armed
  return fetchSafe(url, {
    headers,
    redirect: 'follow',
    signal,
    settings,
    timeout: PROXY_ABORT_MS,
    streamBody: true
  });
}

// Sources like rule34video answer 429 to a burst of Range requests for one video.
// Retry such responses after a pause instead of failing the player right away
const RETRYABLE_STATUSES = new Set([429, 502, 503]);
const UPSTREAM_COOLDOWN_MS = 3000;
const upstreamCooldown = new Map();

function pruneUpstreamCooldown() {
  const now = Date.now();
  for (const [url, until] of upstreamCooldown) {
    if (until < now) upstreamCooldown.delete(url);
  }
}

// Shared by every proxy path: fetch, and on 404 walk the alternative CDN hosts /
// extensions. Any response that is not adopted must have its body released -
// undici keeps the socket checked out until the body is consumed or cancelled,
// so a leaking fallback loop exhausts the pool during gallery scroll
async function fetchWith404Fallback(url, headers, signal, settings, options = {}) {
  const { headersFor = null, shouldFallback = (r) => r && r.status === 404 } = options;

  let response = null;
  let initialError = null;
  try {
    response = await fetchUpstreamWithRetry(url, headers, signal, settings);
  } catch (err) {
    initialError = err;
  }

  if (response && !shouldFallback(response)) return { response, effectiveUrl: url };

  for (const altUrl of build404FallbackCandidates(url)) {
    if (signal?.aborted) break;
    let altResp = null;
    try {
      altResp = await tryFetch(altUrl, headersFor ? headersFor(altUrl) : headers, signal, settings);
      if (altResp.ok || altResp.status === 206) {
        if (response) await discardResponse(response);
        return { response: altResp, effectiveUrl: altUrl };
      }
    } catch {}
    await discardResponse(altResp);
  }

  if (response) {
    return { response, effectiveUrl: url };
  }
  throw initialError || new Error(`Не удалось загрузить ${url}`);
}

async function fetchUpstreamWithRetry(targetUrl, headers, signal, settings, maxRetries = 2) {
  for (let attempt = 0; ; attempt++) {
    // Cooldown after a recent 429: a burst of Range requests must not hammer the source back-to-back
    const cooldownEnd = upstreamCooldown.get(targetUrl) || 0;
    const waitMs = cooldownEnd - Date.now();
    if (waitMs > 0 && !signal?.aborted) {
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, UPSTREAM_COOLDOWN_MS)));
    }

    const response = await tryFetch(targetUrl, headers, signal, settings);
    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= maxRetries || signal?.aborted) {
      return response;
    }

    // Release the failed response's connection before retrying
    try { await response.body?.cancel(); } catch {}

    if (upstreamCooldown.size > 200) pruneUpstreamCooldown();
    upstreamCooldown.set(targetUrl, Date.now() + UPSTREAM_COOLDOWN_MS);

    const retryAfterRaw = response.headers.get('retry-after') || '';
    const retryAfterSec = Number.parseInt(retryAfterRaw, 10);
    const retryAfterDate = Number.isNaN(retryAfterSec) ? Date.parse(retryAfterRaw) : NaN;
    const retryDelayMs = Number.isFinite(retryAfterDate) ? retryAfterDate - Date.now() : NaN;
    const delayMs = Math.min(
      10000,
      Number.isFinite(retryDelayMs) && retryDelayMs > 0
        ? retryDelayMs
        : (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 1000 * (attempt + 1))
    );
    logInfo('Proxy', `Источник ответил ${response.status}, повтор ${attempt + 1}/${maxRetries} через ${delayMs} мс: ${targetUrl.split('?')[0]}`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

// Full cycle: download the image (with 404 fallback), put it in the disk cache, and return it to the client
async function downloadAndCacheImage(req, res, originalUrl, headers, settings) {
  const controller = new AbortController();
  const abortTimeout = setTimeout(() => controller.abort(), PROXY_ABORT_MS);
  req.on('close', () => {
    clearTimeout(abortTimeout);
    try { controller.abort(); } catch {}
  });

  let fetched;
  try {
    fetched = await fetchWith404Fallback(originalUrl, headers, controller.signal, settings);
  } finally {
    clearTimeout(abortTimeout);
  }
  const response = fetched.response;

  if (!response.ok) {
    await discardResponse(response);
    return res.status(response.status).send('Медиафайл недоступен');
  }

  let buffer;
  try {
    buffer = await readBodyWithLimit(response, MAX_CACHED_IMAGE_BYTES);
  } catch (err) {
    if (res.headersSent) return res.end();
    return res.status(err.statusCode || 502).send(err.message);
  }

  const imageType = detectImageType(buffer);
  if (!imageType) {
    return res.status(415).send('Поддерживается только растровая графика');
  }

  res.status(200);
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Content-Type', imageType.mime);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'public, max-age=604800');

  const cacheFilePath = imageCachePath(originalUrl);
  await writeCacheFileAtomic(cacheFilePath, buffer).catch(() => {});
  res.send(buffer);
}

function pipeUpstream(req, res, webStream) {
  const nodeStream = Readable.fromWeb(webStream);

  nodeStream.on('error', () => {
    try {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    } catch {}
  });

  req.on('close', () => {
    try { nodeStream.destroy(); } catch {}
  });

  nodeStream.pipe(res);
}

export async function handleProxyRequest(req, res) {
  // Reassigned when a 404 fallback candidate succeeds, so it must stay mutable
  let targetUrl = req.query.url;
  // ?url=a&url=b arrives as an array, which would blow up on .split() below
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  if (!targetUrl || typeof targetUrl !== 'string') return res.status(400).send('Требуется параметр url');

  // Without this the endpoint is an open proxy: anything on the LAN could read
  // internal services and cloud metadata (169.254.169.254) through it. The
  // resolved check also covers hostnames whose records point inside the LAN.
  if (!(await isSafeExternalUrlResolved(targetUrl))) {
    return res.status(403).send('URL не разрешён');
  }

  try {
    const cleanPath = targetUrl.split('?')[0].toLowerCase();
    const isImage = cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg') || cleanPath.endsWith('.png') || cleanPath.endsWith('.webp') || cleanPath.endsWith('.gif');
    const isRangeReq = Boolean(req.headers.range);
    const currentSettings = resolveRequestSettings(getSettings(), parseRequestAuth(req));

    // Disk cache for images (non-blocking)
    if (isImage && !isRangeReq) {
      const cacheFilePath = imageCachePath(targetUrl);

      const cachedMime = await readCacheFileMime(cacheFilePath);
      if (cachedMime) {
        touchCacheFile(cacheFilePath);
        res.setHeader('Content-Type', cachedMime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cacheFilePath);
      }

      const inflightJob = inflightImages.get(targetUrl);
      if (inflightJob) {
        await inflightJob.catch(() => {});
        const readyMime = await readCacheFileMime(cacheFilePath);
        if (readyMime) {
          touchCacheFile(cacheFilePath);
          res.setHeader('Content-Type', readyMime);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
          res.setHeader('Cache-Control', 'public, max-age=604800');
          return res.sendFile(cacheFilePath);
        }
      }

      // Register our own download as active
      const job = downloadAndCacheImage(req, res, targetUrl, buildUpstreamHeaders(targetUrl, true, currentSettings), currentSettings);
      inflightImages.set(targetUrl, job);
      const cleanup = () => {
        if (inflightImages.get(targetUrl) === job) inflightImages.delete(targetUrl);
      };
      job.then(cleanup, cleanup);
      return await job;
    }

    // Streaming path: videos, Range requests, and non-cacheable responses
    const headers = buildUpstreamHeaders(targetUrl, !isImage, currentSettings);
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), PROXY_ABORT_MS);
    req.on('close', () => {
      clearTimeout(abortTimeout);
      try { controller.abort(); } catch {}
    });

    const { response, effectiveUrl } = await fetchWith404Fallback(targetUrl, headers, controller.signal, currentSettings);
    clearTimeout(abortTimeout);

    if (!response.ok) {
      await discardResponse(response);
      return res.status(response.status).send('Медиафайл недоступен');
    }

    const mediaType = resolveSafeMediaType(response, effectiveUrl);
    if (!mediaType) {
      await discardResponse(response);
      return res.status(415).send('Недопустимый тип медиафайла');
    }

    res.status(response.status);
      res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mediaType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    const forwardHeaders = ['content-length', 'content-range', 'cache-control', 'last-modified', 'etag'];
    forwardHeaders.forEach(h => {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    });
    if (!res.getHeader('cache-control')) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }

    if (response.body) {
      pipeUpstream(req, res, response.body);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.message?.includes('aborted')) {
      return;
    }
    logError('Proxy', `Не удалось проксировать ${sanitizeLogUrl(targetUrl)}`, err);
    if (!res.headersSent) {
      res.status(502).send('Ошибка загрузки медиа');
    }
  }
}

/**
 * Validates binary image signatures (JPEG, PNG, GIF, WebP, AVIF/HEIC, BMP)
 */
/**
 * Retrieve or safely download an image buffer with disk caching, Referer/User-Agent, and fallback hosts
 */
export async function getOrFetchImageBuffer(imageUrl, currentSettings = null) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const settings = currentSettings || getSettings();
  // Same key as every other path - see imageCachePath
  const cacheFilePath = imageCachePath(imageUrl);

  // 1. Check disk cache
  try {
    const cachedBuf = await fs.promises.readFile(cacheFilePath);
    if (isValidImageBuffer(cachedBuf)) {
      touchCacheFile(cacheFilePath);
      return { buffer: cachedBuf, fromDisk: true };
    }
    // Not an image - a stale or truncated entry, drop it
    fs.promises.unlink(cacheFilePath).catch(() => {});
  } catch {}

  // 2. Fetch from upstream with full browser headers and fallback
  const headers = buildUpstreamHeaders(imageUrl, true, settings);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_ABORT_MS);

  try {
    const { response } = await fetchWith404Fallback(imageUrl, headers, controller.signal, settings, {
      headersFor: (altUrl) => buildUpstreamHeaders(altUrl, true, settings),
      shouldFallback: (r) => r && r.status === 404
    });

    if (!response || !response.ok) {
      await discardResponse(response);
      return null;
    }

    const buf = await readBodyWithLimit(response, MAX_CACHED_IMAGE_BYTES);
    if (!detectImageType(buf)) {
      return null;
    }

    if (buf.length <= MAX_CACHED_IMAGE_BYTES) {
      writeCacheFileAtomic(cacheFilePath, buf).catch(() => {});
    }

    return { buffer: buf, fromDisk: false };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
