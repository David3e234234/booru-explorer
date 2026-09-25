import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, DEFAULT_SETTINGS, SECRET_SETTING_FIELDS } from '../config/constants.js';
import { readJsonFile, writeJsonFile, writeJsonFileAsync } from './storageService.js';
import { logInfo, logError } from '../utils/logger.js';

export const USERS_DIR = path.join(DATA_DIR, 'users');
export const USERS_INDEX_FILE = path.join(DATA_DIR, 'users.json');

// Ensure the users directory exists
if (!fs.existsSync(USERS_DIR)) {
  try {
    fs.mkdirSync(USERS_DIR, { recursive: true, mode: 0o700 });
  } catch (err) {
    logError('UserService', 'Не удалось создать директорию users', err);
  }
}

// Secret key for signing tokens (persists across server restarts)
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = path.join(DATA_DIR, '.session_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const secret = fs.readFileSync(secretFile, 'utf-8').trim();
      if (secret) return secret;
    }
    const newSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, newSecret, { encoding: 'utf-8', mode: 0o600 });
    return newSecret;
  } catch (err) {
    return crypto.randomBytes(32).toString('hex');
  }
}
const JWT_SECRET = getSessionSecret();

/**
 * Hash a password via crypto.scryptSync
 */
export async function hashPassword(password, salt = null) {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, generatedSalt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return { hash: derived.toString('hex'), salt: generatedSalt };
}

export async function verifyPassword(password, hash, salt) {
  try {
    const checkHash = await hashPassword(password, salt);
    const stored = Buffer.from(hash, 'hex');
    const computed = Buffer.from(checkHash.hash, 'hex');
    if (stored.length !== computed.length) return false;
    return crypto.timingSafeEqual(stored, computed);
  } catch {
    return false;
  }
}

/**
 * Generate an auth token (HMAC-SHA256)
 */
export function generateToken(payload, expiresInDays = 30) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + (expiresInDays * 24 * 60 * 60);
  const fullPayload = { ...payload, exp };
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payloadB64}`)
    .digest('base64url');

  return `${header}.${payloadB64}.${signature}`;
}

export function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payloadB64, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payloadB64}`)
      .digest('base64url');

    const received = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Get the list of all users (index)
 */
export function getUsersList() {
  return readJsonFile(USERS_INDEX_FILE, []);
}

/**
 * Save the user list
 */
export function saveUsersList(users) {
  return writeJsonFile(USERS_INDEX_FILE, users);
}

/**
 * Get the path to a user's personal folder
 */
export function getUserDataDir(userId) {
  if (!userId) return null;
  const userDir = path.join(USERS_DIR, userId);
  if (!fs.existsSync(userDir)) {
    try {
      fs.mkdirSync(userDir, { recursive: true, mode: 0o700 });
    } catch {}
  }
  return userDir;
}

/**
 * Find a user by username (case-insensitive)
 */
export function findUserByUsername(username) {
  if (!username) return null;
  const users = getUsersList();
  const clean = username.trim().toLowerCase();
  return users.find(u => (u.username || '').toLowerCase() === clean) || null;
}

/**
 * Find a user by ID
 */
export function findUserById(userId) {
  if (!userId) return null;
  const users = getUsersList();
  return users.find(u => u.id === userId) || null;
}

/**
 * Register a new user
 */
