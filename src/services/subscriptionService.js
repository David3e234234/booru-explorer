import fs from 'fs';
import webpush from 'web-push';
import { fetchPosts } from '../parsers/index.js';
import {
  getSettings,
  getSubscriptions,
  saveSubscriptions,
  getPushSubscriptions,
  savePushSubscriptions
} from './storageService.js';
import { getUsersList } from './userService.js';
import { VAPID_KEYS_FILE, isServerless } from '../config/constants.js';
import { logInfo, logError } from '../utils/logger.js';

// Как часто планировщик проверяет подписки (и как долго подписка считается «проверенной»)
const SUB_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_KNOWN_IDS = 200;
const MAX_UNREAD_IDS = 100;
const CHECK_LIMIT = 30;

let vapidKeysCache = null;

export function getVapidPublicKey() {
  const keys = getVapidKeys();
  return keys ? keys.publicKey : null;
}

function getVapidKeys() {
  if (vapidKeysCache) return vapidKeysCache;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeysCache = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
    return vapidKeysCache;
  }

  try {
    if (fs.existsSync(VAPID_KEYS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf-8'));
      if (raw && raw.publicKey && raw.privateKey) {
        vapidKeysCache = raw;
        return vapidKeysCache;
      }
    }
  } catch (err) {
    logError('Subscriptions', 'Не удалось прочитать VAPID-ключи', err);
  }

  try {
    const generated = webpush.generateVAPIDKeys();
    vapidKeysCache = { publicKey: generated.publicKey, privateKey: generated.privateKey };
    if (!isServerless) {
      fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(vapidKeysCache, null, 2), 'utf-8');
    }
    logInfo('Subscriptions', 'Сгенерированы новые VAPID-ключи для веб-пушей');
  } catch (err) {
    logError('Subscriptions', 'Не удалось сгенерировать VAPID-ключи', err);
    vapidKeysCache = null;
  }

  return vapidKeysCache;
}

