import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import StreamZip from 'node-stream-zip';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { ARCHIVES_DIR } from '../config/constants.js';
import { fetchSafe, resolveSiteReferer } from '../utils/network.js';
import { logError, logInfo } from '../utils/logger.js';

function isAllowedArchiveHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return (
    h === 'pawchive.pw' || h.endsWith('.pawchive.pw') ||
    h === 'pawchive.st' || h.endsWith('.pawchive.st') ||
    h === 'kemono.su' || h.endsWith('.kemono.su') ||
    h === 'kemono.party' || h.endsWith('.kemono.party') ||
    h === 'coomer.su' || h.endsWith('.coomer.su') ||
    h === 'coomer.party' || h.endsWith('.coomer.party')
  );
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts']);

// Zip-bomb and runaway-extraction guards. Entries are streamed to disk, so the
// caps bound disk usage only - RAM stays flat even for multi-hundred-MB videos
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GB uncompressed per archive
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024; // 1 GB per file

const DOWNLOAD_TIMEOUT_MS = 120000;

// Natural sort so img2 < img10 inside the album
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Deduplicate concurrent extractions and inspections of the same archive
const inflightJobs = new Map();
const inflightInspects = new Map();
const inflightDownloads = new Map();

// Download/extract progress, polled by the client loading indicator
const jobStatus = new Map(); // zipUrl -> { phase: 'download'|'extract'|'inspect', received, total }

export function getArchiveJobStatus(zipUrl) {
  return jobStatus.get(zipUrl) || null;
}

function getExt(nameOrPath) {
  if (!nameOrPath) return '';
  return nameOrPath.split('?')[0].split('.').pop()?.toLowerCase() || '';
}

export function isAllowedArchiveUrl(url) {
  try {
    const parsed = new URL(url);
    if (!isAllowedArchiveHost(parsed.hostname)) return false;
    const cleanPath = parsed.pathname.toLowerCase();
    const queryF = (parsed.searchParams.get('f') || '').toLowerCase();
    return cleanPath.endsWith('.zip') || queryF.endsWith('.zip') || cleanPath.includes('.zip');
  } catch {
    return false;
  }
}

export function getArchiveKey(zipUrl) {
  return crypto.createHash('md5').update(zipUrl).digest('hex');
}

export function readManifest(key) {
  const manifestPath = path.join(ARCHIVES_DIR, `${key}.manifest.json`);
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (manifest && Array.isArray(manifest.items) && manifest.items.length > 0) {
      return manifest;
    }
  } catch {}
  return null;
}

export function classifyCloudService(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('drive.google.com') || u.includes('docs.google.com')) {
    return { id: 'gdrive', name: 'Google Drive', icon: '📁' };
  }
  if (u.includes('mega.nz') || u.includes('mega.io') || u.includes('mega.co.nz')) {
    return { id: 'mega', name: 'MEGA', icon: '☁️' };
  }
  if (u.includes('disk.yandex') || u.includes('yadi.sk')) {
    return { id: 'yandex', name: 'Yandex Disk', icon: '🟡' };
  }
  if (u.includes('dropbox.com')) {
    return { id: 'dropbox', name: 'Dropbox', icon: '📦' };
  }
  if (u.includes('mediafire.com')) {
    return { id: 'mediafire', name: 'MediaFire', icon: '🔥' };
  }
  if (u.includes('1drv.ms') || u.includes('onedrive.live.com')) {
    return { id: 'onedrive', name: 'OneDrive', icon: '☁️' };
  }
  if (u.includes('terabox') || u.includes('1024tera') || u.includes('4funbox') || u.includes('mirrobox')) {
    return { id: 'terabox', name: 'TeraBox', icon: '💾' };
  }
  if (u.includes('pixeldrain.com')) {
    return { id: 'pixeldrain', name: 'Pixeldrain', icon: '💧' };
  }
  if (u.includes('gofile.io')) {
    return { id: 'gofile', name: 'Gofile', icon: '📁' };
  }
  if (u.includes('catbox.moe')) {
    return { id: 'catbox', name: 'Catbox', icon: '🐱' };
  }
  if (u.includes('workupload.com')) {
    return { id: 'workupload', name: 'Workupload', icon: '💼' };
  }
  if (u.includes('qiwi.gg')) {
    return { id: 'qiwi', name: 'Qiwi', icon: '🥝' };
  }
  if (u.includes('buzzheavier.com')) {
    return { id: 'buzzheavier', name: 'Buzzheavier', icon: '⚡' };
  }
  if (u.includes('krakenfiles.com')) {
    return { id: 'krakenfiles', name: 'KrakenFiles', icon: '🐙' };
  }
  if (u.includes('bunkr.')) {
    return { id: 'bunkr', name: 'Bunkr', icon: '🔒' };
  }
  return { id: 'cloud', name: 'Web Link', icon: '🔗' };
}

export function isCloudStorageUrl(url) {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('drive.google.com') ||
    u.includes('docs.google.com') ||
    u.includes('mega.nz') ||
    u.includes('mega.io') ||
    u.includes('mega.co.nz') ||
    u.includes('disk.yandex') ||
    u.includes('yadi.sk') ||
    u.includes('dropbox.com') ||
    u.includes('mediafire.com') ||
    u.includes('1drv.ms') ||
    u.includes('onedrive.live.com') ||
    u.includes('terabox') ||
    u.includes('1024tera') ||
    u.includes('pixeldrain.com') ||
    u.includes('gofile.io') ||
    u.includes('catbox.moe') ||
    u.includes('workupload.com') ||
    u.includes('qiwi.gg') ||
    u.includes('buzzheavier.com') ||
    u.includes('krakenfiles.com') ||
    u.includes('bunkr.') ||
    u.includes('anonfiles.com') ||
    u.includes('bayfiles.com') ||
    u.includes('rapidgator.net')
  );
}

const IGNORED_DOMAINS = [
  'w3.org', 'adobe.com', 'purl.org', 'schema.org', 'xml.org',
  'openxmlformats.org', 'microsoft.com', 'apple.com', 'google.com/recaptcha'
];

