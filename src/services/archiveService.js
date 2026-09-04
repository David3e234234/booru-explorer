import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import StreamZip from 'node-stream-zip';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { ARCHIVES_DIR } from '../config/constants.js';
import { fetchSafe } from '../utils/network.js';
import { logError, logInfo } from '../utils/logger.js';

const ALLOWED_HOSTS = ['file.pawchive.pw', 'file.pawchive.st'];

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

// Deduplicate concurrent extractions of the same archive
const inflightJobs = new Map();

// Download/extract progress, polled by the client loading indicator
const jobStatus = new Map(); // zipUrl -> { phase: 'download'|'extract', received, total }

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
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) return false;
    const cleanPath = parsed.pathname.toLowerCase();
    const queryF = (parsed.searchParams.get('f') || '').toLowerCase();
    return cleanPath.endsWith('.zip') || queryF.endsWith('.zip');
  } catch {
    return false;
  }
}

export function getArchiveKey(zipUrl) {
  return crypto.createHash('md5').update(zipUrl).digest('hex');
}

function readManifest(key) {
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

export function scanBufferForLinksAndPasswords(buf, filename = '') {
  const links = new Set();
  const passwords = new Set();
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const addUrl = (u) => {
    let clean = String(u || '').trim();
    clean = clean.replace(/[\)\]\>,\.;]+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }
    try {
      const parsed = new URL(clean);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        links.add(clean);
      }
    } catch {}
  };

  const addPass = (p) => {
    let clean = String(p || '').trim();
    clean = clean.replace(/^[:=–—\s]+/, '').replace(/[\r\n,;"'<>()\[\]]+$/, '').trim();
    if (clean && clean.length >= 2 && clean.length <= 80 && !clean.startsWith('http') && !clean.startsWith('www.')) {
      passwords.add(clean);
    }
  };

  const scanText = (str) => {
    if (!str || typeof str !== 'string') return;
    const urlRegex = /(https?:\/\/[^\s<>"')]+|(?:mega\.(?:nz|io|co\.nz)|drive\.google\.com|disk\.yandex\.(?:ru|com)|yadi\.sk|dropbox\.com|mediafire\.com|1drv\.ms)\/[^\s<>"')]+)/gi;
    let m;
    while ((m = urlRegex.exec(str)) !== null) {
      addUrl(m[1]);
    }
    const passRegex = /(?:password|pass|пароль|pwd|passcode|secret\s*key|access\s*code|ключ)\s*[:=–—\s]\s*([^\r\n,;"'<>]{2,60})/gi;
    while ((m = passRegex.exec(str)) !== null) {
      addPass(m[1]);
    }
  };

  const rawUtf8 = buf.toString('utf8');
  scanText(rawUtf8);
  const rawLatin1 = buf.toString('latin1');
  if (rawLatin1 !== rawUtf8) scanText(rawLatin1);

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

    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    while ((m = streamRegex.exec(rawLatin1)) !== null) {
      const streamBytes = Buffer.from(m[1], 'latin1');
      try {
        const inflated = zlib.inflateSync(streamBytes);
        scanText(inflated.toString('utf8'));
        scanText(inflated.toString('latin1'));
      } catch {
        try {
          const rawInflated = zlib.inflateRawSync(streamBytes);
          scanText(rawInflated.toString('utf8'));
          scanText(rawInflated.toString('latin1'));
        } catch {}
      }
    }
  }

  return {
    links: Array.from(links),
    passwords: Array.from(passwords)
  };
}

async function extractArchive(zipUrl, key) {
  const tmpPath = path.join(ARCHIVES_DIR, `${key}.downloading`);
  try {
    await fs.promises.mkdir(ARCHIVES_DIR, { recursive: true });
    logInfo('Archive', `Скачивание архива: ${zipUrl.split('?')[0]}`);
    const response = await fetchSafe(zipUrl, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      // Archives run to hundreds of megabytes and are streamed straight to disk,
      // so the header deadline must not be armed against the body read
      streamBody: true,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://pawchive.pw/',
        'Accept': '*/*'
      }
    });
    if (!response.ok || !response.body) {
      // An unreleased response body keeps the undici socket checked out
      try { await response.body?.cancel(); } catch {}
      throw new Error(`HTTP ${response.status}`);
    }

    const totalBytesHeader = parseInt(response.headers.get('content-length'), 10) || 0;
    jobStatus.set(zipUrl, { phase: 'download', received: 0, total: totalBytesHeader });
    const progressCounter = new Transform({
      transform(chunk, enc, cb) {
        const st = jobStatus.get(zipUrl);
        if (st) st.received += chunk.length;
        cb(null, chunk);
      }
    });

    await pipeline(Readable.fromWeb(response.body), progressCounter, fs.createWriteStream(tmpPath));

    const downloadStatus = jobStatus.get(zipUrl);
    if (downloadStatus) downloadStatus.phase = 'extract';

    const zip = new StreamZip.async({ file: tmpPath });
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

      let totalBytes = 0;
      const items = [];
      for (const entry of entries) {
        if (items.length >= MAX_FILES) break;
        const size = entry.size || 0;
        if (size > MAX_ENTRY_BYTES) continue;
        if (totalBytes + size > MAX_TOTAL_BYTES) break;

        const base = entry.name.replace(/\\/g, '/').split('/').pop();
        const ext = getExt(base);
        const n = items.length + 1;
        const destPath = path.join(ARCHIVES_DIR, `${key}_${n}.${ext}`);
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
      return manifest;
    } finally {
      zip.close().catch(() => {});
    }
  } finally {
    jobStatus.delete(zipUrl);
    fs.promises.unlink(tmpPath).catch(() => {});
  }
}

export async function getArchiveManifest(zipUrl) {
  if (!isAllowedArchiveUrl(zipUrl)) {
    throw new Error('Недопустимый URL архива');
  }

  const key = getArchiveKey(zipUrl);

  const cached = readManifest(key);
  if (cached) return cached;

  const inflight = inflightJobs.get(zipUrl);
  if (inflight) return inflight;

  const job = extractArchive(zipUrl, key)
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
 * Inspects a remote or cached ZIP archive:
 * - Scans file tree
 * - Parses text, pdf, url, html files to detect cloud drive links and passwords
 * - Returns structured file list and extracted links/passwords
 */
export async function inspectArchive(zipUrl) {
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
      return cached;
    }
  } catch {}

  await fs.promises.mkdir(ARCHIVES_DIR, { recursive: true });
  const zipPath = path.join(ARCHIVES_DIR, `${key}.zip`);
  const downloadingPath = path.join(ARCHIVES_DIR, `${key}.downloading`);

  // 2. Download zip if not already on disk
  if (!fs.existsSync(zipPath)) {
    // If downloading is in progress or extractArchive has a file, check
    logInfo('Archive', `Скачивание архива для инспекции: ${zipUrl.split('?')[0]}`);
    const response = await fetchSafe(zipUrl, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      streamBody: true,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://pawchive.pw/',
        'Accept': '*/*'
      }
    });
    if (!response.ok || !response.body) {
      try { await response.body?.cancel(); } catch {}
      throw new Error(`HTTP ${response.status}`);
    }

    const totalBytesHeader = parseInt(response.headers.get('content-length'), 10) || 0;
    jobStatus.set(zipUrl, { phase: 'download', received: 0, total: totalBytesHeader });
    const progressCounter = new Transform({
      transform(chunk, enc, cb) {
        const st = jobStatus.get(zipUrl);
        if (st) st.received += chunk.length;
        cb(null, chunk);
      }
    });

    await pipeline(Readable.fromWeb(response.body), progressCounter, fs.createWriteStream(downloadingPath));
    await fs.promises.rename(downloadingPath, zipPath);
  }

  const downloadStatus = jobStatus.get(zipUrl);
  if (downloadStatus) downloadStatus.phase = 'inspect';

  // 3. Inspect zip contents with StreamZip
  const zip = new StreamZip.async({ file: zipPath });
  try {
    const rawEntries = Object.values(await zip.entries());
    const fileTree = [];
    const scannedLinks = [];
    const passwords = new Set();
    let totalBytes = 0;
    let isEncrypted = false;

    for (const entry of rawEntries) {
      if (entry.isDirectory) continue;
      const rawName = entry.name.replace(/\\/g, '/');
      const base = rawName.split('/').pop();
      if (!base || base.startsWith('.') || rawName.includes('__MACOSX')) continue;
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

      // Scan documents under 15MB for links and passwords
      if (isDoc && size > 0 && size < 15 * 1024 * 1024 && !entry.isEncrypted) {
        try {
          const buf = await zip.entryData(entry.name);
          const scanned = scanBufferForLinksAndPasswords(buf, base);
          foundEntryLinks = scanned.links;
          foundEntryPass = scanned.passwords;
          for (const p of foundEntryPass) passwords.add(p);
          for (const l of foundEntryLinks) {
            const svc = classifyCloudService(l);
            if (!scannedLinks.some(sl => sl.url === l)) {
              scannedLinks.push({
                url: l,
                service: svc.name,
                serviceId: svc.id,
                icon: svc.icon,
                sourceFile: base,
                password: foundEntryPass[0] || null
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

    const result = {
      success: true,
      key,
      zipUrl,
      archiveName: zipUrl.split('?')[0].split('/').pop() || 'archive.zip',
      archiveSize,
      totalFiles: fileTree.length,
      totalBytes,
      isEncrypted,
      scannedLinks,
      passwords: Array.from(passwords),
      fileTree
    };

    await fs.promises.writeFile(inspectPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  } finally {
    try { await zip.close(); } catch {}
    jobStatus.delete(zipUrl);
  }
}
