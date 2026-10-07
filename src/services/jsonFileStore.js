import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { logError } from '../utils/logger.js';

const pendingWrites = new Map();
const pendingData = new Map();
const revisions = new Map();
const writeQueues = new Map();

// Collections hold one full post copy per entry and are never trimmed, so their
// size is dominated by repeated field names and long tag strings. gzip collapses
// both: a measured likes.json went from 1895 KB pretty-printed to 182 KB, and a
// record from 3496 to 372 bytes. Settings and the user index stay plain JSON
// because they are small and get edited by hand.
const COMPRESSED_BASENAMES = new Set([
  'likes.json', 'favorites.json', 'dislikes.json', 'favorite_authors.json'
]);

function isCompressedPath(filePath) {
  return COMPRESSED_BASENAMES.has(path.basename(filePath));
}

function cloneData(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function quarantineCorruptFile(filePath, err) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.corrupt-${stamp}`;
    fs.renameSync(filePath, backupPath);
    logError('Storage', `Файл ${filePath} повреждён и не читается как JSON. Копия сохранена как ${backupPath}`, err);
  } catch (renameErr) {
    logError('Storage', `Не удалось сохранить копию повреждённого файла ${filePath}`, renameErr);
  }
}

function cancelPendingWrite(filePath) {
  const timer = pendingWrites.get(filePath);
  if (!timer) return;
  clearTimeout(timer);
  pendingWrites.delete(filePath);
}

function stageWrite(filePath, data) {
  pendingData.set(filePath, data);
  const revision = (revisions.get(filePath) || 0) + 1;
  revisions.set(filePath, revision);
  cancelPendingWrite(filePath);
  return revision;
}

// Serialize for disk: compact always, gzipped for collections. The payload is
// returned as a Buffer so the caller does not have to know about encoding.
function serializeForDisk(filePath, data) {
  const json = JSON.stringify(data);
  if (isCompressedPath(filePath)) {
    return zlib.gzipSync(json, { level: zlib.constants.Z_DEFAULT_COMPRESSION });
  }
  return Buffer.from(json, 'utf8');
}

async function writeFileAtomic(filePath, buffer) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function writeFileAtomicSync(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

function enqueueWrite(filePath, revision) {
  const previous = writeQueues.get(filePath) || Promise.resolve(true);
  const task = previous
    .catch(() => false)
    .then(async () => {
      if (revision !== revisions.get(filePath)) return true;
      const data = pendingData.get(filePath);
      if (data === undefined) return true;
      const content = serializeForDisk(filePath, data);
      await writeFileAtomic(filePath, content);
      if (revision === revisions.get(filePath)) {
        pendingData.delete(filePath);
      }
      return true;
    })
    .catch((err) => {
      logError('Storage', `Ошибка записи ${filePath}`, err);
      return false;
    });

  const tracked = task.finally(() => {
    if (writeQueues.get(filePath) === tracked) {
      writeQueues.delete(filePath);
    }
  });
  writeQueues.set(filePath, tracked);
  return tracked;
}

// Detect gzip by its magic bytes instead of the file name: a collection written
// before this change is plain JSON on disk and must keep reading.
function isGzipBuffer(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function decodeJsonBuffer(buffer) {
  const text = isGzipBuffer(buffer) ? zlib.gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
  return JSON.parse(text);
}

// Lets the boot-time migration skip files that are already compact, so a
// migration does not re-read and re-write every collection on every start.
export function isCompressedJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    return isGzipBuffer(fs.readFileSync(filePath));
  } catch {
    return false;
  }
}

export function readJsonFile(filePath, defaultData) {
  if (pendingData.has(filePath)) {
    return cloneData(pendingData.get(filePath));
  }
  try {
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      try {
        return decodeJsonBuffer(buffer);
      } catch (parseErr) {
        quarantineCorruptFile(filePath, parseErr);
        return cloneData(defaultData);
      }
    }
  } catch (err) {
    logError('Storage', `Ошибка чтения ${filePath}`, err);
  }
  return cloneData(defaultData);
}

export function writeJsonFile(filePath, data) {
  const revision = stageWrite(filePath, data);
  return enqueueWrite(filePath, revision);
}

export function writeJsonFileAsync(filePath, data, debounceMs = 150) {
  const revision = stageWrite(filePath, data);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingWrites.delete(filePath);
      enqueueWrite(filePath, revision).then(resolve, () => resolve(false));
    }, Math.max(0, debounceMs));
    pendingWrites.set(filePath, timer);
  });
}

export function flushPendingWritesSync() {
  for (const filePath of [...pendingWrites.keys()]) cancelPendingWrite(filePath);
  let ok = true;
  for (const [filePath, data] of pendingData.entries()) {
    try {
      writeFileAtomicSync(filePath, serializeForDisk(filePath, data));
    } catch (err) {
      ok = false;
      logError('Storage', `Не удалось сбросить отложенную запись ${filePath}`, err);
    }
  }
  pendingData.clear();
  return ok;
}

export async function flushPendingWrites() {
  for (const filePath of [...pendingWrites.keys()]) cancelPendingWrite(filePath);

  for (let pass = 0; pass < 3; pass++) {
    const queued = [...writeQueues.values()];
    const staged = [];
    for (const filePath of pendingData.keys()) {
      const revision = revisions.get(filePath);
      if (revision !== undefined) staged.push(enqueueWrite(filePath, revision));
    }
    const results = await Promise.all([...queued, ...staged]);
    if (!pendingData.size && !writeQueues.size) return results.every(Boolean);
  }

  return ![...writeQueues.values()].some(queue => queue && typeof queue.then === 'function');
}