function normalizeQuery(query) {
  return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findSubscription(subscriptions, subId) {
  return subscriptions.find(s => s.id === subId) || null;
}

/**
 * Загружает свежие посты по запросу подписки и обновляет счетчик непрочитанных.
 * Возвращает обновленный объект подписки (уже сохраненный в хранилище).
 */
export async function runSubscriptionCheck(userId = null, subId) {
  const subscriptions = getSubscriptions(userId);
  const sub = findSubscription(subscriptions, subId);
  if (!sub) throw new Error('Подписка не найдена');

  const settings = getSettings(userId);
  const site = sub.site || 'all';

  let posts = [];
  try {
    posts = await fetchPosts(site, {
      tags: sub.query,
      limit: CHECK_LIMIT,
      page: 1
    }, Array.isArray(settings.aiTags) ? settings.aiTags : [], settings);
  } catch (err) {
    logError('Subscriptions', `Ошибка поиска для «${sub.query}»:`, err);
  }

  if (!Array.isArray(posts)) posts = [];

  // Первая проверка только запоминает текущую выдачу: весь существующий
  // контент не должен попадать в счетчик «нового»
  const isFirstCheck = !sub.lastCheckedAt;

  const known = new Set(sub.knownIds || []);
  const fresh = posts.filter(p => p && p.id && !known.has(p.id));

  // Новые посты идут первыми, храним ограниченную историю
  const knownIds = [
    ...posts.map(p => p.id).filter(Boolean),
    ...(sub.knownIds || [])
  ].filter((id, idx, arr) => arr.indexOf(id) === idx).slice(0, MAX_KNOWN_IDS);

  const newIds = isFirstCheck ? [...(sub.newIds || [])] : [
    ...fresh.map(p => p.id),
    ...(sub.newIds || [])
  ].filter((id, idx, arr) => arr.indexOf(id) === idx).slice(0, MAX_UNREAD_IDS);

  sub.knownIds = knownIds;
  sub.newIds = newIds;
  sub.lastCheckedAt = new Date().toISOString();
  if (fresh.length > 0 && !isFirstCheck) sub.lastNewAt = sub.lastCheckedAt;

  saveSubscriptions(subscriptions, userId);
  return { subscription: sub, freshCount: fresh.length };
}

export function markSubscriptionSeen(userId = null, subId) {
  const subscriptions = getSubscriptions(userId);
  const sub = findSubscription(subscriptions, subId);
  if (!sub) throw new Error('Подписка не найдена');
  sub.newIds = [];
  saveSubscriptions(subscriptions, userId);
  return sub;
}

/**
 * Проверка всех «созревших» подписок пользователя + рассылка пушей о новинках
 */
async function checkUserSubscriptions(userId = null) {
  const subscriptions = getSubscriptions(userId);
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return;

  const now = Date.now();
  const due = subscriptions.filter(sub => {
    if (!sub || !sub.id) return false;
    if (!sub.lastCheckedAt) return true;
    return now - new Date(sub.lastCheckedAt).getTime() >= SUB_CHECK_INTERVAL_MS;
  });

  let totalFresh = 0;
  for (const sub of due) {
    try {
      const { freshCount } = await runSubscriptionCheck(userId, sub.id);
      totalFresh += freshCount;
      if (freshCount > 0) {
        logInfo('Subscriptions', `«${sub.query}»: ${freshCount} новых постов (${userId || 'default'})`);
      }
    } catch (err) {
      logError('Subscriptions', `Ошибка проверки подписки ${sub.id}:`, err);
    }
  }

  if (totalFresh > 0) {
    await notifyUserSubscriptions(userId);
  }
}

async function notifyUserSubscriptions(userId = null) {
  try {
    const endpoints = getPushSubscriptions(userId);
    if (!Array.isArray(endpoints) || endpoints.length === 0) return;

    const subscriptions = getSubscriptions(userId).filter(s => Array.isArray(s.newIds) && s.newIds.length > 0);
    if (subscriptions.length === 0) return;

    const totalUnread = subscriptions.reduce((sum, s) => sum + s.newIds.length, 0);
    const title = subscriptions.length === 1
      ? `Новые посты: ${subscriptions[0].query}`
      : 'Новые посты по вашим подпискам';
    const body = subscriptions.length === 1
      ? `${subscriptions[0].newIds.length} новых постов по запросу «${subscriptions[0].query}»`
      : `${totalUnread} новых постов в ${subscriptions.length} подписках`;

    await sendPushToUser(userId, { title, body, url: '/?category=profile&tab=searches' });
  } catch (err) {
    logError('Subscriptions', 'Ошибка отправки пушей:', err);
  }
}

export async function sendPushToUser(userId = null, payload) {
  const endpoints = getPushSubscriptions(userId);
  if (!Array.isArray(endpoints) || endpoints.length === 0) return { sent: 0, removed: 0 };

  const keys = getVapidKeys();
  if (!keys) throw new Error('VAPID-ключи недоступны');
  webpush.setVapidDetails('mailto:booru-explorer@localhost', keys.publicKey, keys.privateKey);

  const alive = [];
  let sent = 0;

  await Promise.all(endpoints.map(async (ep) => {
    try {
      await webpush.sendNotification(ep, JSON.stringify(payload));
      sent += 1;
      alive.push(ep);
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        logInfo('Subscriptions', `Push-endpoint удален сервисом (${err.statusCode})`);
      } else {
        logError('Subscriptions', 'Ошибка отправки пуша:', err);
        alive.push(ep);
      }
    }
  }));

  if (alive.length !== endpoints.length) {
    savePushSubscriptions(alive, userId);
  }
  return { sent, removed: endpoints.length - alive.length };
}

let schedulerIntervalId = null;

export function initSubscriptionScheduler() {
  if (schedulerIntervalId) return;
  logInfo('Subscriptions', 'Фоновая проверка тег-подписок инициализирована');

  setTimeout(async () => {
    await runSchedulerPass();
  }, 90 * 1000);

  schedulerIntervalId = setInterval(async () => {
    await runSchedulerPass();
  }, SUB_CHECK_INTERVAL_MS);
  if (schedulerIntervalId.unref) schedulerIntervalId.unref();
}

async function runSchedulerPass() {
  try {
    await checkUserSubscriptions(null);
  } catch (err) {
    logError('Subscriptions', 'Ошибка фоновой проверки (глобальные подписки):', err);
  }

  try {
    const users = getUsersList();
    if (Array.isArray(users)) {
      for (const u of users) {
        if (u && u.id) {
          await checkUserSubscriptions(u.id);
        }
      }
    }
  } catch (err) {
    logError('Subscriptions', 'Ошибка фоновой проверки (пользователи):', err);
  }
}