export async function registerUser(username, password, initialData = {}) {
  const cleanUsername = (username || '').trim();
  if (cleanUsername.length < 3 || cleanUsername.length > 30) {
    throw new Error('Имя пользователя должно быть от 3 до 30 символов');
  }
  if (!/^[a-zA-Z0-9_\u0400-\u04FF-]+$/.test(cleanUsername)) {
    throw new Error('Имя пользователя может содержать буквы, цифры, дефис и подчеркивание');
  }
  if (!password || password.length < 8 || password.length > 128) {
    throw new Error('Пароль должен быть от 8 до 128 символов');
  }
  if (findUserByUsername(cleanUsername)) {
    throw new Error('Пользователь с таким логином уже существует');
  }

  const userId = 'u_' + crypto.randomBytes(6).toString('hex');
  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();

  const user = {
    id: userId,
    username: cleanUsername,
    passwordHash: hash,
    salt: salt,
    avatar: '',
    tokenVersion: 0,
    createdAt: now,
    lastLoginAt: now
  };

  const users = getUsersList();
  users.push(user);
  await saveUsersList(users);

  const userDir = getUserDataDir(userId);
  const userSettings = { ...DEFAULT_SETTINGS, ...(initialData.settings || {}) };
  const userFavorites = Array.isArray(initialData.favorites) ? initialData.favorites : [];
  const userLikes = Array.isArray(initialData.likes) ? initialData.likes : [];
  const userDislikes = Array.isArray(initialData.dislikes) ? initialData.dislikes : [];
  const userFavoriteAuthors = Array.isArray(initialData.favoriteAuthors) ? initialData.favoriteAuthors : [];

  await Promise.all([
    writeJsonFile(path.join(userDir, 'settings.json'), userSettings),
    writeJsonFile(path.join(userDir, 'favorites.json'), userFavorites),
    writeJsonFile(path.join(userDir, 'likes.json'), userLikes),
    writeJsonFile(path.join(userDir, 'dislikes.json'), userDislikes),
    writeJsonFile(path.join(userDir, 'favorite_authors.json'), userFavoriteAuthors),
    writeJsonFile(path.join(userDir, 'author_feed_state.json'), {})
  ]);
  logInfo('Auth', `Зарегистрирован новый пользователь: ${cleanUsername} (ID: ${userId})`);

  const token = generateToken({ id: userId, username: cleanUsername, tokenVersion: 0 });
  const { passwordHash, salt: _, tokenVersion: __, ...safeUser } = user;
  return { user: safeUser, token };
}

export function exportAccountRecord(userId) {
  const user = findUserById(userId);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar || '',
    createdAt: user.createdAt || null
  };
}

export async function restoreUser(account = {}, password = '') {
  const cleanUsername = String(account.username || '').trim();
  if (cleanUsername.length < 3 || cleanUsername.length > 30 ||
      !/^[a-zA-Z0-9_\u0400-\u04FF-]+$/.test(cleanUsername)) {
    throw new Error('Некорректное имя пользователя в файле');
  }
  if (!password || password.length < 8 || password.length > 128) {
    throw new Error('Введите пароль аккаунта из файла');
  }

  const users = getUsersList();
  const idx = users.findIndex(u => (u.username || '').toLowerCase() === cleanUsername.toLowerCase());

  if (idx !== -1) {
    const existing = users[idx];
    if (!(await verifyPassword(password, existing.passwordHash, existing.salt))) {
      const err = new Error('Неверный пароль для существующего аккаунта');
      err.statusCode = 401;
      throw err;
    }
    const token = generateToken({
      id: existing.id,
      username: existing.username,
      tokenVersion: existing.tokenVersion || 0
    });
    const { passwordHash, salt: _, tokenVersion: __, ...safeUser } = existing;
    return { user: safeUser, token, restored: false };
  }

  const { hash, salt } = await hashPassword(password);
  const userId = 'u_' + crypto.randomBytes(6).toString('hex');
  const now = new Date().toISOString();
  const user = {
    id: userId,
    username: cleanUsername,
    passwordHash: hash,
    salt,
    avatar: typeof account.avatar === 'string' ? account.avatar : '',
    tokenVersion: 0,
    createdAt: account.createdAt || now,
    lastLoginAt: now
  };

  users.push(user);
  await saveUsersList(users);

  const userDir = getUserDataDir(userId);
  await Promise.all([
    writeJsonFile(path.join(userDir, 'settings.json'), { ...DEFAULT_SETTINGS }),
    writeJsonFile(path.join(userDir, 'favorites.json'), []),
    writeJsonFile(path.join(userDir, 'likes.json'), []),
    writeJsonFile(path.join(userDir, 'dislikes.json'), []),
    writeJsonFile(path.join(userDir, 'favorite_authors.json'), []),
    writeJsonFile(path.join(userDir, 'author_feed_state.json'), {})
  ]);
  logInfo('Auth', `Аккаунт восстановлен из бэкапа: ${cleanUsername} (ID: ${userId})`);

  const token = generateToken({ id: userId, username: cleanUsername, tokenVersion: 0 });
  const { passwordHash, salt: _, tokenVersion: __, ...safeUser } = user;
  return { user: safeUser, token, restored: true };
}

