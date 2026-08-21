/**
 * Модуль группировки связанных постов (мульти-изображений, Pixiv сетов,
 * вариаций, комиксов и Parent/Child отношений) в единые альбомы.
 */

import { logInfo, logError } from './logger.js';

/**
 * Извлекает нормализованный ключ серии/альбома из метаданных поста
 * @param {Object} post - Нормализованный или сырой объект поста
 * @param {string} site - Идентификатор Booru-сайта
 * @returns {string|null} Ключ серии (например, "pixiv:10928374", "parent:danbooru:928374")
 */
export function extractSeriesKey(post, site = '') {
  if (!post) return null;
  const siteId = site || post.site || '';
  const source = (post.source || '').trim();
  const tags = Array.isArray(post.tags) ? post.tags : (typeof post.tag_string === 'string' ? post.tag_string.split(/\s+/) : []);

  // 1. Pixiv ID (приоритет: один ID иллюстрации объединяет все страницы/слайды)
  const pixivPatterns = [
    /pixiv\.net\/(?:en\/)?artworks\/(\d+)/i,
    /pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i,
    /i\.pximg\.net\/.*\/(\d+)_p\d+/i,
    /pixiv_(\d+)/i
  ];

  for (const regex of pixivPatterns) {
    const match = source.match(regex);
    if (match && match[1]) {
      return `pixiv:${match[1]}`;
    }
  }

  // Поиск Pixiv ID в тегах (например, "pixiv:12345678" или "pixiv_id:12345678")
  for (const tag of tags) {
    const tagMatch = tag.match(/^(?:pixiv|pixiv_id):(\d+)$/i);
    if (tagMatch && tagMatch[1]) {
      return `pixiv:${tagMatch[1]}`;
    }
  }

  // 2. Twitter / X Tweet Status ID (один твит может содержать до 4 изображений)
  const twitterMatch = source.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  if (twitterMatch && twitterMatch[1]) {
    return `twitter:${twitterMatch[1]}`;
  }

  // 3. Bluesky Post ID
  const bskyMatch = source.match(/bsky\.app\/profile\/[^/]+\/post\/([a-zA-Z0-9]+)/i);
  if (bskyMatch && bskyMatch[1]) {
    return `bsky:${bskyMatch[1]}`;
  }

  // 4. Fanbox / Fantia / Patreon / Nijie
  const fanboxMatch = source.match(/fanbox\.cc\/(?:@[\w-]+|[\w-]+)\/posts\/(\d+)/i);
  if (fanboxMatch && fanboxMatch[1]) {
    return `fanbox:${fanboxMatch[1]}`;
  }

  const fantiaMatch = source.match(/fantia\.jp\/posts\/(\d+)/i);
  if (fantiaMatch && fantiaMatch[1]) {
    return `fantia:${fantiaMatch[1]}`;
  }

  const patreonMatch = source.match(/patreon\.com\/posts\/(?:[\w-]+-)?(\d+)/i);
  if (patreonMatch && patreonMatch[1]) {
    return `patreon:${patreonMatch[1]}`;
  }

  // 5. Parent / Child связь Booru (если задан parentId или пост является родителем с детьми)
  const rawParentId = post.parentId || post.parent_id;
  if (rawParentId && String(rawParentId) !== '0' && String(rawParentId) !== 'null') {
    return `parent:${siteId}:${String(rawParentId)}`;
  }

  // Если сам пост имеет дочерние элементы
  const hasChildren = Boolean(post.hasChildren || post.has_children || post.has_active_children);
  if (hasChildren && (post.originalId || post.id)) {
    const rootId = String(post.originalId || post.id).replace(/^[a-z0-9_]+_/, '');
    return `parent:${siteId}:${rootId}`;
  }

  // 6. Пул (Pool) - главы манги / серии
  const poolId = post.poolId || post.pool_id;
  if (poolId) {
    return `pool:${siteId}:${String(poolId)}`;
  }

  return null;
}

/**
 * Сортировка страниц внутри сета (по номеру _p0, _p1 или по ID)
 */