export function scanBufferForLinksAndPasswords(buf, filename = '') {
  const links = new Set();
  const passwords = new Set();
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const addUrl = (u) => {
    let clean = String(u || '').trim();
    clean = clean.replace(/\\r|\\n/g, '').replace(/[\r\n]+/g, '').replace(/\\+$/, '').replace(/[\)\]\>,\.;]+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }
    try {
      const parsed = new URL(clean);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const host = parsed.hostname.toLowerCase();
        if (IGNORED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return;
        links.add(clean);
      }
    } catch {}
  };

  const addPass = (p) => {
    let clean = String(p || '').trim();
    clean = clean.replace(/^[:=–—\s]+/, '').replace(/[\r\n,;"'<>()\[\]\\]+$/, '').trim();
    if (clean && clean.length >= 2 && clean.length <= 80 && !clean.startsWith('http') && !clean.startsWith('www.') && !/^(\)Tj|Tj|TJ|ET|BT|rg|RG)$/i.test(clean)) {
      passwords.add(clean);
    }
  };

  const passRegex = /\b(?:password|pass|пароль|pwd|passcode|secret\s*key|access\s*code|ключ)\b\s*[:=–—\-]\s*([^\s\r\n,;"'<>()\[\]]{2,60})/gi;
  const urlRegex = /(https?:\/\/[^\s<>"')]+|(?:mega\.(?:nz|io|co\.nz)|drive\.google\.com|disk\.yandex\.(?:ru|com)|yadi\.sk|dropbox\.com|mediafire\.com|1drv\.ms)\/[^\s<>"')]+)/gi;

  const scanText = (str) => {
    if (!str || typeof str !== 'string') return;
    let m;
    while ((m = urlRegex.exec(str)) !== null) {
      addUrl(m[1]);
    }
    while ((m = passRegex.exec(str)) !== null) {
      addPass(m[1]);
    }
  };

  const rawLatin1 = buf.toString('latin1');

  if (ext === 'pdf' || rawLatin1.includes('%PDF')) {
    const uriRegex = /\/URI\s*\(([^)]+)\)/g;
    let m;
    while ((m = uriRegex.exec(rawLatin1)) !== null) {
      addUrl(m[1]);
    }
    const uriHexRegex = /\/URI\s*<([0-9a-fA-F]+)>/g;
    while ((m = uriHexRegex.exec(rawLatin1)) !== null) {
      try {
        const decoded = Buffer.from(m[1], 'hex').toString('utf8');
        addUrl(decoded);
      } catch {}
    }

    // Fast stream scanning via indexOf (avoids regex backtracking and skips large image streams)
    let streamPos = 0;
    while ((streamPos = rawLatin1.indexOf('stream', streamPos)) !== -1) {
      const after = streamPos + 6;
      let dataStart = after;
      if (rawLatin1[dataStart] === '\r') dataStart++;
      if (rawLatin1[dataStart] === '\n') dataStart++;

      const endPos = rawLatin1.indexOf('endstream', dataStart);
      if (endPos === -1) break;

      let dataEnd = endPos;
      if (rawLatin1[dataEnd - 1] === '\n') dataEnd--;
      if (rawLatin1[dataEnd - 1] === '\r') dataEnd--;

      const streamLen = dataEnd - dataStart;
      streamPos = endPos + 9;

      if (streamLen <= 0) continue;
      // Skip large image/font streams (> 1 MB) to prevent CPU lockup
      if (streamLen > 1024 * 1024) continue;

      const streamBytes = Buffer.from(rawLatin1.slice(dataStart, dataEnd), 'latin1');
      let inflatedStr = '';
      try {
        inflatedStr = zlib.inflateSync(streamBytes).toString('utf8');
      } catch {
        try {
          inflatedStr = zlib.inflateRawSync(streamBytes).toString('utf8');
        } catch {}
      }

      if (inflatedStr) {
        scanText(inflatedStr);

        // Also extract text inside PDF text operators: (text) Tj
        const tjRegex = /\(([^)]{1,500})\)\s*Tj/g;
        let tjMatch;
        const pdfTextFragments = [];
        while ((tjMatch = tjRegex.exec(inflatedStr)) !== null) {
          pdfTextFragments.push(tjMatch[1]);
        }
        if (pdfTextFragments.length > 0) {
          scanText(pdfTextFragments.join(' '));
        }

        // Extract hex text: <hex> Tj
        const tjHexRegex = /<([0-9a-fA-F]{2,500})>\s*Tj/g;
        while ((tjMatch = tjHexRegex.exec(inflatedStr)) !== null) {
          try {
            const decoded = Buffer.from(tjMatch[1], 'hex').toString('utf8');
            scanText(decoded);
          } catch {}
        }

        // Extract TJ arrays with kerning: [(text1) 20 (text2)] TJ
        const tjArrRegex = /\[([^\]]{1,2000})\]\s*TJ/g;
        let tjArrMatch;
        while ((tjArrMatch = tjArrRegex.exec(inflatedStr)) !== null) {
          const inner = tjArrMatch[1];
          const parts = [];
          const partRegex = /\(([^)]{1,300})\)/g;
          let pm;
          while ((pm = partRegex.exec(inner)) !== null) {
            parts.push(pm[1]);
          }
          if (parts.length > 0) {
            scanText(parts.join(''));
            scanText(parts.join(' '));
          }
        }
      }
    }
  } else {
    const rawUtf8 = buf.toString('utf8');
    scanText(rawUtf8);
    if (rawLatin1 !== rawUtf8) scanText(rawLatin1);
  }

  return {
    links: Array.from(links),
    passwords: Array.from(passwords)
  };
}

/**
 * Downloads a remote archive in multiple concurrent byte-range segments directly to disk.
 * Safe concurrent writes are coordinated via an internal promise queue to prevent OS handle collisions.
 */
