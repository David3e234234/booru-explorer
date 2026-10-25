import express from 'express';
import { 
  getNotifications, 
  markNotificationRead, 
  markAllNotificationsRead, 
  deleteNotification, 
  clearNotifications 
} from '../services/storageService.js';
import { scanFollowedAuthors } from '../services/notificationService.js';
import { authMiddleware } from '../services/userService.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Soft auth: populates req.user if present, but allows anonymous clients
router.use(authMiddleware);

// Rate limit manual on-demand checks to 10 per minute per IP
const checkRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Слишком частые проверки обновлений авторов. Подождите немного.'
});

// GET /api/notifications
router.get('/notifications', (req, res) => {
  const userId = req.user?.id || null;
  const notifications = getNotifications(userId);
  const unreadCount = notifications.filter(n => !n.read).length;
  res.json({
    success: true,
    notifications,
    unreadCount
  });
});

// POST /api/notifications/read
router.post('/notifications/read', (req, res) => {
  const userId = req.user?.id || null;
  const { id, all } = req.body || {};

  let notifications;
  if (all === true) {
    notifications = markAllNotificationsRead(userId);
  } else if (id && typeof id === 'string') {
    notifications = markNotificationRead(id, userId);
  } else {
    return res.status(400).json({ success: false, message: 'Не указан ID уведомления или all: true' });
  }

  const unreadCount = notifications.filter(n => !n.read).length;
  res.json({
    success: true,
    unreadCount,
    notifications
  });
});

// DELETE /api/notifications/:id
router.delete('/notifications/:id', (req, res) => {
  const userId = req.user?.id || null;
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Не указан ID уведомления' });
  }

  const notifications = deleteNotification(id, userId);
  const unreadCount = notifications.filter(n => !n.read).length;
  res.json({
    success: true,
    unreadCount,
    count: notifications.length
  });
});

// DELETE /api/notifications
router.delete('/notifications', (req, res) => {
  const userId = req.user?.id || null;
  clearNotifications(userId);
  res.json({
    success: true,
    unreadCount: 0,
    count: 0
  });
});

// POST /api/notifications/check
router.post('/notifications/check', checkRateLimiter, async (req, res) => {
  const userId = req.user?.id || null;
  const { authors } = req.body || {};

  // Validate authors array if provided
  const validAuthors = Array.isArray(authors) ? authors.slice(0, 50) : null;

  try {
    const result = await scanFollowedAuthors(userId, { authors: validAuthors });
    const notifications = getNotifications(userId);
    const unreadCount = notifications.filter(n => !n.read).length;

    res.json({
      success: true,
      newCount: result.newCount || 0,
      checkedAuthors: result.checkedAuthors || 0,
      unreadCount,
      notifications
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Ошибка при проверке обновлений: ' + err.message
    });
  }
});

export default router;
