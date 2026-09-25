import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logError } from '../utils/logger.js';

const pendingWrites = new Map();
const pendingData = new Map();
const revisions = new Map();
const writeQueues = new Map();

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

async function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function writeFileAtomicSync(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
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
      const content = JSON.stringify(data, null, 2);
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

export function readJsonFile(filePath, defaultData) {
  if (pendingData.has(filePath)) {
    return cloneData(pendingData.get(filePath));
  }
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      try {
        return JSON.parse(content);
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
      writeFileAtomicSync(filePath, JSON.stringify(data, null, 2));
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
