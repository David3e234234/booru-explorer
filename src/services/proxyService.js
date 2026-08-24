import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { THUMBS_DIR, BROWSER_USER_AGENT, BOORU_USER_AGENT } from '../config/constants.js';
import { getSettings } from './storageService.js';
import { resolveSiteReferer } from '../utils/network.js';
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
    if (cleanNoQuery.includes('file.pawchive.pw/data/')) {
      pushCandidate(cleanNoQuery.replace('file.pawchive.pw/data/', 'img.pawchive.pw/thumbnail/data/'));
    } else if (cleanNoQuery.includes('img.pawchive.pw/thumbnail/data/')) {
      pushCandidate(cleanNoQuery.replace('img.pawchive.pw/thumbnail/data/', 'file.pawchive.pw/data/'));
    }
  }

  return candidates;
}

function fixContentType(res, targetUrl) {
  const normalizedPath = targetUrl.split('?')[0].replace(/\/+$/, '').toLowerCase();
  let currentType = res.getHeader('content-type') || '';
  if (!currentType || currentType.includes('octet-stream') || currentType.includes('text/plain') || currentType.includes('text/html')) {
    if (normalizedPath.includes('.mp4') || normalizedPath.includes('.m4v') || targetUrl.toLowerCase().includes('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (normalizedPath.includes('.webm') || targetUrl.toLowerCase().includes('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    } else if (normalizedPath.endsWith('.gif')) {
      res.setHeader('Content-Type', 'image/gif');
    } else if (normalizedPath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (normalizedPath.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    } else if (normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    }
  }
}

async function tryFetch(url, headers, signal) {
  return fetch(url, { headers, redirect: 'follow', signal });
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

async function fetchUpstreamWithRetry(targetUrl, headers, signal, maxRetries = 2) {
  for (let attempt = 0; ; attempt++) {
    // Cooldown after a recent 429: a burst of Range requests must not hammer the source back-to-back
    const cooldownEnd = upstreamCooldown.get(targetUrl) || 0;
    const waitMs = cooldownEnd - Date.now();
    if (waitMs > 0 && !signal?.aborted) {
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, UPSTREAM_COOLDOWN_MS)));
    }

    const response = await tryFetch(targetUrl, headers, signal);
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
async function downloadAndCacheImage(req, res, originalUrl, headers) {
  const controller = new AbortController();
  const abortTimeout = setTimeout(() => controller.abort(), PROXY_ABORT_MS);
  req.on('close', () => {
    clearTimeout(abortTimeout);
    try { controller.abort(); } catch {}
  });

  let response;
  let effectiveUrl = originalUrl;
  try {
    response = await fetchUpstreamWithRetry(originalUrl, headers, controller.signal);

    if (response.status === 404) {
      for (const altUrl of build404FallbackCandidates(originalUrl)) {
        try {
          const altResp = await tryFetch(altUrl, headers, controller.signal);
          if (altResp.ok || altResp.status === 206) {
            response = altResp;
            effectiveUrl = altUrl;
            break;
          }
        } catch {}
      }
    }
  } finally {
    clearTimeout(abortTimeout);
  }

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

  const hash = crypto.createHash('md5').update(originalUrl).digest('hex');
  const ext = detectImageExt(effectiveUrl.split('?')[0].toLowerCase());
  const cacheFilePath = path.join(THUMBS_DIR, `${hash}.${ext}`);
  fs.promises.writeFile(cacheFilePath, buf).catch(() => {});
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
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Требуется параметр url');

  try {
    const cleanPath = targetUrl.split('?')[0].toLowerCase();
    const isImage = cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg') || cleanPath.endsWith('.png') || cleanPath.endsWith('.webp') || cleanPath.endsWith('.gif');
    const isRangeReq = Boolean(req.headers.range);
    const currentSettings = getSettings();

    // Disk cache for images (non-blocking)
    if (isImage && !isRangeReq) {
      const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
      const cacheFilePath = path.join(THUMBS_DIR, `${hash}.${detectImageExt(cleanPath)}`);

      try {
        const stats = await fs.promises.stat(cacheFilePath);
        if (stats.size > 0) {
          res.setHeader('Cache-Control', 'public, max-age=604800');
          return res.sendFile(cacheFilePath);
        }
      } catch {}

      // The same file is already downloading - wait for it, then re-check the cache
      const inflightJob = inflightImages.get(targetUrl);
      if (inflightJob) {
        await inflightJob.catch(() => {});
        try {
          const stats = await fs.promises.stat(cacheFilePath);
          if (stats.size > 0) {
            res.setHeader('Cache-Control', 'public, max-age=604800');
            return res.sendFile(cacheFilePath);
          }
        } catch {}
      }

      // Register our own download as active
      const job = downloadAndCacheImage(req, res, targetUrl, buildUpstreamHeaders(targetUrl, true, currentSettings));
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

    let response = await fetchUpstreamWithRetry(targetUrl, headers, controller.signal);

    if (response.status === 404) {
      for (const altUrl of build404FallbackCandidates(targetUrl)) {
        try {
          const altResp = await tryFetch(altUrl, headers, controller.signal);
          if (altResp.ok || altResp.status === 206) {
            response = altResp;
            targetUrl = altUrl;
            break;
          }
        } catch {}
      }
    }
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
    fixContentType(res, targetUrl);
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
