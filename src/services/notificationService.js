import { 
  getFavoriteAuthors, 
  getSettings, 
  getAuthorFeedState, 
  saveAuthorFeedState, 
  getNotifications, 
  addNotification 
} from './storageService.js';
import { getUsersList } from './userService.js';
import { fetchPosts } from '../parsers/index.js';
import { sanitizeStoredPost } from './storedPostSchema.js';
import { groupPostsIntoAlbums } from '../utils/albumHelper.js';
import { logInfo, logError, logWarn } from '../utils/logger.js';
import { DEFAULT_AI_TAGS } from '../config/constants.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Build tag query string for an author based on target booru/archive
 */
export function buildAuthorQuery(author, targetSite = null) {
  const site = targetSite || author.site || 'danbooru';
  const rawName = String(author.name || '').trim();
  const cleanName = rawName
    .replace(/^@+/, '')
    .replace(/^pixiv:\s*/i, '')
    .trim()
    .replace(/\s+/g, '_');

  if ((site === 'pawchive' || site === 'kemono') && author.service && author.user) {
    return {
      site,
      tags: `service:${author.service} user:${author.user}`
    };
  }

  if (site === 'pawchive' || site === 'kemono' || site === 'rule34video') {
    return {
      site,
      tags: `artist:${cleanName}`
    };
  }

  return {
    site,
    tags: cleanName
  };
}

/**
 * Scan a single author for newly published posts across their configured notification sources
 * @returns {Promise<{ newPosts: Array, isInitialSeed: boolean }>}
 */
export async function checkAuthorNewPosts(author, userId = null, { settings: customSettings = null } = {}) {
  if (!author || !author.name) {
    return { newPosts: [], isInitialSeed: false };
  }

  const settings = customSettings || getSettings(userId);
  const aiTags = settings.aiTags || DEFAULT_AI_TAGS;

  const targetSites = (Array.isArray(author.notificationSites) && author.notificationSites.length > 0)
    ? author.notificationSites
    : [author.site || 'danbooru'];

  const feedState = getAuthorFeedState(userId);
  let allNewPosts = [];
  let isAnyInitialSeed = false;

  for (const site of targetSites) {
    const { tags } = buildAuthorQuery(author, site);

    let rawPosts = [];
    try {
      rawPosts = await fetchPosts(
        site, 
        { 
          tags, 
          page: 1, 
          limit: 10, 
          ratingFilter: 'all', 
          typeFilter: 'all', 
          aiFilter: 'all',
          hideFurry: false,
          hidePregnant: false,
          hideLgbt: false
        }, 
        aiTags, 
        settings
      );
    } catch (err) {
      logWarn('NotificationService', `Не удалось получить посты автора "${author.name}" с ${site}: ${err.message}`);
      continue;
    }

    if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
      continue;
    }

    // Group multi-image / multi-file series and sets into unified albums
    const posts = groupPostsIntoAlbums(rawPosts, { enabled: true });
    if (!Array.isArray(posts) || posts.length === 0) {
      continue;
    }

    const authorKey = `${site}:${author.name}`.toLowerCase();
    const authorState = feedState[authorKey];

    // Collect all post and album item IDs for tracking
    const extractAllIds = (postList) => {
      const ids = new Set();
      for (const p of postList) {
        if (!p) continue;
        if (p.id) ids.add(String(p.id));
        if (p.originalId) ids.add(String(p.originalId));
        if (p.isAlbum && Array.isArray(p.albumItems)) {
          p.albumItems.forEach(it => {
            if (it?.id) ids.add(String(it.id));
            if (it?.originalId) ids.add(String(it.originalId));
          });
        }
      }
      return Array.from(ids);
    };

    // First time tracking this author on this site: seed existing posts without spamming notifications
    if (!authorState || !Array.isArray(authorState.knownPostIds)) {
      feedState[authorKey] = {
        lastCheckedAt: new Date().toISOString(),
        knownPostIds: extractAllIds(posts),
        latestPostId: posts[0] ? String(posts[0].id) : null
      };
      saveAuthorFeedState(feedState, userId);
      isAnyInitialSeed = true;
      continue;
    }

    const knownSet = new Set(authorState.knownPostIds.map(String));
    const newPostsForSite = [];

    for (const post of posts) {
      const idStr = String(post.id);
      const origIdStr = post.originalId ? String(post.originalId) : null;
      let isKnown = knownSet.has(idStr) || (origIdStr && knownSet.has(origIdStr));

      // For albums: if all items are already known, treat the album as known
      if (!isKnown && post.isAlbum && Array.isArray(post.albumItems) && post.albumItems.length > 0) {
        const allItemsKnown = post.albumItems.every(it => 
          knownSet.has(String(it.id)) || (it.originalId && knownSet.has(String(it.originalId)))
        );
        if (allItemsKnown) isKnown = true;
      }

      if (!isKnown) {
        newPostsForSite.push(post);
      }
    }

    if (newPostsForSite.length > 0) {
      // Cap notifications created in one check per site to max 5 to prevent feed flood
      const toNotify = newPostsForSite.slice(0, 5);
      for (const post of toNotify) {
        const notif = {
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'author_new_post',
          author: {
            id: author.id || author.name,
            name: author.name,
            displayName: author.displayName || author.name,
            site: post.site || site,
            previewUrl: author.previewUrl || post.previewUrl || post.thumb180 || ''
          },
          post: sanitizeStoredPost(post, { keepAlbumItems: true }),
          createdAt: new Date().toISOString(),
          read: false
        };
        addNotification(notif, userId);
      }

      const newlyKnownIds = extractAllIds(newPostsForSite);
      const updatedKnown = [...new Set([...newlyKnownIds, ...authorState.knownPostIds])].slice(0, 300);
      authorState.knownPostIds = updatedKnown;
      authorState.lastCheckedAt = new Date().toISOString();
      if (posts[0]) authorState.latestPostId = String(posts[0].id);
      feedState[authorKey] = authorState;
      saveAuthorFeedState(feedState, userId);

      allNewPosts.push(...newPostsForSite);
      logInfo('NotificationService', `Обнаружено ${newPostsForSite.length} новых публикаций автора "${author.name}" (${site})`);
    } else {
      authorState.lastCheckedAt = new Date().toISOString();
      feedState[authorKey] = authorState;
      saveAuthorFeedState(feedState, userId);
    }
  }

  return { newPosts: allNewPosts, isInitialSeed: isAnyInitialSeed };
}

