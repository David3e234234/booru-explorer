/**
 * Модуль группировки связанных постов (мульти-изображений, Pixiv сетов,
 * вариаций, комиксов и Parent/Child отношений) в единые альбомы.
 */

import { logInfo, logError } from './logger.js';

/**
 * Извлекает ВСЕ возможные ключи серии/альбома из метаданных поста
 * @param {Object} post - Нормализованный или сырой объект поста
 * @param {string} site - Идентификатор Booru-сайта
 * @returns {Array<string>} Массив ключей связей (Pixiv, Twitter, Parent/Child, Pool, etc.)
 */
export function extractAllSeriesKeys(post, site = '') {
  if (!post) return [];
  const keys = new Set();
  const siteId = site || post.site || '';
  const source = (post.source || '').trim();
  const tags = Array.isArray(post.tags) ? post.tags : (typeof post.tag_string === 'string' ? post.tag_string.split(/\s+/) : []);

  // 1. Pixiv ID (поиск в source и в тегах)
  const pixivPatterns = [
    /pixiv\.net\/(?:en\/)?artworks\/(\d+)/i,
    /pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i,
    /i\.pximg\.net\/.*\/(\d+)_p\d+/i,
    /pixiv_(\d+)/i
  ];
  for (const regex of pixivPatterns) {
    const match = source.match(regex);
    if (match && match[1]) keys.add(`pixiv:${match[1]}`);
  }
  for (const tag of tags) {
    const tagMatch = tag.match(/^(?:pixiv|pixiv_id):(\d+)$/i);
    if (tagMatch && tagMatch[1]) keys.add(`pixiv:${tagMatch[1]}`);
  }

  // 2. Twitter / X Status ID
  const twitterMatch = source.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  if (twitterMatch && twitterMatch[1]) {
    keys.add(`twitter:${twitterMatch[1]}`);
  }

  // 3. Bluesky Post ID
  const bskyMatch = source.match(/bsky\.app\/profile\/[^/]+\/post\/([a-zA-Z0-9]+)/i);
  if (bskyMatch && bskyMatch[1]) {
    keys.add(`bsky:${bskyMatch[1]}`);
  }

  // 4. Fanbox / Fantia / Patreon
  const fanboxMatch = source.match(/fanbox\.cc\/(?:@[\w-]+|[\w-]+)\/posts\/(\d+)/i);
  if (fanboxMatch && fanboxMatch[1]) keys.add(`fanbox:${fanboxMatch[1]}`);

  const fantiaMatch = source.match(/fantia\.jp\/posts\/(\d+)/i);
  if (fantiaMatch && fantiaMatch[1]) keys.add(`fantia:${fantiaMatch[1]}`);

  const patreonMatch = source.match(/patreon\.com\/posts\/(?:[\w-]+-)?(\d+)/i);
  if (patreonMatch && patreonMatch[1]) keys.add(`patreon:${patreonMatch[1]}`);

  // 5. Parent / Child связь Booru (надежный мост между разными источниками)
  const rawParentId = post.parentId || post.parent_id;
  if (rawParentId && String(rawParentId) !== '0' && String(rawParentId) !== 'null') {
    keys.add(`parent:${siteId}:${String(rawParentId)}`);
  }

  // Если сам пост имеет дочерние элементы
  const hasChildren = Boolean(post.hasChildren || post.has_children || post.has_active_children);
  if (hasChildren && (post.originalId || post.id)) {
    const rootId = String(post.originalId || post.id).replace(/^[a-z0-9_]+_/, '');
    keys.add(`parent:${siteId}:${rootId}`);
  }

  // 6. Пул (Pool) - серии/главы
  const poolId = post.poolId || post.pool_id;
  if (poolId) {
    keys.add(`pool:${siteId}:${String(poolId)}`);
  }

  return Array.from(keys);
}

/**
 * Извлекает основной нормализованный ключ серии для одиночного поста
 */
export function extractSeriesKey(post, site = '') {
  const keys = extractAllSeriesKeys(post, site);
  if (keys.length === 0) return null;
  // Приоритеты: pixiv -> parent -> twitter -> остальные
  const pixivKey = keys.find(k => k.startsWith('pixiv:'));
  if (pixivKey) return pixivKey;
  const parentKey = keys.find(k => k.startsWith('parent:'));
  if (parentKey) return parentKey;
  return keys[0];
}

/**
 * Сортировка страниц внутри сета (по номеру _p0, _p1, родитель на первом месте или по ID)
 */
