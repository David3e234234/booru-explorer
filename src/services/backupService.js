import { 
  getSettings, 
  updateSettings, 
  getFavorites, 
  getLikes, 
  getDislikes, 
  getFavoriteAuthors 
} from './storageService.js';
import { getUsersList, exportAccountRecord } from './userService.js';
import { logInfo, logError, logWarn } from '../utils/logger.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Check connectivity to the Telegram bot and send a test message
 */
export async function testTelegramBot(botToken, chatId) {
  const token = (botToken || '').trim();
  const chat = (chatId || '').trim();

  if (!token) {
    throw new Error('Токен Telegram-бота не указан');
  }
  if (!chat) {
    throw new Error('Chat ID не указан');
  }

  // 1. Verify the token via getMe
  let meRes;
  try {
    meRes = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('Таймаут соединения с api.telegram.org (проверьте интернет или доступ к Telegram)');
    }
    throw new Error(`Сетевая ошибка при запросе к Telegram: ${err.message}`);
  }

  const meData = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !meData.ok) {
    const desc = meData.description || `HTTP ${meRes.status}`;
    throw new Error(`Ошибка токена бота: ${desc}`);
  }

  const botName = meData.result?.first_name || meData.result?.username || 'Бот';

  // 2. Send a test message to the chat
  const text = `🐾 *Booru Explorer* — Тест связи!\n\n✅ Бот *${botName}* успешно подключен к вашему серверу Booru Explorer.\nАвтоматические бэкапы будут отправляться в этот диалог.`;

  let msgRes;
  try {
    msgRes = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: text,
        parse_mode: 'Markdown'
      }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('Таймаут при отправке сообщения в Telegram');
    }
    throw new Error(`Ошибка отправки сообщения: ${err.message}`);
  }

  const msgData = await msgRes.json().catch(() => ({}));
  if (!msgRes.ok || !msgData.ok) {
    const desc = msgData.description || `HTTP ${msgRes.status}`;
    throw new Error(`Бот подключен, но не смог отправить сообщение в чат: ${desc}. Убедитесь, что вы нажали /start в диалоге с ботом.`);
  }

  return {
    success: true,
    botName: botName,
    botUsername: meData.result?.username || ''
  };
}

/**
 * Send a document file to Telegram via multipart/form-data
 */
