import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, DEFAULT_SETTINGS } from '../config/constants.js';
import { readJsonFile, writeJsonFile, writeJsonFileAsync } from './storageService.js';
import { logInfo, logError } from '../utils/logger.js';

export const USERS_DIR = path.join(DATA_DIR, 'users');
export const USERS_INDEX_FILE = path.join(DATA_DIR, 'users.json');

// Ensure the users directory exists
if (!fs.existsSync(USERS_DIR)) {
  try {
    fs.mkdirSync(USERS_DIR, { recursive: true });
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
    fs.writeFileSync(secretFile, newSecret, 'utf-8');
    return newSecret;
  } catch (err) {
    return crypto.randomBytes(32).toString('hex');
  }
}
const JWT_SECRET = getSessionSecret();

/**
 * Hash a password via crypto.scryptSync
 */
export function hashPassword(password, salt = null) {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, generatedSalt, 64).toString('hex');
  return { hash, salt: generatedSalt };
}

/**
 * Verify a password
 */
export function verifyPassword(password, hash, salt) {
  try {
    const checkHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(checkHash, 'hex'));
  } catch (err) {
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

/**
 * Validate and decode a token
 */
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
      
    if (signature !== expectedSignature) return null;
    
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // expired
    }
    return payload;
  } catch (err) {
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
      fs.mkdirSync(userDir, { recursive: true });
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
export function registerUser(username, password, initialData = {}) {
  const cleanUsername = (username || '').trim();
  if (cleanUsername.length < 3 || cleanUsername.length > 30) {
    throw new Error('Имя пользователя должно быть от 3 до 30 символов');
  }
  if (!/^[a-zA-Z0-9_\u0400-\u04FF-]+$/.test(cleanUsername)) {
    throw new Error('Имя пользователя может содержать буквы, цифры, дефис и подчеркивание');
  }
  if (!password || password.length < 4) {
    throw new Error('Пароль должен быть не менее 4 символов');
  }
  if (findUserByUsername(cleanUsername)) {
    throw new Error('Пользователь с таким логином уже существует');
  }

  const userId = 'u_' + crypto.randomBytes(6).toString('hex');
  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();

  const user = {
    id: userId,
    username: cleanUsername,
    passwordHash: hash,
    salt: salt,
    avatar: '',
    createdAt: now,
    lastLoginAt: now
  };

  const users = getUsersList();
  users.push(user);
  saveUsersList(users);

  // Create isolated data files for the new user
  const userDir = getUserDataDir(userId);
  const userSettings = { ...DEFAULT_SETTINGS, ...(initialData.settings || {}) };
  const userFavorites = Array.isArray(initialData.favorites) ? initialData.favorites : [];
  const userLikes = Array.isArray(initialData.likes) ? initialData.likes : [];
  const userDislikes = Array.isArray(initialData.dislikes) ? initialData.dislikes : [];
  const userFavoriteAuthors = Array.isArray(initialData.favoriteAuthors) ? initialData.favoriteAuthors : [];

  writeJsonFile(path.join(userDir, 'settings.json'), userSettings);
  writeJsonFile(path.join(userDir, 'favorites.json'), userFavorites);
  writeJsonFile(path.join(userDir, 'likes.json'), userLikes);
  writeJsonFile(path.join(userDir, 'dislikes.json'), userDislikes);
  writeJsonFile(path.join(userDir, 'favorite_authors.json'), userFavoriteAuthors);
  writeJsonFile(path.join(userDir, 'author_feed_state.json'), {});
  logInfo('Auth', `Зарегистрирован новый пользователь: ${cleanUsername} (ID: ${userId})`);

  const token = generateToken({ id: userId, username: cleanUsername });
  const { passwordHash, salt: _, ...safeUser } = user;
  return { user: safeUser, token };
}

/**
 * Return the full account record (including passwordHash/salt) for backup/export files.
 * Never expose this outside authenticated, user-owned flows.
 */
export function exportAccountRecord(userId) {
  const user = findUserById(userId);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
    salt: user.salt,
    avatar: user.avatar || '',
    createdAt: user.createdAt || null
  };
}