function sortAlbumItems(items) {
  return [...items].sort((a, b) => {
    // 1. Родительский пост всегда идет первым, если у него нет номера страницы
    const aIsParent = Boolean(a.hasChildren && !a.parentId);
    const bIsParent = Boolean(b.hasChildren && !b.parentId);
    if (aIsParent && !bIsParent) return -1;
    if (!aIsParent && bIsParent) return 1;

    // 2. Проверка явного номера страницы в URL (например, 12345_p0.jpg, 12345_p1.jpg)
    const getPageNum = (item) => {
      const target = item.fileUrl || item.sampleUrl || item.previewUrl || item.source || '';
      const pMatch = target.match(/_p(\d+)\./i) || target.match(/page_?(\d+)/i);
      if (pMatch) return parseInt(pMatch[1], 10);
      return null;
    };

    const pageA = getPageNum(a);
    const pageB = getPageNum(b);

    if (pageA !== null && pageB !== null) {
      return pageA - pageB;
    }

    // 3. Если нет _p0, сортируем по ID по возрастанию
    const idA = parseInt(String(a.originalId || a.id).replace(/\D/g, ''), 10) || 0;
    const idB = parseInt(String(b.originalId || b.id).replace(/\D/g, ''), 10) || 0;
    return idA - idB;
  });
}

/**
 * Группирует массив постов в мульти-посты (альбомы) через мульти-ключевой Union-Find
 * @param {Array} posts - Исходный массив постов
 * @param {Object} options - Опции группировки
 * @returns {Array} Массив постов со свернутыми альбомами
 */
export function groupPostsIntoAlbums(posts, options = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  if (options.enabled === false) return posts;

  const n = posts.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  }

  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      if (rootI < rootJ) {
        parent[rootJ] = rootI;
      } else {
        parent[rootI] = rootJ;
      }
    }
  }

  const keyToPostIdx = new Map();
  const postKeysList = [];

  // 1. Извлекаем все ключи связей для каждого поста и объединяем связанные посты
  posts.forEach((post, idx) => {
    const keys = extractAllSeriesKeys(post, post.site);
    postKeysList[idx] = keys;

    keys.forEach(key => {
      if (keyToPostIdx.has(key)) {
        union(idx, keyToPostIdx.get(key));
      } else {
        keyToPostIdx.set(key, idx);
      }
    });
  });

  // 2. Группируем посты по корневым индексам
  const clusters = new Map();
  posts.forEach((post, idx) => {
    const root = find(idx);
    if (!clusters.has(root)) {
      clusters.set(root, {
        firstIndex: root,
        items: []
      });
    }
    clusters.get(root).items.push(post);
  });

  // 3. Формируем итоговый список постов
  const resultMap = new Map();

  clusters.forEach((cluster, rootIndex) => {
    const { items } = cluster;

    if (items.length > 1) {
      // Это полноценный альбом из 2+ связанных слайдов
      const sortedItems = sortAlbumItems(items);
      const rootPost = sortedItems[0];

      // Очищаем вложенные элементы от циклических ссылок
      const cleanItems = sortedItems.map(item => {
        const copy = { ...item };
        delete copy.albumItems;
        return copy;
      });

      // Собираем все теги и ключи
      const allTagsSet = new Set();
      const allKeysSet = new Set();

      cleanItems.forEach(item => {
        if (Array.isArray(item.tags)) {
          item.tags.forEach(t => allTagsSet.add(t));
        }
        const kList = extractAllSeriesKeys(item, item.site);
        kList.forEach(k => allKeysSet.add(k));
      });

      const maxScore = Math.max(...cleanItems.map(i => i.score || 0));
      const maxFavs = Math.max(...cleanItems.map(i => i.favCount || 0));
      const maxViews = Math.max(...cleanItems.map(i => i.views || 0));

      const primaryKey = Array.from(allKeysSet).find(k => k.startsWith('pixiv:')) ||
                         Array.from(allKeysSet).find(k => k.startsWith('parent:')) ||
                         Array.from(allKeysSet)[0] || '';

      const albumPost = {
        ...rootPost,
        isAlbum: true,
        albumCount: cleanItems.length,
        albumItems: cleanItems,
        seriesKey: primaryKey,
        allSeriesKeys: Array.from(allKeysSet),
        canFetchAlbum: true,
        tags: Array.from(allTagsSet),
        score: maxScore,
        favCount: maxFavs,
        views: maxViews
      };

      resultMap.set(rootIndex, albumPost);
    } else {
      // Одиночный пост
      const singlePost = { ...items[0] };
      delete singlePost.albumItems;

      const keys = postKeysList[rootIndex] || [];
      const hasChildren = Boolean(singlePost.hasChildren || singlePost.has_children || singlePost.has_active_children);
      const hasParent = Boolean(singlePost.parentId && String(singlePost.parentId) !== '0');
      const hasExternalSet = keys.some(k => k.startsWith('pixiv:') || k.startsWith('twitter:') || k.startsWith('fanbox:'));

      singlePost.isAlbum = false;
      singlePost.albumCount = 1;
      singlePost.seriesKey = keys[0] || null;
      singlePost.allSeriesKeys = keys;
      singlePost.canFetchAlbum = Boolean(hasChildren || hasParent || hasExternalSet);

      resultMap.set(rootIndex, singlePost);
    }
  });

  // 4. Восстанавливаем порядок
  const sortedIndices = Array.from(resultMap.keys()).sort((a, b) => a - b);
  return sortedIndices.map(idx => resultMap.get(idx));
}