export async function sendTelegramDocument(botToken, chatId, fileBuffer, fileName, caption = '') {
  const token = (botToken || '').trim();
  const chat = (chatId || '').trim();

  if (!token || !chat) {
    throw new Error('Не указан токен бота или Chat ID');
  }

  const formData = new FormData();
  formData.append('chat_id', chat);
  if (caption) {
    formData.append('caption', caption);
    formData.append('parse_mode', 'Markdown');
  }

  const blob = new Blob([fileBuffer], { type: 'application/json' });
  formData.append('document', blob, fileName);

  let res;
  try {
    res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('Таймаут отправки файла бэкапа в Telegram');
    }
    throw new Error(`Ошибка сети при отправке файла в Telegram: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const desc = data.description || `HTTP ${res.status}`;
    throw new Error(`Ошибка отправки бэкапа в Telegram: ${desc}`);
  }

  return data;
}

/**
 * Build the complete backup object
 */
export function buildBackupPayload(userId = null) {
  const settings = getSettings(userId);
  const favorites = getFavorites(userId);
  const likes = getLikes(userId);
  const dislikes = getDislikes(userId);
  const favoriteAuthors = getFavoriteAuthors(userId);
  const account = userId ? exportAccountRecord(userId) : null;

  const now = new Date();

  return {
    version: 2,
    exportedAt: now.toISOString(),
    source: 'Booru Explorer Telegram Backup',
    userId: userId || 'default',
    account,
    stats: {
      favoritesCount: favorites.length,
      likesCount: likes.length,
      dislikesCount: dislikes.length,
      favoriteAuthorsCount: favoriteAuthors.length
    },
    data: {
      settings,
      favorites,
      likes,
      dislikes,
      favoriteAuthors
    }
  };
}

/**
 * Run the backup and send it to Telegram
 */
export async function performTelegramBackup(userId = null, isManual = false) {
  const settings = getSettings(userId);
  const token = (settings.telegramBotToken || '').trim();
  const chatId = (settings.telegramChatId || '').trim();

  if (!token || !chatId) {
    throw new Error('Настройки Telegram-бота (Token / Chat ID) не заполнены');
  }

  const payload = buildBackupPayload(userId);
  const jsonContent = JSON.stringify(payload, null, 2);
  const buffer = Buffer.from(jsonContent, 'utf-8');

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `booru_backup_${dateStr}.json`;

  const dateFormatted = now.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const typeLabel = isManual ? '⚡ Ручной запуск' : '⏰ Автоматический бэкап';

  const caption = `📦 *Резервная копия Booru Explorer*\n` +
    `🏷️ *Режим:* ${typeLabel}\n` +
    `📅 *Дата:* ${dateFormatted}\n` +
    (payload.account ? `👤 *Аккаунт:* @${payload.account.username}\n` : '') +
    `⭐ *Закладок:* ${payload.stats.favoritesCount}\n` +
    `❤️ *Лайков:* ${payload.stats.likesCount}\n` +
    `🚫 *Скрыто постов:* ${payload.stats.dislikesCount || 0}\n` +
    `🎨 *Любимых авторов:* ${payload.stats.favoriteAuthorsCount}\n\n` +
    `_Файл можно импортировать в настройках сайта в разделе «Память»._`;

  logInfo('Backup', `Отправка бэкапа в Telegram (User: ${userId || 'default'}, Размер: ${(buffer.length / 1024).toFixed(1)} KB)...`);

  await sendTelegramDocument(token, chatId, buffer, fileName, caption);

  // Record the time of the successful backup
  const updatedSettings = updateSettings({ telegramLastBackupAt: now.toISOString() }, userId);

  logInfo('Backup', `Бэкап успешно доставлен в Telegram (User: ${userId || 'default'})`);

  return {
    success: true,
    fileName,
    lastBackupAt: updatedSettings.telegramLastBackupAt,
    stats: payload.stats
  };
}

/**
 * Check whether an auto-backup is due for a given user/settings pair
 */
async function checkAndRunBackupForUser(userId = null) {
  try {
    const settings = getSettings(userId);
    if (!settings.telegramBackupEnabled) return;
    if (!settings.telegramBotToken || !settings.telegramChatId) return;

    const interval = settings.telegramBackupInterval || 'daily';
    let intervalMs = 24 * 60 * 60 * 1000; // daily
    if (interval === 'every_3_days') intervalMs = 3 * 24 * 60 * 60 * 1000;
    if (interval === 'weekly') intervalMs = 7 * 24 * 60 * 60 * 1000;

    const lastBackup = settings.telegramLastBackupAt ? new Date(settings.telegramLastBackupAt).getTime() : 0;
    const now = Date.now();

    if (now - lastBackup >= intervalMs) {
      logInfo('Backup', `Запуск запланированного автобэкапа в Telegram для ${userId || 'default'} (интервал: ${interval})`);
      await performTelegramBackup(userId, false);
    }
  } catch (err) {
    logError('Backup', `Ошибка выполнения фонового бэкапа для ${userId || 'default'}:`, err);
  }
}

/**
 * Initialize the background backup scheduler
 */
let schedulerIntervalId = null;

export function initBackupScheduler() {
  if (schedulerIntervalId) return;

  logInfo('Backup', 'Фоновый сервис автобэкапа в Telegram инициализирован');

  // First check 1 minute after server startup
  setTimeout(async () => {
    await runSchedulerCheck();
  }, 60 * 1000);

  // Recurring check every 30 minutes
  schedulerIntervalId = setInterval(async () => {
    await runSchedulerCheck();
  }, 30 * 60 * 1000);
}

async function runSchedulerCheck() {
  // 1. Check the global user (single-user)
  await checkAndRunBackupForUser(null);

  // 2. Check registered users
  try {
    const users = getUsersList();
    if (Array.isArray(users)) {
      for (const u of users) {
        if (u && u.id) {
          await checkAndRunBackupForUser(u.id);
        }
      }
    }
  } catch (err) {
    logError('Backup', 'Ошибка проверки списка пользователей для автобэкапа:', err);
  }
}
