import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { THUMBS_DIR, BROWSER_USER_AGENT, BOORU_USER_AGENT } from '../config/constants.js';
import { getSettings } from './storageService.js';
import { resolveSiteReferer, fetchSafe, isSafeExternalUrl, discardResponse } from '../utils/network.js';
import { logError, logInfo } from '../utils/logger.js';

// Max image size that gets buffered into memory and written to the disk cache
const MAX_CACHED_IMAGE_BYTES = 30 * 1024 * 1024;

// Upstream timeout with headroom for retries while the source throttles
const PROXY_ABORT_MS = 35000;

const IMAGE_EXTS = [
  ['.png', 'png'],
  ['.webp', 'webp'],
  ['.gif', 'gif']
];

function detectImageExt(cleanPath) {
  for (const [suffix, ext] of IMAGE_EXTS) {
    if (cleanPath.endsWith(suffix)) return ext;
  }
  return 'jpg';
}

// Cache file name is derived from the requested URL only - never from the URL a 404
// fallback resolved to. Keying the write off the effective URL made the reader and
// the writer disagree whenever the fallback changed the extension, so the entry was
// written once and never hit again
function imageCachePath(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(THUMBS_DIR, `${hash}.${detectImageExt(url.split('?')[0].toLowerCase())}`);
}

// A cache entry is only usable if its first bytes are a real image signature.
// Otherwise we would happily serve a cached HTML error page forever
async function hasValidCacheFile(cacheFilePath) {
  let head = null;
  try {
    const stats = await fs.promises.stat(cacheFilePath);
    if (stats.size <= 0) return false;
    const handle = await fs.promises.open(cacheFilePath, 'r');
    try {
      head = await handle.read(Buffer.alloc(32), 0, 32, 0);
    } finally {
      await handle.close().catch(() => {});
    }
    head = head.buffer.subarray(0, head.bytesRead);
  } catch {
    return false;
  }
  if (isValidImageBuffer(head)) return true;
  // Garbage on disk (truncated write, error page) - drop it so the next request refetches
  fs.promises.unlink(cacheFilePath).catch(() => {});
  return false;
}

