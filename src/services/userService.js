import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, DEFAULT_SETTINGS } from '../config/constants.js';
import { readJsonFile, writeJsonFile, writeJsonFileAsync } from './storageService.js';
import { logInfo, logError } from '../utils/logger.js';

export const USERS_DIR = path.join(DATA_DIR, 'users');
export const USERS_INDEX_FILE = path.join(DATA_DIR, 'users.json');

// Обеспечиваем наличие директории пользователей
if (!fs.existsSync(USERS_DIR)) {
  try {
    fs.mkdirSync(USERS_DIR, { recursive: true });
  } catch (err) {
    logError('UserService', 'Не удалось создать директорию users', err);
  }
}

// Секретный ключ для подписи токенов (персистентный при перезапусках сервера)
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
 * Хэширование пароля через crypto.scryptSync
 */
export function hashPassword(password, salt = null) {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, generatedSalt, 64).toString('hex');
  return { hash, salt: generatedSalt };
}

/**
 * Проверка пароля
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
 * Генерация токена авторизации (HMAC-SHA256)
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
 * Валидация и расшифровка токена
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
      return null; // Истек срок действия
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Получение списка всех пользователей (индекс)
 */
export function getUsersList() {
  return readJsonFile(USERS_INDEX_FILE, []);
}

/**
 * Сохранение списка пользователей
 */
export function saveUsersList(users) {
  return writeJsonFile(USERS_INDEX_FILE, users);
}

/**
 * Получение пути к персональной папке пользователя
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
 * Поиск пользователя по username (регистронезависимо)
 */
export function findUserByUsername(username) {
  if (!username) return null;
  const users = getUsersList();
  const clean = username.trim().toLowerCase();
  return users.find(u => (u.username || '').toLowerCase() === clean) || null;
}

/**
 * Поиск пользователя по ID
 */
export function findUserById(userId) {
  if (!userId) return null;
  const users = getUsersList();
  return users.find(u => u.id === userId) || null;
}

/**
 * Регистрация нового пользователя
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

  // Создаем изолированные файлы данных для нового пользователя
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
  writeJsonFile(path.join(userDir, 'subscriptions.json'), []);
  writeJsonFile(path.join(userDir, 'push_subscriptions.json'), []);

  logInfo('Auth', `Зарегистрирован новый пользователь: ${cleanUsername} (ID: ${userId})`);

  const token = generateToken({ id: userId, username: cleanUsername });
  const { passwordHash, salt: _, ...safeUser } = user;
  return { user: safeUser, token };
}

/**
 * Авторизация пользователя
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
 * Получение профиля пользователя
 */
export function getUserProfile(userId) {
  const user = findUserById(userId);
  if (!user) return null;
  const { passwordHash, salt: _, ...safeUser } = user;
  return safeUser;
}

/**
 * Middleware для аутентификации Express
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
