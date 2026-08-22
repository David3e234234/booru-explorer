import fs from 'fs';
import webpush from 'web-push';
import { fetchPosts } from '../parsers/index.js';
import {
  getSettings,
  getSubscriptions,
  saveSubscriptions,
  getPushSubscriptions,
  savePushSubscriptions,
  getFavoriteAuthors,
  getAuthorFeedState,
  saveAuthorFeedState
} from './storageService.js';
import { getUsersList } from './userService.js';
import { VAPID_KEYS_FILE, isServerless } from '../config/constants.js';
import { logInfo, logError } from '../utils/logger.js';

// Как часто планировщик проверяет подписки (и как долго подписка считается «проверенной»)
const SUB_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_KNOWN_IDS = 200;
const MAX_UNREAD_IDS = 100;
const CHECK_LIMIT = 30;

// Лимиты для проверки любимых авторов (состояние компактнее, чем у подписок)
const AUTHOR_MAX_KNOWN_IDS = 80;
const AUTHOR_MAX_UNREAD_IDS = 50;

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
 * Проверка всех «созревших» подписок пользователя.
 * Возвращает список обновившихся: [{ label, count }]
 */
async function checkUserSubscriptions(userId = null) {
  const subscriptions = getSubscriptions(userId);
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return [];

  const now = Date.now();
  const due = subscriptions.filter(sub => {
    if (!sub || !sub.id) return false;
    if (!sub.lastCheckedAt) return true;
    return now - new Date(sub.lastCheckedAt).getTime() >= SUB_CHECK_INTERVAL_MS;
  });

  const updated = [];
  for (const sub of due) {
    try {
      const { freshCount } = await runSubscriptionCheck(userId, sub.id);
      if (freshCount > 0) {
        logInfo('Subscriptions', `«${sub.query}»: ${freshCount} новых постов (${userId || 'default'})`);
        updated.push({ label: sub.query, count: sub.newIds.length });
      }
    } catch (err) {
      logError('Subscriptions', `Ошибка проверки подписки ${sub.id}:`, err);
    }
  }

  return updated;
}

function authorFeedKey(author) {
  return `${author.site || 'danbooru'}:${String(author.name || '').toLowerCase()}`;
}

// Запрос по автору строится так же, как при клике «Смотреть работы» в карточке автора
function buildAuthorQuery(author) {
  const name = String(author.name || '').trim();
  if (!name) return '';
  if (author.site === 'rule34video' && !name.includes(':')) return `artist:${name}`;
  return name;
}

/**
 * Проверка любимых авторов на новые работы.
 * Возвращает список обновившихся: [{ label, count }]
 */
export async function checkFavoriteAuthorsForUser(userId = null) {
  const authors = getFavoriteAuthors(userId);
  if (!Array.isArray(authors) || authors.length === 0) return [];

  const state = getAuthorFeedState(userId);
  const now = Date.now();
  const settings = getSettings(userId);
  const updated = [];

  for (const author of authors) {
    if (!author || !author.name) continue;

    const key = authorFeedKey(author);
    const entry = state[key] || {};
    if (entry.lastCheckedAt && now - new Date(entry.lastCheckedAt).getTime() < SUB_CHECK_INTERVAL_MS) {
      continue;
    }

    const query = buildAuthorQuery(author);
    const site = author.site || 'danbooru';
    if (!query) continue;

    // Первая проверка только запоминает выдачу, не считая ее новинками
    const isFirstCheck = !entry.lastCheckedAt;

    let posts = [];
    try {
      posts = await fetchPosts(site, { tags: query, limit: CHECK_LIMIT, page: 1 },
        Array.isArray(settings.aiTags) ? settings.aiTags : [], settings);
    } catch (err) {
      logError('Subscriptions', `Ошибка поиска работ автора «${author.name}»:`, err);
    }
    if (!Array.isArray(posts)) posts = [];

    const known = new Set(entry.knownIds || []);
    const fresh = posts.filter(p => p && p.id && !known.has(p.id));

    entry.knownIds = [
      ...posts.map(p => p.id).filter(Boolean),
      ...(entry.knownIds || [])
    ].filter((id, idx, arr) => arr.indexOf(id) === idx).slice(0, AUTHOR_MAX_KNOWN_IDS);

    entry.newIds = isFirstCheck ? [...(entry.newIds || [])] : [
      ...fresh.map(p => p.id),
      ...(entry.newIds || [])
    ].filter((id, idx, arr) => arr.indexOf(id) === idx).slice(0, AUTHOR_MAX_UNREAD_IDS);

    entry.lastCheckedAt = new Date().toISOString();
    state[key] = entry;

    if (fresh.length > 0 && !isFirstCheck) {
      logInfo('Subscriptions', `Автор «${author.name}»: ${fresh.length} новых работ (${userId || 'default'})`);
      updated.push({ label: author.name, count: entry.newIds.length });
    }
  }

  saveAuthorFeedState(state, userId);
  return updated;
}

/**
 * Единый пуш по всем обновившимся подпискам и авторам
 */
async function notifyUser(userId = null, { subs = [], authors = [] } = {}) {
  try {
    if (subs.length === 0 && authors.length === 0) return;

    const sources = [
      ...subs.map(s => ({ ...s, kind: 'query' })),
      ...authors.map(a => ({ ...a, kind: 'author' }))
    ];
    const totalUnread = sources.reduce((sum, s) => sum + (s.count || 0), 0);

    let title;
    let body;
    if (sources.length === 1) {
      const only = sources[0];
      title = only.kind === 'author' ? `Новые работы: ${only.label}` : `Новые посты: ${only.label}`;
      body = `${only.count} новых постов`;
    } else {
      title = 'Новые посты по вашим подпискам';
      body = `${totalUnread} новых постов в ${sources.length} подписках`;
    }

    await sendPushToUser(userId, { title, body, url: '/?category=profile&tab=searches' });
  } catch (err) {
    logError('Subscriptions', 'Ошибка отправки пушей:', err);
  }
}

async function checkAndNotifyUser(userId = null) {
  const subs = await checkUserSubscriptions(userId);
  const authors = await checkFavoriteAuthorsForUser(userId);
  await notifyUser(userId, { subs, authors });
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
    await checkAndNotifyUser(null);
  } catch (err) {
    logError('Subscriptions', 'Ошибка фоновой проверки (глобальные подписки):', err);
  }

  try {
    const users = getUsersList();
    if (Array.isArray(users)) {
      for (const u of users) {
        if (u && u.id) {
          await checkAndNotifyUser(u.id);
        }
      }
    }
  } catch (err) {
    logError('Subscriptions', 'Ошибка фоновой проверки (пользователи):', err);
  }
}