async function downloadSegmented(zipUrl, destPath, totalBytes, threads, referer) {
  logInfo('Archive', `Многопоточное скачивание архива: ${zipUrl.split('?')[0]} (${(totalBytes / 1024 / 1024).toFixed(1)} МБ, ${threads} потоков)`);

  jobStatus.set(zipUrl, {
    phase: 'download',
    received: 0,
    total: totalBytes,
    percent: 0,
    threads
  });

  const fileHandle = await fs.promises.open(destPath, 'w+');
  await fileHandle.truncate(totalBytes);

  let writeLock = Promise.resolve();
  const writeSafe = (buf, pos) => {
    writeLock = writeLock.then(() => fileHandle.write(buf, 0, buf.length, pos));
    return writeLock;
  };

  const abortController = new AbortController();
  const segmentSize = Math.ceil(totalBytes / threads);
  const segments = [];

  for (let i = 0; i < threads; i++) {
    const start = i * segmentSize;
    const end = Math.min(start + segmentSize - 1, totalBytes - 1);
    if (start <= end) {
      segments.push({ index: i, start, end, size: end - start + 1 });
    }
  }

  let totalReceived = 0;
  let lastProgressUpdate = 0;

  try {
    const workerPromises = segments.map(async (seg) => {
      const segRes = await fetchSafe(zipUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': referer,
          'Range': `bytes=${seg.start}-${seg.end}`
        },
        timeout: DOWNLOAD_TIMEOUT_MS,
        streamBody: true,
        signal: abortController.signal
      });

      if (segRes.status !== 206 || !segRes.body) {
        try { await segRes.body?.cancel(); } catch {}
        throw new Error(`Поток ${seg.index} получил статус ${segRes.status}`);
      }

      let writeOffset = seg.start;
      const reader = segRes.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          await writeSafe(value, writeOffset);
          writeOffset += value.length;
          totalReceived += value.length;

          const now = Date.now();
          if (now - lastProgressUpdate >= 150) {
            lastProgressUpdate = now;
            const st = jobStatus.get(zipUrl);
            if (st) {
              st.received = totalReceived;
              st.percent = Math.min(100, Math.round((totalReceived / totalBytes) * 100));
            }
          }
        }
      }

      if (writeOffset !== seg.end + 1) {
        throw new Error(`Поток ${seg.index} прочитал неполный сегмент: ${writeOffset - seg.start}/${seg.size}`);
      }
    });

    await Promise.all(workerPromises);
    await writeLock;
    await fileHandle.sync();

    const st = jobStatus.get(zipUrl);
    if (st) {
      st.received = totalBytes;
      st.percent = 100;
    }
  } catch (err) {
    abortController.abort();
    throw err;
  } finally {
    await fileHandle.close().catch(() => {});
  }
}

/**
 * Standard single-stream pipeline download with progress reporting.
 */
async function downloadSingleStream(zipUrl, destPath, referer) {
  logInfo('Archive', `Обычное скачивание архива (1 поток): ${zipUrl.split('?')[0]}`);
  const response = await fetchSafe(zipUrl, {
    timeout: DOWNLOAD_TIMEOUT_MS,
    streamBody: true,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': referer,
      'Accept': '*/*'
    }
  });

  if (!response.ok || !response.body) {
    try { await response.body?.cancel(); } catch {}
    throw new Error(`HTTP ${response.status}`);
  }

  const totalBytesHeader = parseInt(response.headers.get('content-length'), 10) || 0;
  jobStatus.set(zipUrl, { phase: 'download', received: 0, total: totalBytesHeader, percent: 0, threads: 1 });
  let lastProgressTime = 0;
  const progressCounter = new Transform({
    transform(chunk, enc, cb) {
      const st = jobStatus.get(zipUrl);
      if (st) {
        st.received += chunk.length;
        const now = Date.now();
        if (now - lastProgressTime >= 150) {
          lastProgressTime = now;
          st.percent = st.total > 0 ? Math.min(100, Math.round((st.received / st.total) * 100)) : 0;
        }
      }
      cb(null, chunk);
    }
  });

  await pipeline(Readable.fromWeb(response.body), progressCounter, fs.createWriteStream(destPath, { highWaterMark: 1024 * 1024 }));
}

/**
 * High-performance archive downloader. Automatically probes for HTTP Range support
 * and downloads in parallel segments if enabled, falling back to single-stream.
 */
export async function downloadArchiveFile(zipUrl, finalZipPath, options = {}) {
  if (fs.existsSync(finalZipPath)) {
    return;
  }

  const inflight = inflightDownloads.get(zipUrl);
  if (inflight) {
    return inflight;
  }

  const job = (async () => {
    await fs.promises.mkdir(ARCHIVES_DIR, { recursive: true });
    const tmpPath = `${finalZipPath}.downloading`;

    const threads = Math.max(1, Math.min(16, parseInt(options.threads, 10) || 4));
    const referer = resolveSiteReferer(zipUrl) || 'https://pawchive.pw/';

    // 1. Probe for Range support and total bytes
    let totalBytes = 0;
    let supportsRange = false;

    try {
      const probeRes = await fetchSafe(zipUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': referer,
          'Range': 'bytes=0-0'
        },
        timeout: 15000
      });

      if (probeRes.status === 206) {
        const cr = probeRes.headers.get('content-range') || '';
        const match = cr.match(/\/(\d+)$/);
        if (match) {
          totalBytes = parseInt(match[1], 10);
          supportsRange = totalBytes > 0;
        }
      } else if (probeRes.ok) {
        const cl = probeRes.headers.get('content-length');
        if (cl) totalBytes = parseInt(cl, 10) || 0;
      }
    } catch (probeErr) {
      logInfo('Archive', `Range-проба не удалась (${probeErr.message}), переключаемся на один поток`);
    }

    const minSegmentSize = 5 * 1024 * 1024;
    let downloaded = false;

    if (threads > 1 && supportsRange && totalBytes >= minSegmentSize) {
      try {
        await downloadSegmented(zipUrl, tmpPath, totalBytes, threads, referer);
        downloaded = true;
      } catch (segErr) {
        logError('Archive', `Сегментированное скачивание завершилось с ошибкой (${segErr.message}), откат на 1 поток`, segErr);
        await fs.promises.unlink(tmpPath).catch(() => {});
      }
    }

    if (!downloaded) {
      await downloadSingleStream(zipUrl, tmpPath, referer);
    }

    await fs.promises.rename(tmpPath, finalZipPath).catch(() => {});
  })().finally(() => {
    inflightDownloads.delete(zipUrl);
  });

  inflightDownloads.set(zipUrl, job);
  return job;
}

