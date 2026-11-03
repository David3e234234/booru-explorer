// SQLite-backed persistence for user data through node:sqlite (zero extra
// dependencies). Replaces the JSON file store for every user-data document:
// settings, likes/favorites/dislikes, favorite authors, notifications,
// author-check state, the users index and discovered aliases. Binary media
// caches, parser disk caches and `.session_secret` stay on the filesystem.
//
// The database lives at DATA_DIR/booru.db with WAL enabled. Writes are
// synchronous and immediate - there is no debounce and no shutdown flush.
// If node:sqlite is unavailable or BOORU_STORAGE_BACKEND=json, isActive()
// reports false and callers transparently fall back to the legacy JSON files,
// so the process always boots and existing installs keep working.
//
// Legacy JSON files are imported once at first database open (see
// migrateLegacyJson). Import is per-scope marker-guarded and only fills empty
// targets, so it is idempotent and never overwrites newer database rows. The
// legacy files are kept on disk as a rollback path, not deleted.

import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { DATA_DIR, DEFAULT_SETTINGS } from '../config/constants.js';
import { readJsonFile } from './jsonFileStore.js';
import { compactStoredPost } from './storedPostSchema.js';
import { logInfo, logError } from '../utils/logger.js';

const require = createRequire(import.meta.url);

const SCOPE_GLOBAL = 'global';
const USERS_DIRNAME = 'users';

