import express from 'express';
import { 
  registerUser, 
  loginUser, 
  getUserProfile, 
  getUsersList,
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

export default router;