async function extractArchive(zipUrl, key, options = {}) {
  const cachedZip = path.join(ARCHIVES_DIR, `${key}.zip`);

  await fs.promises.mkdir(ARCHIVES_DIR, { recursive: true });
  if (!fs.existsSync(cachedZip)) {
    await downloadArchiveFile(zipUrl, cachedZip, options);
  }

  jobStatus.set(zipUrl, {
    phase: 'extract',
    percent: 0,
    extractedFiles: 0,
    totalFiles: 0,
    currentFile: ''
  });

  const zip = new StreamZip.async({ file: cachedZip });
  try {
    const entries = Object.values(await zip.entries()).filter(entry => {
      if (entry.isDirectory) return false;
      const name = entry.name.replace(/\\/g, '/');
      const base = name.split('/').pop();
      if (!base || base.startsWith('.') || name.includes('__MACOSX')) return false;
      const ext = getExt(base);
      return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
    });

    entries.sort((a, b) => nameCollator.compare(a.name, b.name));

    const totalEntries = entries.length;
    jobStatus.set(zipUrl, {
      phase: 'extract',
      percent: 0,
      extractedFiles: 0,
      totalFiles: totalEntries,
      currentFile: ''
    });

    let totalBytes = 0;
    const items = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (items.length >= MAX_FILES) break;
      const size = entry.size || 0;
      if (size > MAX_ENTRY_BYTES) continue;
      if (totalBytes + size > MAX_TOTAL_BYTES) break;

      const base = entry.name.replace(/\\/g, '/').split('/').pop();
      const ext = getExt(base);
      const n = items.length + 1;
      const destPath = path.join(ARCHIVES_DIR, `${key}_${n}.${ext}`);

      jobStatus.set(zipUrl, {
        phase: 'extract',
        percent: totalEntries > 0 ? Math.min(100, Math.round(((i + 1) / totalEntries) * 100)) : 0,
        extractedFiles: items.length,
        totalFiles: totalEntries,
        currentFile: base
      });

      try {
        await zip.extract(entry.name, destPath);
      } catch (extractErr) {
        logError('Archive', `Не удалось извлечь файл ${base}`, extractErr);
        fs.promises.unlink(destPath).catch(() => {});
        continue;
      }
      totalBytes += size;
      items.push({
        n,
        ext,
        name: base,
        isVideo: VIDEO_EXTS.has(ext),
        size
      });

      jobStatus.set(zipUrl, {
        phase: 'extract',
        percent: totalEntries > 0 ? Math.min(100, Math.round(((i + 1) / totalEntries) * 100)) : 100,
        extractedFiles: items.length,
        totalFiles: totalEntries,
        currentFile: base
      });
    }

    if (items.length === 0) {
      throw new Error('В архиве нет изображений или видео');
    }

    const manifest = { key, zipUrl, extractedAt: Date.now(), items };
    await fs.promises.writeFile(
      path.join(ARCHIVES_DIR, `${key}.manifest.json`),
      JSON.stringify(manifest)
    );
    logInfo('Archive', `Архив ${key} распакован: ${items.length} файлов (${(totalBytes / 1024 / 1024).toFixed(1)} МБ)`);

    jobStatus.set(zipUrl, {
      phase: 'completed',
      percent: 100,
      extractedFiles: items.length,
      totalFiles: totalEntries,
      currentFile: ''
    });
    setTimeout(() => jobStatus.delete(zipUrl), 10000);

    return manifest;
  } finally {
    zip.close().catch(() => {});
  }
}

export async function getArchiveManifest(zipUrl, options = {}) {
  if (!isAllowedArchiveUrl(zipUrl)) {
    throw new Error('Недопустимый URL архива');
  }

  const key = getArchiveKey(zipUrl);

  const cached = readManifest(key);
  if (cached) return cached;

  const inflight = inflightJobs.get(zipUrl);
  if (inflight) return inflight;

  const job = extractArchive(zipUrl, key, options)
    .catch(err => {
      logError('Archive', `Не удалось распаковать ${zipUrl.split('?')[0]}`, err);
      throw err;
    })
    .finally(() => {
      inflightJobs.delete(zipUrl);
    });
  inflightJobs.set(zipUrl, job);
  return job;
}

export function buildArchiveAlbumItems(manifest) {
  const { key, items } = manifest;
  return items.map(item => {
    const fileUrl = `/api/archive/file?key=${key}&n=${item.n}`;
    return {
      id: `pawchive_zip_${key}_${item.n}`,
      originalId: `zip_${item.n}`,
      site: 'pawchive',
      siteName: 'Pawchive',
      previewUrl: fileUrl,
      sampleUrl: fileUrl,
      fileUrl,
      thumb180: fileUrl,
      thumb360: fileUrl,
      thumb720: fileUrl,
      fileExt: item.ext,
      isVideo: item.isVideo,
      isGif: item.ext === 'gif',
      hasSound: false,
      width: 0,
      height: 0,
      title: item.name,
      fileSize: item.size || 0
    };
  });
}

/**
 * Inspects a remote ZIP archive via partial HTTP Range requests without downloading
 * the entire payload (reads EOCD and Central Directory from the tail of the archive in < 500ms).
 */