// Only these basenames are imported from a scope directory. Anything else
// (caches, archives, thumbnails) stays on the filesystem untouched.
const LEGACY_SCOPE_FILES = [
  { kind: 'settings', filename: 'settings.json' },
  { kind: 'likes', filename: 'likes.json', collection: true },
  { kind: 'favorites', filename: 'favorites.json', collection: true },
  { kind: 'dislikes', filename: 'dislikes.json', collection: true },
  { kind: 'favorite_authors', filename: 'favorite_authors.json', collection: true },
  { kind: 'feed_state', filename: 'author_feed_state.json' },
  { kind: 'notifications', filename: 'notifications.json' }
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (scope, kind, idx)
);
CREATE TABLE IF NOT EXISTS notifications (
  scope TEXT NOT NULL,
  idx INTEGER NOT NULL,
  notif_id TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  PRIMARY KEY (scope, idx)
);
`;

// { db, dataDir, stmts: Map } while the SQLite backend is active, null while
// the legacy JSON backend is in force. initAttempted prevents repeated
// node:sqlite load attempts after a failure.
let state = null;
let initAttempted = false;
let testOverrides = null;

function currentDataDir() {
  return testOverrides?.dataDir || DATA_DIR;
}

function openDatabase() {
  if (testOverrides?.backend === 'json') return null;
  if (process.env.BOORU_STORAGE_BACKEND === 'json') return null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const dataDir = currentDataDir();
    // The store can initialize before server.js creates the data directories
    // (module-level loads run first), so it brings its own directory up.
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {}
    const db = new DatabaseSync(path.join(dataDir, 'booru.db'));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL;');
    db.exec(SCHEMA_SQL);
    logInfo('SQLite', `Хранилище открыто: ${path.join(dataDir, 'booru.db')}`);
    return { db, dataDir, stmts: new Map(), migrated: false };
  } catch (err) {
    logError('SQLite', 'node:sqlite недоступен, используется файловое JSON-хранилище', err);
    return null;
  }
}

function ensureState() {
  if (state !== null || initAttempted) return state;
  initAttempted = true;
  state = openDatabase();
  if (state) {
    try {
      migrateLegacyJson();
    } catch (err) {
      logError('SQLite', 'Миграция JSON-хранилища завершилась с ошибкой', err);
    }
    state.migrated = true;
  }
  return state;
}

function stmt(name, sql) {
  const s = state.stmts.get(name);
  if (s) return s;
  const prepared = state.db.prepare(sql);
  state.stmts.set(name, prepared);
  return prepared;
}

export function isActive() {
  return ensureState() !== null;
}

export function scopeOf(userId) {
  return userId ? `user:${userId}` : SCOPE_GLOBAL;
}

// --- key/value JSON documents (settings, users index, aliases, feed state) ---

export function kvGet(key, fallback = null) {
  if (!ensureState()) return fallback;
  const row = stmt('kvGet', 'SELECT value FROM kv WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function kvHas(key) {
  if (!ensureState()) return false;
  return Boolean(stmt('kvHas', 'SELECT 1 FROM kv WHERE key = ?').get(key));
}

export function kvSet(key, value) {
  if (!ensureState()) return;
  stmt('kvSet', 'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value ?? null));
}

export function kvDelete(key) {
  if (!ensureState()) return;
  stmt('kvDelete', 'DELETE FROM kv WHERE key = ?').run(key);
}

// --- ordered collections of arbitrary JSON records (posts, authors) ---

export function getCollection(scope, kind, fallback = []) {
  if (!ensureState()) return fallback;
  const rows = stmt('collGet', 'SELECT data FROM posts WHERE scope = ? AND kind = ? ORDER BY idx ASC')
    .all(scope, kind);
  const out = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.data));
    } catch {}
  }
  return out;
}

export function collectionCount(scope, kind) {
  if (!ensureState()) return 0;
  const row = stmt('collCount', 'SELECT COUNT(*) AS n FROM posts WHERE scope = ? AND kind = ?').get(scope, kind);
  return Number(row?.n || 0);
}

export function setCollection(scope, kind, list) {
  if (!ensureState()) return;
  const items = Array.isArray(list) ? list : [];
  const insert = stmt('collIns', 'INSERT INTO posts (scope, kind, idx, data) VALUES (?, ?, ?, ?)');
  state.db.exec('BEGIN');
  try {
    stmt('collDel', 'DELETE FROM posts WHERE scope = ? AND kind = ?').run(scope, kind);
    for (let i = 0; i < items.length; i++) {
      insert.run(scope, kind, i, JSON.stringify(items[i] ?? null));
    }
    state.db.exec('COMMIT');
  } catch (err) {
    try { state.db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

// All scopes holding a collection kind, e.g. to seed tag classification from
// every user's favorite authors.
export function listCollections(kind) {
  if (!ensureState()) return [];
  const rows = stmt('collScopes', 'SELECT DISTINCT scope FROM posts WHERE kind = ?').all(kind);
  return rows.map(row => ({ scope: row.scope, items: getCollection(row.scope, kind, []) }));
}

// --- notifications (ordered, capped by the caller) ---

export function getNotifications(scope, fallback = []) {
  if (!ensureState()) return fallback;
  const rows = stmt('notifGet', 'SELECT data FROM notifications WHERE scope = ? ORDER BY idx ASC').all(scope);
  const out = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.data));
    } catch {}
  }
  return out;
}

export function setNotifications(scope, list) {
  if (!ensureState()) return;
  const items = Array.isArray(list) ? list : [];
  const insert = stmt('notifIns', 'INSERT INTO notifications (scope, idx, notif_id, read, data) VALUES (?, ?, ?, ?, ?)');
  state.db.exec('BEGIN');
  try {
    stmt('notifDel', 'DELETE FROM notifications WHERE scope = ?').run(scope);
    for (let i = 0; i < items.length; i++) {
      const item = items[i] ?? {};
      insert.run(scope, i, String(item.id ?? ''), item.read ? 1 : 0, JSON.stringify(item));
    }
    state.db.exec('COMMIT');
  } catch (err) {
    try { state.db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

// --- maintenance ---

export function deleteScopeData(scope) {
  if (!ensureState()) return;
  stmt('scopeDelPosts', 'DELETE FROM posts WHERE scope = ?').run(scope);
  stmt('scopeDelNotifs', 'DELETE FROM notifications WHERE scope = ?').run(scope);
  kvDelete(`settings:${scope}`);
  kvDelete(`feed_state:${scope}`);
}

export function closeDatabase() {
  if (state) {
    try {
      state.db.close();
    } catch {}
  }
  state = null;
  initAttempted = false;
}

// Test hook: point the store at an isolated data directory (or force the
// legacy JSON backend) and reset the lazy singleton. Call with no arguments
// to restore production behavior.
export function __configureForTests({ dataDir = null, backend = null } = {}) {
  closeDatabase();
  testOverrides = (dataDir || backend) ? { dataDir, backend } : null;
}

// Identity of the active backend configuration. Storage-level caches (global
// settings, users index) key themselves on it so a backend or directory
// switch never serves stale in-memory data.
export function backendFingerprint() {
  if (testOverrides?.backend === 'json' || process.env.BOORU_STORAGE_BACKEND === 'json') return 'json';
  return `sqlite:${currentDataDir()}`;
}

// --- legacy JSON import ---

function legacyUsersIndexFile(dataDir) {
  return path.join(dataDir, 'users.json');
}

function legacyDiscoveredAliasesFile(dataDir) {
  return path.join(dataDir, 'discovered_aliases.json');
}

function insertLegacyCollection(scope, kind, records, stats) {
  const compacted = kind === 'favorite_authors'
    ? records
    : records.map(record => compactStoredPost(record));
  setCollection(scope, kind, compacted);
  stats.records += records.length;
}

function migrateLegacyScope(scope, dir, stats) {
  const markerKey = `migrated:v1:${scope}`;
  if (kvGet(markerKey, null)) return;

  for (const spec of LEGACY_SCOPE_FILES) {
    const file = path.join(dir, spec.filename);
    if (!fs.existsSync(file)) continue;
    try {
      if (spec.kind === 'settings') {
        if (kvHas(`settings:${scope}`)) continue;
        const raw = readJsonFile(file, null);
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length) {
          kvSet(`settings:${scope}`, { ...DEFAULT_SETTINGS, ...raw });
          stats.records += 1;
        }
      } else if (spec.collection) {
        if (collectionCount(scope, spec.kind) > 0) continue;
        const raw = readJsonFile(file, null);
        if (Array.isArray(raw) && raw.length) insertLegacyCollection(scope, spec.kind, raw, stats);
      } else if (spec.kind === 'feed_state') {
        if (kvHas(`feed_state:${scope}`)) continue;
        const raw = readJsonFile(file, null);
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length) {
          kvSet(`feed_state:${scope}`, raw);
          stats.records += 1;
        }
      } else if (spec.kind === 'notifications') {
        if (getNotifications(scope, null)?.length) continue;
        const raw = readJsonFile(file, null);
        if (Array.isArray(raw) && raw.length) {
          setNotifications(scope, raw);
          stats.records += raw.length;
        }
      }
    } catch (err) {
      logError('SQLite', `Не удалось импортировать ${file}`, err);
    }
  }

  if (scope === SCOPE_GLOBAL) {
    // The users index and discovered aliases live only in the global scope.
    try {
      const usersFile = legacyUsersIndexFile(state.dataDir);
      if (fs.existsSync(usersFile) && !kvHas('users_index')) {
        const users = readJsonFile(usersFile, null);
        if (Array.isArray(users) && users.length) {
          kvSet('users_index', users);
          stats.records += users.length;
        }
      }
    } catch (err) {
      logError('SQLite', 'Не удалось импортировать users.json', err);
    }
    try {
      const aliasesFile = legacyDiscoveredAliasesFile(state.dataDir);
      if (fs.existsSync(aliasesFile) && !kvHas('discovered_aliases')) {
        const aliases = readJsonFile(aliasesFile, null);
        if (Array.isArray(aliases) && aliases.length) {
          kvSet('discovered_aliases', aliases);
          stats.records += aliases.length;
        }
      }
    } catch (err) {
      logError('SQLite', 'Не удалось импортировать discovered_aliases.json', err);
    }
  }

  kvSet(markerKey, new Date().toISOString());
  stats.scopes += 1;
}

// Import every scope directory still holding legacy JSON. Runs automatically
// on first database open and is safe to call again at any time: per-scope
// markers make it a no-op after the first pass, and per-target emptiness
// checks prevent overwriting newer database rows.
export function migrateLegacyJson() {
  if (!ensureState()) return { scopes: 0, records: 0 };
  if (state.migrated) return { scopes: 0, records: 0 };

  const stats = { scopes: 0, records: 0 };
  const dataDir = state.dataDir;
  migrateLegacyScope(SCOPE_GLOBAL, dataDir, stats);

  let userDirs = [];
  try {
    userDirs = fs.readdirSync(path.join(dataDir, USERS_DIRNAME), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {}

  for (const name of userDirs) {
    try {
      migrateLegacyScope(scopeOf(name), path.join(dataDir, USERS_DIRNAME, name), stats);
    } catch (err) {
      logError('SQLite', `Не удалось импортировать данные пользователя ${name}`, err);
    }
  }

  if (stats.records > 0) {
    logInfo('SQLite', `Миграция JSON -> SQLite: областей ${stats.scopes}, записей ${stats.records}. Исходные файлы сохранены для отката.`);
  }
  return stats;
}
