import { fetchDanbooru } from './danbooru.js';
import { fetchMoebooru } from './moebooru.js';
import { fetchSafebooru } from './safebooru.js';
import { fetchRule34 } from './rule34.js';
import { fetchGelbooru } from './gelbooru.js';
import { fetchRule34Video } from './rule34video.js';
import { fetchXbooru, fetchHypnohub } from './dapi.js';
import { isPostMatchingFilters } from '../utils/tagHelpers.js';
import { CURVY_INCLUDE_TAGS, PETITE_INCLUDE_TAGS } from '../config/constants.js';
import { logInfo } from '../utils/logger.js';

export {
  fetchDanbooru,
  fetchMoebooru,
  fetchSafebooru,
  fetchRule34,
  fetchGelbooru,
  fetchRule34Video,
  fetchXbooru,
  fetchHypnohub
};

async function fetchSingleSiteBatch(site, params, aiTagsList, settings) {
  switch (site) {
    case 'rule34video':
      return await fetchRule34Video(params, aiTagsList);
    case 'yandere':
      return await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', params, aiTagsList);
    case 'safebooru':
      return await fetchSafebooru(params, aiTagsList);
    case 'konachan':
      return await fetchMoebooru('konachan', 'https://konachan.net', 'Konachan', params, aiTagsList);
    case 'rule34':
      return await fetchRule34(params, aiTagsList, settings);
    case 'gelbooru':
      return await fetchGelbooru(params, aiTagsList, settings);
    case 'xbooru':
      return await fetchXbooru(params, aiTagsList);
    case 'hypnohub':
      return await fetchHypnohub(params, aiTagsList);
    default:
      return [];
  }
}

export async function fetchPosts(site, params, aiTagsList, settings) {
  if (site === 'danbooru') {
    return await fetchDanbooru(params, aiTagsList, settings);
  }

  if (site === 'all') {
    let mainSites = ['danbooru', 'yandere', 'safebooru', 'konachan', 'rule34', 'gelbooru', 'rule34video', 'xbooru', 'hypnohub'];
    if (params.typeFilter === 'video' || params.typeFilter === 'audio' || params.typeFilter === 'sound') {
      mainSites = ['rule34video', 'danbooru', 'rule34', 'gelbooru', 'xbooru', 'hypnohub'];
    } else if (params.ratingFilter === 'nsfw') {
      mainSites = ['rule34video', 'danbooru', 'yandere', 'rule34', 'gelbooru', 'xbooru', 'hypnohub'];
    }
    if (params.excludeSites) {
      const excluded = params.excludeSites.split(',').map(s => s.trim().toLowerCase());
      mainSites = mainSites.filter(s => !excluded.includes(s));
    }
    const perSiteLimit = Math.max(25, Math.ceil((params.limit || 100) / mainSites.length));
    const results = await Promise.allSettled(
      mainSites.map(s => fetchPosts(s, { ...params, limit: perSiteLimit }, aiTagsList, settings))
    );
    const lists = [];
    results.forEach(res => {
      if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0) {
        lists.push(res.value);
      }
    });
    // Чередование (Round-Robin) постов с разных сайтов для равномерного разнообразия
    const combined = [];
    const maxLength = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < maxLength; i++) {
      for (let j = 0; j < lists.length; j++) {
        if (i < lists[j].length) {
          combined.push(lists[j][i]);
        }
      }
    }
    return combined;
  }

  const targetLimit = parseInt(params.limit, 10) || 40;
  const page = parseInt(params.page, 10) || 1;
  const deepFetchPagesSetting = settings?.deepFetchPages ? parseInt(settings.deepFetchPages, 10) : 2;

  const negativeTokens = (params.tags || '')
    .split(/\s+/)
    .filter(t => t.startsWith('-') && t.length > 1)
    .map(t => t.substring(1).toLowerCase().replace(/_/g, ' '));

  const hasUserPositiveTags = Boolean((params.tags || '').split(/\s+/).some(t => t && !t.startsWith('-') && !t.includes(':')));

  const filterCriteria = {
    typeFilter: params.typeFilter || 'all',
    ageFilter: params.ageFilter || 'all',
    aiFilter: params.aiFilter || 'no-ai',
    ratingFilter: params.ratingFilter || 'all',
    hideFurry: params.hideFurry || settings?.hideFurry,
    hidePregnant: params.hidePregnant || settings?.hidePregnant,
    hideLgbt: params.hideLgbt || settings?.hideLgbt,
    blacklist: settings?.blacklist || [],
    negativeTokens,
    activeCurvyTags: (Array.isArray(settings?.curvyTags) && settings.curvyTags.length > 0) ? settings.curvyTags : CURVY_INCLUDE_TAGS,
    activePetiteTags: (Array.isArray(settings?.petiteTags) && settings.petiteTags.length > 0) ? settings.petiteTags : PETITE_INCLUDE_TAGS,
    hasUserPositiveTags
  };

  const hasStrictFilters = (params.ageFilter && params.ageFilter !== 'all') ||
                           (params.aiFilter && params.aiFilter !== 'all') ||
                           (params.typeFilter && params.typeFilter !== 'all') ||
                           (params.ratingFilter && params.ratingFilter !== 'all') ||
                           (settings?.blacklist && settings.blacklist.length > 0) ||
                           settings?.hideFurry ||
                           settings?.hidePregnant ||
                           settings?.hideLgbt ||
                           negativeTokens.length > 0;

  const shouldDeepFetch = hasStrictFilters || deepFetchPagesSetting > 1 || targetLimit > 40;
  const pageMultiplier = Math.max(1, deepFetchPagesSetting);
  const startRemotePage = (page - 1) * pageMultiplier + 1;
  const maxIterations = shouldDeepFetch ? Math.max(deepFetchPagesSetting * 2, 6) : 1;

  logInfo(site, `Глубокий поиск: tags="${params.tags || ''}", page=${page} (remote: ${startRemotePage}), limit=${targetLimit}, deepFetch=${shouldDeepFetch ? maxIterations + ' макс. стр.' : 'выкл'}`);

  const accumulatedPosts = [];
  const seenIds = new Set();

  for (let i = 0; i < maxIterations; i++) {
    const currentRemotePage = startRemotePage + i;
    const batchLimit = Math.max(targetLimit, 100);
    const batch = await fetchSingleSiteBatch(site, { ...params, page: currentRemotePage, limit: batchLimit }, aiTagsList, settings);

    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const post of batch) {
      if (!post || seenIds.has(post.id)) continue;
      seenIds.add(post.id);
      if (isPostMatchingFilters(post, filterCriteria)) {
        accumulatedPosts.push(post);
      }
    }

    if (accumulatedPosts.length >= targetLimit && i >= deepFetchPagesSetting - 1) {
      break;
    }

    // Если сайт вернул меньше 15 постов в сырой пачке, скорее всего результаты закончились
    if (batch.length < 15) {
      break;
    }
  }

  if (params.category === 'top' && site !== 'all') {
    accumulatedPosts.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  return accumulatedPosts.slice(0, targetLimit);
}
