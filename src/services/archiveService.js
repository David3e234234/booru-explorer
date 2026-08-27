import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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

async function extractArchive(zipUrl, key) {
  const tmpPath = path.join(ARCHIVES_DIR, `${key}.downloading`);
  try {
    await fs.promises.mkdir(ARCHIVES_DIR, { recursive: true });
    logInfo('Archive', `Скачивание архива: ${zipUrl.split('?')[0]}`);
    const response = await fetchSafe(zipUrl, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: { 'Referer': 'https://pawchive.pw/', 'Accept': '*/*' }
    });
    if (!response.ok || !response.body) {
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