async function inspectArchiveRemote(zipUrl, key) {
  const reqHeaders = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': resolveSiteReferer(zipUrl) || 'https://pawchive.pw/',
    'Range': 'bytes=-65536'
  };

  jobStatus.set(zipUrl, { phase: 'inspect', percent: 10, scannedFiles: 0, totalFiles: 0, currentFile: '' });

  const res = await fetchSafe(zipUrl, {
    timeout: 15000,
    headers: reqHeaders
  });

  if (res.status !== 206) {
    throw new Error(`Remote range not supported (status ${res.status})`);
  }

  const contentRange = res.headers.get('content-range') || '';
  const totalFileSize = parseInt(contentRange.split('/').pop(), 10) || 0;
  if (!totalFileSize) throw new Error('Cannot determine file size from Content-Range');

  let buf = Buffer.from(await res.arrayBuffer());
  let bufferStart = totalFileSize - buf.length;

  // Search backwards for EOCD signature 0x06054b50
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  // If EOCD not found in last 64KB and file is bigger, fetch last 256KB
  if (eocdOffset === -1 && totalFileSize > 65536) {
    const fetchSize = Math.min(totalFileSize, 262144);
    const res2 = await fetchSafe(zipUrl, {
      timeout: 15000,
      headers: { ...reqHeaders, 'Range': `bytes=-${fetchSize}` }
    });
    if (res2.status === 206) {
      buf = Buffer.from(await res2.arrayBuffer());
      bufferStart = totalFileSize - buf.length;
      for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
          eocdOffset = i;
          break;
        }
      }
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Could not find ZIP End of Central Directory');
  }

  let totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdSize = buf.readUInt32LE(eocdOffset + 12);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  // Check for Zip64 EOCD Locator if standard fields are maxed out
  if (totalEntries === 0xFFFF || cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    const locatorPos = eocdOffset - 20;
    if (locatorPos >= 0 && buf.readUInt32LE(locatorPos) === 0x07064b50) {
      const zip64EocdOffset = Number(buf.readBigUInt64LE(locatorPos + 8));
      const resZip64 = await fetchSafe(zipUrl, {
        timeout: 15000,
        headers: { ...reqHeaders, 'Range': `bytes=${zip64EocdOffset}-${zip64EocdOffset + 60}` }
      });
      if (resZip64.status === 206) {
        const z64Buf = Buffer.from(await resZip64.arrayBuffer());
        if (z64Buf.readUInt32LE(0) === 0x06064b50) {
          totalEntries = Number(z64Buf.readBigUInt64LE(32));
          cdSize = Number(z64Buf.readBigUInt64LE(40));
          cdOffset = Number(z64Buf.readBigUInt64LE(48));
        }
      }
    }
  }

  // Load Central Directory buffer
  let cdBuffer;
  let cdPos;
  if (cdOffset >= bufferStart && (cdOffset + cdSize) <= (bufferStart + buf.length)) {
    cdBuffer = buf;
    cdPos = cdOffset - bufferStart;
  } else {
    const resCD = await fetchSafe(zipUrl, {
      timeout: 15000,
      headers: { ...reqHeaders, 'Range': `bytes=${cdOffset}-${cdOffset + cdSize + 128}` }
    });
    if (resCD.status !== 206) throw new Error('Failed to fetch ZIP Central Directory');
    cdBuffer = Buffer.from(await resCD.arrayBuffer());
    cdPos = 0;
  }

  const fileTree = [];
  const docsToScan = [];
  let totalBytes = 0;
  let isEncrypted = false;

  for (let i = 0; i < totalEntries; i++) {
    if (cdPos + 46 > cdBuffer.length) break;
    const sig = cdBuffer.readUInt32LE(cdPos);
    if (sig !== 0x02014b50) break;

    const flags = cdBuffer.readUInt16LE(cdPos + 8);
    const method = cdBuffer.readUInt16LE(cdPos + 10);
    const compSize = cdBuffer.readUInt32LE(cdPos + 20);
    const uncompSize = cdBuffer.readUInt32LE(cdPos + 24);
    const nameLen = cdBuffer.readUInt16LE(cdPos + 28);
    const extraLen = cdBuffer.readUInt16LE(cdPos + 30);
    const commentLen = cdBuffer.readUInt16LE(cdPos + 32);
    const localHeaderOffset = cdBuffer.readUInt32LE(cdPos + 42);

    const rawName = cdBuffer.toString('utf8', cdPos + 46, cdPos + 46 + nameLen);
    cdPos += 46 + nameLen + extraLen + commentLen;

    const normName = rawName.replace(/\\/g, '/');
    const base = normName.split('/').pop();
    if (!base || base.startsWith('.') || normName.includes('__MACOSX') || normName.endsWith('/')) {
      continue;
    }

    if ((flags & 1) !== 0) isEncrypted = true;
    const ext = getExt(base);
    const isMedia = IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
    const isDoc = ['txt', 'pdf', 'url', 'webloc', 'html', 'htm', 'md', 'nfo', 'json', 'doc', 'docx', 'rtf'].includes(ext);

    totalBytes += uncompSize;

    const entryInfo = {
      name: base,
      path: normName,
      ext,
      size: uncompSize,
      compSize,
      method,
      localHeaderOffset,
      isMedia,
      isDocument: isDoc,
      hasLinks: false,
      linksCount: 0
    };
    fileTree.push(entryInfo);

    if (isDoc && compSize > 0 && compSize <= 35 * 1024 * 1024 && !((flags & 1) !== 0)) {
      docsToScan.push(entryInfo);
    }
  }

  fileTree.sort((a, b) => nameCollator.compare(a.name, b.name));

  // Prioritize documents likely to contain links/passwords
  const docPriorityScore = (d) => {
    const n = (d.name || '').toLowerCase();
    let score = 0;
    if (n.includes('read') || n.includes('link') || n.includes('pass') || n.includes('info') || n.includes('tier') || n.includes('download') || n.includes('url')) score += 100;
    if (d.ext === 'url' || d.ext === 'webloc' || d.ext === 'txt') score += 50;
    if (d.ext === 'pdf') score += 30;
    score -= Math.min(20, Math.floor(d.compSize / (1024 * 1024)));
    return score;
  };
  docsToScan.sort((a, b) => docPriorityScore(b) - docPriorityScore(a));

  const scannedLinks = [];
  const passwords = new Set();
  const MAX_TOTAL_REMOTE_DOC_BYTES = 45 * 1024 * 1024;
  let totalDocBytesScanned = 0;

  // Scan doc files via targeted Range requests
  for (let dIdx = 0; dIdx < docsToScan.length; dIdx++) {
    const doc = docsToScan[dIdx];
    if (totalDocBytesScanned + doc.compSize > MAX_TOTAL_REMOTE_DOC_BYTES && totalDocBytesScanned > 0) {
      break;
    }
    totalDocBytesScanned += doc.compSize;

    const startPct = Math.round(15 + (dIdx / docsToScan.length) * 80);
    const spanPct = Math.max(1, Math.round(80 / docsToScan.length));
    const totalToRead = doc.compSize;
    const totalMbStr = (totalToRead / (1024 * 1024)).toFixed(1);

    jobStatus.set(zipUrl, {
      phase: 'inspect',
      percent: startPct,
      scannedFiles: dIdx,
      totalFiles: fileTree.length,
      currentFile: `${doc.name} (0.0/${totalMbStr} МБ)`
    });

    try {
      const fetchRangeEnd = doc.localHeaderOffset + 30 + (doc.path || doc.name).length + 500 + doc.compSize;
      const resDoc = await fetchSafe(zipUrl, {
        timeout: 25000,
        bodyTimeout: 60000,
        headers: { ...reqHeaders, 'Range': `bytes=${doc.localHeaderOffset}-${fetchRangeEnd}` }
      });
      if (resDoc.status === 206) {
        const reader = resDoc.body.getReader();
        const chunks = [];
        let received = 0;
        let lastReport = Date.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;

          const now = Date.now();
          if (now - lastReport >= 150) {
            lastReport = now;
            const fraction = totalToRead > 0 ? Math.min(1, received / totalToRead) : 0;
            const stepPct = Math.round(startPct + fraction * spanPct);
            const mbStr = (received / (1024 * 1024)).toFixed(1);
            jobStatus.set(zipUrl, {
              phase: 'inspect',
              percent: stepPct,
              scannedFiles: dIdx,
              totalFiles: fileTree.length,
              currentFile: `${doc.name} (${mbStr}/${totalMbStr} МБ)`
            });
          }
        }
        const localBuf = Buffer.concat(chunks);
        if (localBuf.length >= 30 && localBuf.readUInt32LE(0) === 0x04034b50) {
          const lNameLen = localBuf.readUInt16LE(26);
          const lExtraLen = localBuf.readUInt16LE(28);
          const dataStart = 30 + lNameLen + lExtraLen;
          const compressedData = localBuf.subarray(dataStart, dataStart + doc.compSize);

          let decompressedBuf = null;
          if (doc.method === 0) {
            decompressedBuf = compressedData;
          } else if (doc.method === 8) {
            try {
              decompressedBuf = zlib.inflateRawSync(compressedData);
            } catch {}
          }

          if (decompressedBuf) {
            const scanned = scanBufferForLinksAndPasswords(decompressedBuf, doc.name);
            if (scanned.links.length > 0) {
              doc.hasLinks = true;
              doc.linksCount = scanned.links.length;
            }
            for (const p of scanned.passwords) passwords.add(p);
            for (const l of scanned.links) {
              const svc = classifyCloudService(l);
              if (!scannedLinks.some(sl => sl.url === l)) {
                let assignedPass = scanned.passwords[0] || null;
                if (scanned.passwords.length > 1) {
                  const passForSvc = scanned.passwords.find(p => p.toLowerCase().includes(svc.id) || p.toLowerCase().includes(svc.name.toLowerCase()));
                  if (passForSvc) assignedPass = passForSvc;
                }
                scannedLinks.push({
                  url: l,
                  service: svc.name,
                  serviceId: svc.id,
                  icon: svc.icon,
                  sourceFile: doc.name,
                  password: assignedPass
                });
              }
            }
          }
        }
      }
    } catch (e) {
      logError('Archive Inspect Remote', `Ошибка чтения документа ${doc.name}`, e);
    }
  }

  const hasMedia = fileTree.some(f => /\.(jpe?g|png|gif|webp|mp4|webm|mov|mkv)$/i.test(f.name || ''));
  return {
    success: true,
    inspectVersion: 2,
    key,
    zipUrl,
    archiveName: zipUrl.split('?')[0].split('/').pop() || 'archive.zip',
    archiveSize: totalFileSize,
    totalFiles: fileTree.length,
    totalBytes,
    isEncrypted,
    hasMedia,
    scannedLinks,
    passwords: Array.from(passwords),
    fileTree
  };
}