/**
 * Log a user in
 */
export async function loginUser(username, password, initialData = null) {
  const cleanUsername = (username || '').trim();
  const user = findUserByUsername(cleanUsername);
  if (!user) {
    throw new Error('Неверный логин или пароль');
  }

  if (!(await verifyPassword(password, user.passwordHash, user.salt))) {
    throw new Error('Неверный логин или пароль');
  }

  user.lastLoginAt = new Date().toISOString();
  const users = getUsersList();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    users[idx] = user;
    await saveUsersList(users);
  }

  const userDir = getUserDataDir(user.id);
  const settingsFile = path.join(userDir, 'settings.json');
  const userSettings = { ...DEFAULT_SETTINGS, ...readJsonFile(settingsFile, {}) };

  if (initialData?.settings && typeof initialData.settings === 'object') {
    let changed = false;
    for (const field of SECRET_SETTING_FIELDS) {
      const existingVal = userSettings[field];
      const incomingVal = initialData.settings[field];
      if ((!existingVal || String(existingVal).trim() === '') && incomingVal && String(incomingVal).trim() !== '') {
        userSettings[field] = incomingVal;
        changed = true;
      }
    }
    if (changed) {
      await writeJsonFile(settingsFile, userSettings);
      logInfo('Auth', `Локальные API-ключи перенесены в аккаунт: ${cleanUsername}`);
    }
  }

  const token = generateToken({
    id: user.id,
    username: user.username,
    tokenVersion: user.tokenVersion || 0
  });
  const { passwordHash, salt: _, tokenVersion: __, ...safeUser } = user;
  return { user: safeUser, token, settings: userSettings };
}

export async function revokeUserTokens(userId) {
  const users = getUsersList();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return false;
  users[idx].tokenVersion = (users[idx].tokenVersion || 0) + 1;
  await saveUsersList(users);
  return true;
}

/**
 * Get a user profile
 */
export function getUserProfile(userId) {
  const user = findUserById(userId);
  if (!user) return null;
  const { passwordHash, salt: _, tokenVersion: __, ...safeUser } = user;
  return safeUser;
}

function resolveRequestUser(req) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.substring(7).trim()
    : '';
  const payload = verifyToken(token);
  if (!payload?.id) return null;
  const user = findUserById(payload.id);
  if (!user) return null;
  if ((payload.tokenVersion || 0) !== (user.tokenVersion || 0)) return null;
  return payload;
}

export function authMiddleware(req, res, next) {
  const user = resolveRequestUser(req);
  if (user) req.user = user;
  next();
}

export function requireAuth(req, res, next) {
  const user = resolveRequestUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }
  req.user = user;
  next();
}

export function requireOwner(req, res, next) {
  const user = resolveRequestUser(req);
  const adminToken = String(process.env.BOORU_ADMIN_TOKEN || '').trim();
  if (adminToken) {
    const provided = String(req.headers['x-booru-admin-token'] || '');
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(adminToken);
    if (providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      // The token is the credential on its own. Requiring a session here would make
      // every server-wide operation unreachable for a token-only operator.
      if (user) req.user = user;
      return next();
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Не авторизован' });
    }
    return res.status(403).json({ success: false, message: 'Требуется прав владельца' });
  }
  if (!user) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }
  const owner = getUsersList()[0];
  if (!owner || owner.id !== user.id) {
    return res.status(403).json({ success: false, message: 'Операция доступна только владельцу' });
  }
  req.user = user;
  next();
}