/**
 * Scan all followed authors for a given user or provided list
 */
export async function scanFollowedAuthors(userId = null, { authors: providedAuthors = null, settings: customSettings = null } = {}) {
  const settings = customSettings || getSettings(userId);
  if (settings.notificationsEnabled === false) {
    return { success: true, newCount: 0, checkedAuthors: 0, disabled: true };
  }

  const authors = Array.isArray(providedAuthors) ? providedAuthors : getFavoriteAuthors(userId);
  if (!Array.isArray(authors) || authors.length === 0) {
    return { success: true, newCount: 0, checkedAuthors: 0 };
  }

  let totalNew = 0;
  for (let i = 0; i < authors.length; i++) {
    const author = authors[i];
    if (!author) continue;

    // Small delay between upstream author requests to prevent rate limiting
    if (i > 0) {
      await sleep(350);
    }

    try {
      const { newPosts } = await checkAuthorNewPosts(author, userId, { settings });
      totalNew += (newPosts ? newPosts.length : 0);
    } catch (err) {
      logWarn('NotificationService', `Ошибка при сканировании автора ${author.name}: ${err.message}`);
    }
  }

  return {
    success: true,
    newCount: totalNew,
    checkedAuthors: authors.length,
    notifications: getNotifications(userId)
  };
}

/**
 * Background Scheduler
 */
let schedulerIntervalId = null;
let initialTimeoutId = null;
let isScanRunning = false;

export function initNotificationScheduler() {
  if (schedulerIntervalId) return;

  logInfo('NotificationService', 'Фоновый сканер обновлений авторов инициализирован');

  // Initial scan 20 seconds after server startup
  initialTimeoutId = setTimeout(() => {
    void runSchedulerCheck();
  }, 20 * 1000);

  // Background interval: default 15 minutes (or 30 mins)
  const defaultIntervalMs = 15 * 60 * 1000;
  schedulerIntervalId = setInterval(() => {
    void runSchedulerCheck();
  }, defaultIntervalMs);
}

export function stopNotificationScheduler() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }
}

async function runSchedulerCheck() {
  if (isScanRunning) return;
  isScanRunning = true;

  try {
    // 1. Scan default/anonymous storage (single-user or local mode)
    await scanFollowedAuthors(null);

    // 2. Scan all registered users
    try {
      const users = getUsersList();
      if (Array.isArray(users)) {
        for (const u of users) {
          if (u && u.id) {
            await scanFollowedAuthors(u.id);
          }
        }
      }
    } catch (err) {
      logWarn('NotificationService', 'Ошибка перечисления пользователей:', err);
    }
  } catch (err) {
    logError('NotificationService', 'Ошибка фонового сканирования обновлений авторов:', err);
  } finally {
    isScanRunning = false;
  }
}
