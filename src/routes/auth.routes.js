import express from 'express';
import { 
  registerUser, 
  loginUser, 
  getUserProfile, 
  getUsersList,
  exportAccountRecord,
  restoreUser,
  authMiddleware 
} from '../services/userService.js';
import { logInfo, logError } from '../utils/logger.js';

const router = express.Router();

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { username, password, initialData } = req.body || {};
    const result = registerUser(username, password, initialData);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = loginUser(username, password);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
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
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Успешный выход' });
});

// GET /api/auth/export - full account record for backup/export files (requires token)
router.get('/export', authMiddleware, (req, res) => {
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
router.post('/restore', (req, res) => {
  try {
    const { account } = req.body || {};
    if (!account || typeof account !== 'object') {
      return res.status(400).json({ success: false, message: 'Некорректные данные аккаунта' });
    }
    const result = restoreUser(account);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
});

export default router;
