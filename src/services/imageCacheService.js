import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { THUMBS_DIR } from '../config/constants.js';

export function detectImageType(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { ext: 'gif', mime: 'image/gif' };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return { ext: 'avif', mime: 'image/avif' };
  }
  if (buf[0] === 0x42 && buf[1] === 0x4D) return { ext: 'bmp', mime: 'image/bmp' };
  return null;
}

export function isValidImageBuffer(buf) {
  return Boolean(detectImageType(buf));
}

export function imageCachePath(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(THUMBS_DIR, `${hash}.img`);
}

export function touchCacheFile(cacheFilePath) {
  const now = new Date();
  fs.promises.utimes(cacheFilePath, now, now).catch(() => {});
}

export async function writeCacheFileAtomic(cacheFilePath, buf) {
  const tmpPath = `${cacheFilePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, buf);
    await fs.promises.rename(tmpPath, cacheFilePath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export async function readCacheFileMime(cacheFilePath) {
  let head = null;
  try {
    const stats = await fs.promises.stat(cacheFilePath);
    if (stats.size <= 0) return null;
    const handle = await fs.promises.open(cacheFilePath, 'r');
    try {
      head = await handle.read(Buffer.alloc(32), 0, 32, 0);
    } finally {
      await handle.close().catch(() => {});
    }
    head = head.buffer.subarray(0, head.bytesRead);
  } catch {
    return null;
  }
  const type = detectImageType(head);
  if (type) return type.mime;
  fs.promises.unlink(cacheFilePath).catch(() => {});
  return null;
}
