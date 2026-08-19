import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { THUMBS_DIR, BROWSER_USER_AGENT, BOORU_USER_AGENT } from '../config/constants.js';
import { getSettings } from './storageService.js';
import { logError } from '../utils/logger.js';

export async function handleProxyRequest(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Требуется параметр url');

  try {
    const cleanPath = targetUrl.split('?')[0].toLowerCase();
    const isImage = cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg') || cleanPath.endsWith('.png') || cleanPath.endsWith('.webp') || cleanPath.endsWith('.gif');
    const isRangeReq = Boolean(req.headers.range);

    // Дисковый кэш для картинок
    if (isImage && !isRangeReq) {
      const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
      let ext = 'jpg';
      if (cleanPath.endsWith('.png')) ext = 'png';
      else if (cleanPath.endsWith('.webp')) ext = 'webp';
      else if (cleanPath.endsWith('.gif')) ext = 'gif';

      const cacheFilePath = path.join(THUMBS_DIR, `${hash}.${ext}`);
      if (fs.existsSync(cacheFilePath) && fs.statSync(cacheFilePath).size > 0) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cacheFilePath);
      }
    }

    const isBrowserTarget = targetUrl.includes('rule34video.com') || targetUrl.includes('boomio-cdn.com') || targetUrl.includes('rule34.xxx') || targetUrl.includes('paheal') || targetUrl.includes('gelbooru.com') || targetUrl.includes('xbooru.com') || targetUrl.includes('hypnohub.net');
    const ua = isBrowserTarget ? BROWSER_USER_AGENT : BOORU_USER_AGENT;

    const headers = {
      'User-Agent': ua,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': isImage ? 'image' : 'video',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site'
    };

    const currentSettings = getSettings();
    try {
      const parsed = new URL(targetUrl);
      if (parsed.hostname.includes('paheal.net') || parsed.hostname.includes('paheal-cdn.net')) {
        headers['Referer'] = 'https://rule34.paheal.net/';
      } else if (parsed.hostname.includes('rule34.xxx')) {
        headers['Referer'] = 'https://rule34.xxx/';
      } else if (parsed.hostname.includes('paheal.net') || parsed.hostname.includes('paheal-cdn')) {
        headers['Referer'] = 'https://rule34.paheal.net/';
      } else if (parsed.hostname.includes('donmai.us')) {
        headers['Referer'] = 'https://danbooru.donmai.us/';
        if (currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
          headers['Authorization'] = 'Basic ' + Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64');
        }
      } else if (parsed.hostname.includes('rule34video.com') || parsed.hostname.includes('boomio-cdn.com')) {
        headers['Referer'] = 'https://rule34video.com/';
      } else if (parsed.hostname.includes('gelbooru.com')) {
        headers['Referer'] = 'https://gelbooru.com/';
      } else if (parsed.hostname.includes('yande.re')) {
        headers['Referer'] = 'https://yande.re/';
      } else if (parsed.hostname.includes('konachan')) {
        headers['Referer'] = 'https://konachan.net/';
      } else if (parsed.hostname.includes('hypnohub.net')) {
        headers['Referer'] = 'https://hypnohub.net/';
      } else if (parsed.hostname.includes('xbooru.com')) {
        headers['Referer'] = 'https://xbooru.com/';
      } else {
        headers['Referer'] = `${parsed.protocol}//${parsed.host}/`;
      }
    } catch {}

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 20000);
    req.on('close', () => {
      clearTimeout(abortTimeout);
      try { controller.abort(); } catch {}
    });

    let response = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal
    });

    // Умный fallback для расширений файлов (mp4 <-> webm, jpg <-> png) при 404
    if (response.status === 404 && (targetUrl.includes('rule34.xxx') || targetUrl.includes('gelbooru.com') || targetUrl.includes('paheal.net'))) {
      let alternateUrl = null;
      if (targetUrl.endsWith('.mp4')) alternateUrl = targetUrl.replace(/\.mp4$/, '.webm');
      else if (targetUrl.endsWith('.webm')) alternateUrl = targetUrl.replace(/\.webm$/, '.mp4');
      else if (targetUrl.endsWith('.jpg')) alternateUrl = targetUrl.replace(/\.jpg$/, '.png');
      else if (targetUrl.endsWith('.png')) alternateUrl = targetUrl.replace(/\.png$/, '.jpg');

      if (alternateUrl) {
        try {
          const altResp = await fetch(alternateUrl, { headers, redirect: 'follow', signal: controller.signal });
          if (altResp.ok || altResp.status === 206) {
            response = altResp;
            targetUrl = alternateUrl;
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
      let val = response.headers.get(h);
      if (val) {
        if (h === 'content-type' && val.includes(',')) {
          val = val.split(',')[0].trim();
        }
        res.setHeader(h, val);
      }
    });

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

    if (!res.getHeader('cache-control')) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }

    if (isImage && !isRangeReq && response.ok) {
      const arrayBuf = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
      let ext = 'jpg';
      if (cleanPath.endsWith('.png')) ext = 'png';
      else if (cleanPath.endsWith('.webp')) ext = 'webp';
      else if (cleanPath.endsWith('.gif')) ext = 'gif';

      const cacheFilePath = path.join(THUMBS_DIR, `${hash}.${ext}`);
      fs.promises.writeFile(cacheFilePath, buf).catch(() => {});
      return res.send(buf);
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body);
      
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
