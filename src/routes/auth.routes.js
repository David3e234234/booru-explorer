import express from 'express';
import { 
  registerUser, 
  loginUser, 
  getUserProfile, 
  getUsersList,
  exportAccountRecord,
  restoreUser,
  requireAuth,
  revokeUserTokens
} from '../services/userService.js';
const router = express.Router();
const authAttempts = new Map();

function authRateLimit(maxAttempts, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    if (authAttempts.size > 5000) {
      for (const [attemptKey, attempt] of authAttempts) {
        if (attempt.resetAt <= now) authAttempts.delete(attemptKey);
      }
    }
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const entry = authAttempts.get(key);
    if (!entry || entry.resetAt <= now) {
      authAttempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > maxAttempts) {
      return res.status(429).json({ success: false, message: 'Слишком много попыток. Повторите позже' });
    }
    return next();
  };
}

const registerLimiter = authRateLimit(5, 10 * 60 * 1000);
const loginLimiter = authRateLimit(20, 10 * 60 * 1000);
const restoreLimiter = authRateLimit(5, 10 * 60 * 1000);

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, password, initialData } = req.body || {};
    const result = await registerUser(username, password, initialData);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password, initialData } = req.body || {};
    const result = await loginUser(username, password, initialData);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }
  const profile = getUserProfile(req.user.id);
  if (!profile) {
    return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  }
  res.json({ success: true, user: profile });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  await revokeUserTokens(req.user.id);
  res.json({ success: true, message: 'Успешный выход' });
});

// GET /api/auth/export - full account record for backup/export files (requires token)
router.get('/export', requireAuth, (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }
  const account = exportAccountRecord(req.user.id);
  if (!account) {
    return res.status(404).json({ success: false, message: 'Пользователь не найден' });
  }
  res.json({ success: true, account });
});

// POST /api/auth/restore - recreate an account from an exported/backup file and log into it
router.post('/restore', restoreLimiter, async (req, res) => {
  try {
    const { account, password } = req.body || {};
    if (!account || typeof account !== 'object' || Array.isArray(account)) {
      return res.status(400).json({ success: false, message: 'Некорректные данные аккаунта' });
    }
    const result = await restoreUser(account, password);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
});

export default router;