/**
 * Inspects a remote or cached ZIP archive:
 * - Scans file tree
 * - Parses text, pdf, url, html files to detect cloud drive links and passwords
 * - Returns structured file list and extracted links/passwords
 */
export async function inspectArchive(zipUrl, options = {}) {
  if (!zipUrl || !isAllowedArchiveUrl(zipUrl)) {
    throw new Error('Недопустимый источник архива');
  }

  const key = getArchiveKey(zipUrl);
  const inspectPath = path.join(ARCHIVES_DIR, `${key}.inspect.json`);

  // 1. Return cached inspection if already performed
  try {
    const raw = await fs.promises.readFile(inspectPath, 'utf8');
    const cached = JSON.parse(raw);
    if (cached && Array.isArray(cached.fileTree)) {
      const needsRescan = (!cached.inspectVersion || cached.inspectVersion < 2) &&
        (!cached.scannedLinks || cached.scannedLinks.length === 0) &&
        cached.fileTree.some(f => f.isDocument && (f.size || 0) > 100 * 1024);

      if (!needsRescan) {
        if (typeof cached.hasMedia !== 'boolean') {
          cached.hasMedia = cached.fileTree.some(f => /\.(jpe?g|png|gif|webp|mp4|webm|mov|mkv)$/i.test(f.name || ''));
        }
        return cached;
      }
    }
  } catch {}

  const inflight = inflightInspects.get(zipUrl);
  if (inflight) return inflight;

  const job = (async () => {
    await fs.promises.mkdir(ARCHIVES_DIR, { recursive: true });
    const zipPath = path.join(ARCHIVES_DIR, `${key}.zip`);

    // 2. If zip file is not on disk, attempt instant Remote Range Inspection
    if (!fs.existsSync(zipPath)) {
      try {
        logInfo('Archive', `Мгновенная проверка архива через Range-запрос: ${zipUrl.split('?')[0]}`);
        const remoteResult = await inspectArchiveRemote(zipUrl, key);
        if (remoteResult && Array.isArray(remoteResult.fileTree)) {
          await fs.promises.writeFile(inspectPath, JSON.stringify(remoteResult, null, 2), 'utf8');
          jobStatus.set(zipUrl, {
            phase: 'completed',
            percent: 100,
            scannedFiles: remoteResult.fileTree.length,
            totalFiles: remoteResult.totalFiles,
            currentFile: ''
          });
          setTimeout(() => jobStatus.delete(zipUrl), 10000);
          return remoteResult;
        }
      } catch (remoteErr) {
        logInfo('Archive', `Range-инспекция недоступна (${remoteErr.message}), переключение на полное скачивание`);
      }

      // Fallback: download full zip if range inspection wasn't supported
      await downloadArchiveFile(zipUrl, zipPath, options);
    }

  jobStatus.set(zipUrl, {
    phase: 'inspect',
    percent: 0,
    scannedFiles: 0,
    totalFiles: 0,
    currentFile: ''
  });

  // 3. Inspect zip contents with StreamZip
  const zip = new StreamZip.async({ file: zipPath });
  try {
    const rawEntries = Object.values(await zip.entries());
    const totalRawEntries = rawEntries.length;
    jobStatus.set(zipUrl, {
      phase: 'inspect',
      percent: 0,
      scannedFiles: 0,
      totalFiles: totalRawEntries,
      currentFile: ''
    });

    const fileTree = [];
    const scannedLinks = [];
    const passwords = new Set();
    let totalBytes = 0;
    let isEncrypted = false;

    for (let idx = 0; idx < rawEntries.length; idx++) {
      const entry = rawEntries[idx];
      if (entry.isDirectory) continue;
      const rawName = entry.name.replace(/\\/g, '/');
      const base = rawName.split('/').pop();
      if (!base || base.startsWith('.') || rawName.includes('__MACOSX')) continue;

      jobStatus.set(zipUrl, {
        phase: 'inspect',
        percent: totalRawEntries > 0 ? Math.min(100, Math.round(((idx + 1) / totalRawEntries) * 100)) : 0,
        scannedFiles: idx + 1,
        totalFiles: totalRawEntries,
        currentFile: base
      });

      const ext = getExt(base);
      const size = entry.size || 0;
      totalBytes += size;

      if (entry.isEncrypted) {
        isEncrypted = true;
      }

      const isMedia = IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
      const isDoc = ['txt', 'pdf', 'url', 'webloc', 'html', 'htm', 'md', 'nfo', 'json', 'doc', 'docx', 'rtf'].includes(ext);

      let foundEntryLinks = [];
      let foundEntryPass = [];

      // Scan documents under 100MB for links and passwords
      if (isDoc && size > 0 && size < 100 * 1024 * 1024 && !entry.isEncrypted) {
        try {
          const buf = await zip.entryData(entry.name);
          const scanned = scanBufferForLinksAndPasswords(buf, base);
          foundEntryLinks = scanned.links;
          foundEntryPass = scanned.passwords;
          for (const p of foundEntryPass) passwords.add(p);
          for (const l of foundEntryLinks) {
            const svc = classifyCloudService(l);
            if (!scannedLinks.some(sl => sl.url === l)) {
              let assignedPass = foundEntryPass[0] || null;
              if (foundEntryPass.length > 1) {
                const passForSvc = foundEntryPass.find(p => p.toLowerCase().includes(svc.id) || p.toLowerCase().includes(svc.name.toLowerCase()));
                if (passForSvc) assignedPass = passForSvc;
              }
              scannedLinks.push({
                url: l,
                service: svc.name,
                serviceId: svc.id,
                icon: svc.icon,
                sourceFile: base,
                password: assignedPass
              });
            }
          }
        } catch (e) {
          logError('Archive Inspect', `Ошибка чтения файла ${base}`, e);
        }
      }

      fileTree.push({
        name: base,
        path: rawName,
        ext,
        size,
        isMedia,
        isDocument: isDoc,
        hasLinks: foundEntryLinks.length > 0,
        linksCount: foundEntryLinks.length
      });
    }

    fileTree.sort((a, b) => nameCollator.compare(a.name, b.name));

    let archiveSize = 0;
    try {
      const st = fs.statSync(zipPath);
      archiveSize = st.size;
    } catch {}

    const hasMedia = fileTree.some(f => /\.(jpe?g|png|gif|webp|mp4|webm|mov|mkv)$/i.test(f.name || ''));
    const result = {
      success: true,
      inspectVersion: 2,
      key,
      zipUrl,
      archiveName: zipUrl.split('?')[0].split('/').pop() || 'archive.zip',
      archiveSize,
      totalFiles: fileTree.length,
      totalBytes,
      isEncrypted,
      hasMedia,
      scannedLinks,
      passwords: Array.from(passwords),
      fileTree
    };

    await fs.promises.writeFile(inspectPath, JSON.stringify(result, null, 2), 'utf8');

    jobStatus.set(zipUrl, {
      phase: 'completed',
      percent: 100,
      scannedFiles: fileTree.length,
      totalFiles: totalRawEntries,
      currentFile: ''
    });
    setTimeout(() => jobStatus.delete(zipUrl), 10000);

    return result;
  } finally {
    try { await zip.close(); } catch {}
  }
  })().finally(() => {
    inflightInspects.delete(zipUrl);
  });

  inflightInspects.set(zipUrl, job);
  return job;
}

const MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  zip: 'application/zip',
  json: 'application/json'
};

function getFileMime(ext) {
  return MIME_MAP[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

/**
 * Streams or sends an individual file from an archive (from local extracted cache,
 * disk zip file, or on-the-fly remote HTTP Range extraction).
 */
export async function downloadArchiveEntry(zipUrl, targetPathOrName, res, options = {}) {
  if (!zipUrl || !isAllowedArchiveUrl(zipUrl)) {
    return res.status(403).send('Недопустимый источник архива');
  }

  const cleanTarget = String(targetPathOrName || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!cleanTarget || cleanTarget.includes('..')) {
    return res.status(400).send('Неверное имя файла');
  }

  const baseTarget = cleanTarget.split('/').pop();
  const key = getArchiveKey(zipUrl);

  // 1. If archive was already unpacked locally, serve directly from disk
  const manifestPath = path.join(ARCHIVES_DIR, `${key}.manifest.json`);
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = await fs.promises.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const item = Array.isArray(manifest?.items)
        ? manifest.items.find(it => it.name === baseTarget || it.name === cleanTarget)
        : null;
      if (item) {
        const filePath = path.join(ARCHIVES_DIR, `${key}_${item.n}.${item.ext}`);
        if (fs.existsSync(filePath)) {
          return res.download(filePath, item.name || baseTarget);
        }
      }
    } catch {}
  }

  // 2. If full zip file is saved on disk, stream entry directly using yauzl
  const zipPath = path.join(ARCHIVES_DIR, `${key}.zip`);
  if (fs.existsSync(zipPath)) {
    let zip;
    try {
      zip = await openZip(zipPath);
      for await (const entry of zip) {
        const norm = entry.name.replace(/\\/g, '/');
        const base = norm.split('/').pop();
        if (norm === cleanTarget || base === baseTarget || norm.endsWith('/' + cleanTarget)) {
          const ext = getExt(base);
          const mime = getFileMime(ext);
          const asciiSafe = base.replace(/[^\x20-\x7E]/g, '_');
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Disposition', `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodeURIComponent(base)}`);
          if (entry.size > 0) res.setHeader('Content-Length', entry.size);

          const readStream = await zip.openReadStream(entry);
          return readStream.pipe(res);
        }
      }
    } catch (err) {
      logError('Archive Download Entry', `Ошибка извлечения файла ${baseTarget} из локального zip`, err);
    } finally {
      if (zip) try { await zip.close(); } catch {}
    }
  }

  // 3. Remote extract: retrieve entry info via inspectArchive
  const inspection = await inspectArchive(zipUrl, options);
  const fileTree = Array.isArray(inspection?.fileTree) ? inspection.fileTree : [];
  const entry = fileTree.find(f => {
    const fn = (f.path || f.name || '').replace(/\\/g, '/');
    const fb = fn.split('/').pop();
    return fn === cleanTarget || fb === baseTarget || fn.endsWith('/' + cleanTarget);
  });

  if (!entry) {
    return res.status(404).send('Файл не найден в архиве');
  }

  const baseName = entry.name || baseTarget;
  const ext = getExt(baseName);
  const mime = getFileMime(ext);
  const asciiSafe = baseName.replace(/[^\x20-\x7E]/g, '_');

  // If entry is empty (0 bytes)
  if (entry.size === 0 || entry.compSize === 0) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodeURIComponent(baseName)}`);
    res.setHeader('Content-Length', 0);
    return res.end();
  }

  // If localHeaderOffset is present, stream payload via HTTP Range without buffering into RAM
  if (entry.localHeaderOffset !== undefined && entry.compSize > 0) {
    // Probe local file header (first 256 bytes) to determine actual variable header lengths
    const probeRangeEnd = entry.localHeaderOffset + 256;
    const reqHeadersProbe = {
      'User-Agent': 'Mozilla/5.0',
      'Referer': resolveSiteReferer(zipUrl) || 'https://pawchive.pw/',
      'Range': `bytes=${entry.localHeaderOffset}-${probeRangeEnd}`
    };

    try {
      const probeRes = await fetchSafe(zipUrl, { timeout: 15000, headers: reqHeadersProbe });
      if (probeRes.status === 206) {
        const localBuf = Buffer.from(await probeRes.arrayBuffer());
        if (localBuf.length >= 30 && localBuf.readUInt32LE(0) === 0x04034b50) {
          const lNameLen = localBuf.readUInt16LE(26);
          const lExtraLen = localBuf.readUInt16LE(28);
          const dataStart = entry.localHeaderOffset + 30 + lNameLen + lExtraLen;
          const dataEnd = dataStart + entry.compSize - 1;

          // Headers sent to client immediately so progress bar starts from 0 to total size
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Disposition', `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodeURIComponent(baseName)}`);
          if (entry.size > 0) {
            res.setHeader('Content-Length', entry.size);
          }

          const dataHeaders = {
            'User-Agent': 'Mozilla/5.0',
            'Referer': resolveSiteReferer(zipUrl) || 'https://pawchive.pw/',
            'Range': `bytes=${dataStart}-${dataEnd}`
          };

          const dataRes = await fetchSafe(zipUrl, { timeout: 300000, headers: dataHeaders });
          if (dataRes.status === 206 && dataRes.body) {
            const readable = Readable.fromWeb(dataRes.body);

            readable.on('error', (err) => {
              logError('Archive', `Ошибка потока при отдаче файла ${baseName}`, err);
              if (!res.headersSent) res.status(500).end();
              else res.destroy(err);
            });

            if (entry.method === 0) {
              // Stored / uncompressed: stream directly to client
              res.on('close', () => readable.destroy());
              readable.pipe(res);
              return;
            } else if (entry.method === 8) {
              // Deflate: stream through raw inflator into client response
              const inflator = zlib.createInflateRaw();
              inflator.on('error', (err) => {
                logError('Archive', `Ошибка декомпрессии файла ${baseName}`, err);
                res.destroy(err);
              });
              res.on('close', () => {
                readable.destroy();
                inflator.destroy();
              });
              readable.pipe(inflator).pipe(res);
              return;
            }
          }
        }
      }
    } catch (rangeErr) {
      logError('Archive', `Прямое Range-извлечение не удалось для ${baseName}, откат к распаковке архива`, rangeErr);
    }
  }

  // Fallback: If Range extraction failed or offset missing, download archive to local cache and stream file
  await extractArchive(zipUrl, key, options);
  const updatedManifest = readManifest(key);
  const updatedItem = updatedManifest?.items?.find(it => it.name === baseTarget || it.name === cleanTarget);
  if (updatedItem) {
    const filePath = path.join(ARCHIVES_DIR, `${key}_${updatedItem.n}.${updatedItem.ext}`);
    if (fs.existsSync(filePath)) {
      return res.download(filePath, updatedItem.name || baseTarget);
    }
  }

  res.status(404).send('Не удалось извлечь файл из архива');
}

/**
 * Downloads full archive to server cache (multithreaded if enabled) and sends to client.
 */
export async function downloadFullArchive(zipUrl, res, options = {}) {
  if (!zipUrl || !isAllowedArchiveUrl(zipUrl)) {
    return res.status(403).send('Недопустимый источник архива');
  }

  const key = getArchiveKey(zipUrl);
  const zipPath = path.join(ARCHIVES_DIR, `${key}.zip`);
  const rawName = options.name || (zipUrl.split('?')[0].split('/').pop()) || 'archive.zip';
  const cleanName = rawName.replace(/[/\\?%*:|"<>]/g, '_');

  await downloadArchiveFile(zipUrl, zipPath, options);

  if (!fs.existsSync(zipPath)) {
    return res.status(404).send('Не удалось загрузить архив');
  }

  return res.download(zipPath, cleanName);
}