const ACCOUNT_HASH_RE = /^[a-f0-9]{128}$/i; // scryptSync(password, salt, 64) -> 64 bytes -> 128 hex chars
const ACCOUNT_SALT_RE = /^[a-f0-9]{32}$/i;
const ACCOUNT_ID_RE = /^u_[a-f0-9]{12}$/;

/**
 * Recreate an account from an exported/backup file (hash+salt based, no plaintext
 * password needed) and issue a fresh auth token for it.
 */
export function restoreUser(account = {}) {
  const cleanUsername = String(account.username || '').trim();
  if (cleanUsername.length < 3 || cleanUsername.length > 30 ||
      !/^[a-zA-Z0-9_\u0400-\u04FF-]+$/.test(cleanUsername)) {
    throw new Error('Некорректное имя пользователя в файле');
  }
  if (!ACCOUNT_HASH_RE.test(String(account.passwordHash || '')) ||
      !ACCOUNT_SALT_RE.test(String(account.salt || ''))) {
    throw new Error('В файле отсутствуют корректные данные аккаунта');
  }

  const users = getUsersList();
  const idx = users.findIndex(u => (u.username || '').toLowerCase() === cleanUsername.toLowerCase());

  if (idx !== -1) {
    const existing = users[idx];
    if (existing.passwordHash === account.passwordHash && existing.salt === account.salt) {
      // Same credentials: nothing to restore, just re-login
      const token = generateToken({ id: existing.id, username: existing.username });
      const { passwordHash, salt: _, ...safeUser } = existing;
      return { user: safeUser, token, restored: false };
    }
    const err = new Error('Пользователь с таким логином уже существует с другим паролем');
    err.statusCode = 409;
    throw err;
  }

  // Keep the original id when free so per-user data continuity survives moves
  let userId = ACCOUNT_ID_RE.test(String(account.id || '')) && !users.some(u => u.id === account.id)
    ? account.id
    : 'u_' + crypto.randomBytes(6).toString('hex');

  const now = new Date().toISOString();
  const user = {
    id: userId,
    username: cleanUsername,
    passwordHash: account.passwordHash,
    salt: account.salt,
    avatar: typeof account.avatar === 'string' ? account.avatar : '',
    createdAt: account.createdAt || now,
    lastLoginAt: now
  };

  users.push(user);
  saveUsersList(users);

  // Create isolated data files like registerUser does
  const userDir = getUserDataDir(userId);
  writeJsonFile(path.join(userDir, 'settings.json'), { ...DEFAULT_SETTINGS });
  writeJsonFile(path.join(userDir, 'favorites.json'), []);
  writeJsonFile(path.join(userDir, 'likes.json'), []);
  writeJsonFile(path.join(userDir, 'dislikes.json'), []);
  writeJsonFile(path.join(userDir, 'favorite_authors.json'), []);
  writeJsonFile(path.join(userDir, 'author_feed_state.json'), {});
  logInfo('Auth', `Аккаунт восстановлен из бэкапа: ${cleanUsername} (ID: ${userId})`);

  const token = generateToken({ id: userId, username: cleanUsername });
  const { passwordHash, salt: _, ...safeUser } = user;
  return { user: safeUser, token, restored: true };
}

/**
 * Log a user in
 */
export function loginUser(username, password) {
  const cleanUsername = (username || '').trim();
  const user = findUserByUsername(cleanUsername);
  if (!user) {
    throw new Error('Неверный логин или пароль');
  }

  const isValid = verifyPassword(password, user.passwordHash, user.salt);
  if (!isValid) {
    throw new Error('Неверный логин или пароль');
  }

  user.lastLoginAt = new Date().toISOString();
  const users = getUsersList();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    users[idx] = user;
    saveUsersList(users);
  }

  const token = generateToken({ id: user.id, username: user.username });
  const { passwordHash, salt: _, ...safeUser } = user;
  return { user: safeUser, token };
}

/**
 * Get a user profile
 */
export function getUserProfile(userId) {
  const user = findUserById(userId);
  if (!user) return null;
  const { passwordHash, salt: _, ...safeUser } = user;
  return safeUser;
}

/**
 * Express authentication middleware
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const payload = verifyToken(token);
    if (payload && payload.id) {
      req.user = payload;
    }
  }
  next();
}