// Write via a temp file + rename: a crash or a concurrent reader must never see a half-written image
async function writeCacheFileAtomic(cacheFilePath, buf) {
  const tmpPath = `${cacheFilePath}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, buf);
    await fs.promises.rename(tmpPath, cacheFilePath);
  } catch (err) {
    fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// Deduplicate concurrent requests for the same image (thundering herd)
const inflightImages = new Map();

function buildUpstreamHeaders(targetUrl, isImage, currentSettings) {
  const isBrowserTarget = targetUrl.includes('rule34video.com') || targetUrl.includes('boomio-cdn.com') || targetUrl.includes('rule34.xxx') || targetUrl.includes('paheal') || targetUrl.includes('gelbooru.com') || targetUrl.includes('xbooru.com') || targetUrl.includes('hypnohub.net') || targetUrl.includes('tbib.org') || targetUrl.includes('pawchive.pw') || targetUrl.includes('pawchive.st');
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
    if (parsed.hostname.includes('donmai.us') && currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
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
  }

  return candidates;
}

function fixContentType(res, targetUrl) {
  const fullLower = targetUrl.toLowerCase();
  const normalizedPath = fullLower.split('?')[0].replace(/\/+$/, '');
  let currentType = (res.getHeader('content-type') || '').toLowerCase();

  // Strip charset from media content types (Safari WebKit rejects video MIME types with charset)
  if (currentType.startsWith('video/') && currentType.includes(';')) {
    currentType = currentType.split(';')[0].trim();
    res.setHeader('Content-Type', currentType);
  }

  if (!currentType || currentType.includes('octet-stream') || currentType.includes('text/plain') || currentType.includes('text/html') || currentType === 'application/unknown') {
    if (normalizedPath.includes('.mp4') || normalizedPath.includes('.m4v') || fullLower.includes('.mp4') || fullLower.includes('.m4v')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (normalizedPath.includes('.webm') || fullLower.includes('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    } else if (normalizedPath.endsWith('.gif') || fullLower.includes('.gif')) {
      res.setHeader('Content-Type', 'image/gif');
    } else if (normalizedPath.endsWith('.png') || fullLower.includes('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (normalizedPath.endsWith('.webp') || fullLower.includes('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    } else if (normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg') || fullLower.includes('.jpg') || fullLower.includes('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    }
  }
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
  const { headersFor = null, shouldFallback = (r) => r.status === 404 } = options;

  let response = await fetchUpstreamWithRetry(url, headers, signal, settings);
  if (!shouldFallback(response)) return { response, effectiveUrl: url };

  for (const altUrl of build404FallbackCandidates(url)) {
    let altResp = null;
    try {
      altResp = await tryFetch(altUrl, headersFor ? headersFor(altUrl) : headers, signal, settings);
      if (altResp.ok || altResp.status === 206) {
        await discardResponse(response);
        return { response: altResp, effectiveUrl: altUrl };
      }
    } catch {}
    await discardResponse(altResp);
  }
  return { response, effectiveUrl: url };
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

    const retryAfterSec = parseInt(response.headers.get('retry-after') || '', 10);
    const delayMs = Math.min(5000, retryAfterSec > 0 ? retryAfterSec * 1000 : 1000 * (attempt + 1));
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
  const effectiveUrl = fetched.effectiveUrl;

  res.status(response.status);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');

  const forwardHeaders = ['content-type', 'content-length', 'cache-control', 'last-modified', 'etag'];
  forwardHeaders.forEach(h => {
    const val = response.headers.get(h);
    if (val && h !== 'content-range') {
      res.setHeader(h, h === 'content-type' && val.includes(',') ? val.split(',')[0].trim() : val);
    }
  });
  fixContentType(res, effectiveUrl);
  if (!res.getHeader('cache-control')) {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }

  if (!response.ok || req.headers.range) {
    if (response.body) {
      pipeUpstream(req, res, response.body);
    } else {
      res.end();
    }
    return;
  }

  // Stream large files without caching
  const declaredLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (declaredLength > MAX_CACHED_IMAGE_BYTES) {
    if (response.body) {
      pipeUpstream(req, res, response.body);
    } else {
      res.end();
    }
    return;
  }

  const arrayBuf = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  if (buf.length > MAX_CACHED_IMAGE_BYTES) {
    return res.send(buf);
  }

  // Keyed off the requested URL, not the fallback one, so the reader finds it again
  const cacheFilePath = imageCachePath(originalUrl);
  writeCacheFileAtomic(cacheFilePath, buf).catch(() => {});
  res.send(buf);
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
  // internal services and cloud metadata (169.254.169.254) through it.
  if (!isSafeExternalUrl(targetUrl)) {
    return res.status(403).send('URL не разрешён');
  }

  try {
    const cleanPath = targetUrl.split('?')[0].toLowerCase();
    const isImage = cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg') || cleanPath.endsWith('.png') || cleanPath.endsWith('.webp') || cleanPath.endsWith('.gif');
    const isRangeReq = Boolean(req.headers.range);
    const currentSettings = getSettings();

    // Disk cache for images (non-blocking)
    if (isImage && !isRangeReq) {
      const cacheFilePath = imageCachePath(targetUrl);

      if (await hasValidCacheFile(cacheFilePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cacheFilePath);
      }

      // The same file is already downloading - wait for it, then re-check the cache
      const inflightJob = inflightImages.get(targetUrl);
      if (inflightJob) {
        await inflightJob.catch(() => {});
        if (await hasValidCacheFile(cacheFilePath)) {
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

    res.status(response.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');

    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'cache-control', 'last-modified', 'etag'];
    forwardHeaders.forEach(h => {
      const val = response.headers.get(h);
      if (val) {
        res.setHeader(h, h === 'content-type' && val.includes(',') ? val.split(',')[0].trim() : val);
      }
    });
    fixContentType(res, effectiveUrl);
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
    logError('Proxy', `Не удалось проксировать ${targetUrl}`, err);
    if (!res.headersSent) {
      res.status(502).send('Ошибка загрузки медиа');
    }
  }
}

/**
 * Validates binary image signatures (JPEG, PNG, GIF, WebP, AVIF/HEIC, BMP)
 */
export function isValidImageBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  // AVIF / HEIC (ftyp)
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4D) return true;
  return false;
}

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
      shouldFallback: (r) => r.status === 404 || !r.ok
    });

    if (!response || !response.ok) {
      await discardResponse(response);
      return null;
    }

    const cType = (response.headers.get('content-type') || '').toLowerCase();
    if (cType.includes('text/html') || cType.includes('text/plain')) {
      await discardResponse(response);
      return null;
    }

    const arrayBuf = await response.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    if (!isValidImageBuffer(buf)) {
      return null;
    }

    // Save to disk cache
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
