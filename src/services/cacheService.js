import fs from 'fs';
import path from 'path';
import { THUMBS_DIR, VIDEOS_DIR } from '../config/constants.js';
import { logInfo, logError } from '../utils/logger.js';

export class MemoryCache {
  constructor(maxItems = 300, defaultTtlMs = 6 * 60 * 1000) {
    this.cache = new Map();
    this.maxItems = maxItems;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // LRU shift
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.cache.size >= this.maxItems) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    const now = Date.now();
    for (const [k, v] of this.cache.entries()) {
      if (now > v.expiresAt) this.cache.delete(k);
    }
    return this.cache.size;
  }
}

export const apiPostsCache = new MemoryCache(400, 6 * 60 * 1000); // posts cached for 6 minutes
export const tagAutocompleteCache = new MemoryCache(600, 30 * 60 * 1000); // tags cached for 30 minutes

export async function getDirectoryStats(dirPath) {
  let totalBytes = 0;
  const fileList = [];
  try {
    const files = await fs.promises.readdir(dirPath).catch(() => []);
    await Promise.all(files.map(async (file) => {
      const fullPath = path.join(dirPath, file);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (stats.isFile()) {
          totalBytes += stats.size;
          fileList.push({ path: fullPath, size: stats.size, mtime: stats.mtimeMs });
        }
      } catch {}
    }));
  } catch {}
  return { totalBytes, fileList };
}

import { getSettings } from './storageService.js';

export async function cleanDiskCacheIfNeeded(explicitMaxBytes = null) {
  try {
    let maxBytes = explicitMaxBytes;
    if (maxBytes === null || maxBytes === undefined) {
      try {
        const settings = getSettings();
        const mb = Number(settings?.maxServerCacheMb);
        if (mb === 0) {
          return; // 0 = unlimited
        }
        if (mb > 0) {
          maxBytes = mb * 1024 * 1024;
        } else {
          maxBytes = 1.5 * 1024 * 1024 * 1024;
        }
      } catch {
        maxBytes = 1.5 * 1024 * 1024 * 1024;
      }
    }

    if (!maxBytes || maxBytes <= 0) return;

    const thumbs = await getDirectoryStats(THUMBS_DIR);
    const videos = await getDirectoryStats(VIDEOS_DIR);
    let totalBytes = thumbs.totalBytes + videos.totalBytes;

    if (totalBytes > maxBytes) {
      logInfo('Cache', `Превышен лимит кэша (${(totalBytes / 1024 / 1024).toFixed(1)} MB / ${(maxBytes / 1024 / 1024).toFixed(1)} MB). Автоочистка LRU...`);
      const allFiles = [...thumbs.fileList, ...videos.fileList];
      allFiles.sort((a, b) => a.mtime - b.mtime);

      for (const f of allFiles) {
        if (totalBytes <= maxBytes * 0.75) break;
        try {
          await fs.promises.unlink(f.path);
          totalBytes -= f.size;
        } catch {}
      }
      logInfo('Cache', `Автоочистка завершена. Новый размер кэша: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    }
  } catch (err) {
    logError('Cache', 'Ошибка очистки дискового кэша', err);
  }
}

// Periodic check every 30 minutes
setInterval(() => cleanDiskCacheIfNeeded(), 30 * 60 * 1000);