function sortAlbumItems(items) {
  return [...items].sort((a, b) => {
    // Проверка номера страницы в URL (например, 12345_p0.jpg, 12345_p1.jpg)
    const getPageNum = (item) => {
      const target = item.fileUrl || item.sampleUrl || item.previewUrl || '';
      const pMatch = target.match(/_p(\d+)\./i) || target.match(/page_?(\d+)/i);
      if (pMatch) return parseInt(pMatch[1], 10);
      return null;
    };

    const pageA = getPageNum(a);
    const pageB = getPageNum(b);

    if (pageA !== null && pageB !== null) {
      return pageA - pageB;
    }

    // Если нет _p0, сортируем по ID по возрастанию (обычно загружаются последовательно)
    const idA = parseInt(String(a.originalId || a.id).replace(/\D/g, ''), 10) || 0;
    const idB = parseInt(String(b.originalId || b.id).replace(/\D/g, ''), 10) || 0;
    return idA - idB;
  });
}

/**
 * Группирует массив постов в мульти-посты (альбомы) по общим ключам серий
 * @param {Array} posts - Исходный массив постов
 * @param {Object} options - Опции группировки
 * @returns {Array} Массив постов со свернутыми альбомами
 */
export function groupPostsIntoAlbums(posts, options = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  if (options.enabled === false) return posts;

  const groups = new Map();
  const nonGrouped = [];

  // 1. Первый проход: присваиваем seriesKey и собираем группы
  posts.forEach((post, index) => {
    const key = post.seriesKey || extractSeriesKey(post, post.site);
    if (key) {
      post.seriesKey = key;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          firstIndex: index,
          items: []
        });
      }
      groups.get(key).items.push(post);
    } else {
      nonGrouped.push({ index, post });
    }
  });

  // 2. Формируем итоговый список постов
  const resultMap = new Map();

  // Добавляем одиночные посты без серии
  nonGrouped.forEach(({ index, post }) => {
    resultMap.set(index, post);
  });

  // Обрабатываем группы
  groups.forEach((group) => {
    const { key, firstIndex, items } = group;

    if (items.length > 1) {
      // Это полноценный альбом из 2+ слайдов в текущей выборке
      const sortedItems = sortAlbumItems(items);
      const rootPost = sortedItems[0];

      // Собираем объединенные теги
      const allTagsSet = new Set();
      sortedItems.forEach(item => {
        if (Array.isArray(item.tags)) {
          item.tags.forEach(t => allTagsSet.add(t));
        }
      });

      // Максимальный score, просмотры и закладки
      const maxScore = Math.max(...sortedItems.map(i => i.score || 0));
      const maxFavs = Math.max(...sortedItems.map(i => i.favCount || 0));
      const maxViews = Math.max(...sortedItems.map(i => i.views || 0));

      const albumPost = {
        ...rootPost,
        isAlbum: true,
        albumCount: sortedItems.length,
        albumItems: sortedItems,
        seriesKey: key,
        canFetchAlbum: true,
        tags: Array.from(allTagsSet),
        score: maxScore,
        favCount: maxFavs,
        views: maxViews
      };

      resultMap.set(firstIndex, albumPost);
    } else {
      // Одиночный пост с потенциальным сетом (hasChildren или pixiv source)
      const singlePost = items[0];
      const hasChildren = Boolean(singlePost.hasChildren || singlePost.has_children || singlePost.has_active_children);
      const hasParent = Boolean(singlePost.parentId && String(singlePost.parentId) !== '0');
      const isExternalSet = key.startsWith('pixiv:') || key.startsWith('twitter:') || key.startsWith('fanbox:');

      singlePost.isAlbum = false;
      singlePost.albumCount = 1;
      singlePost.seriesKey = key;
      singlePost.canFetchAlbum = Boolean(hasChildren || hasParent || isExternalSet);
      singlePost.albumItems = [singlePost];

      resultMap.set(firstIndex, singlePost);
    }
  });

  // 3. Восстанавливаем хронологический порядок выдачи
  const sortedIndices = Array.from(resultMap.keys()).sort((a, b) => a - b);
  return sortedIndices.map(idx => resultMap.get(idx));
}
