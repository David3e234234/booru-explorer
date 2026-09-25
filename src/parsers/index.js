import { fetchDanbooru } from './danbooru.js';
import { fetchMoebooru } from './moebooru.js';
import { fetchSafebooru } from './safebooru.js';
import { fetchRule34 } from './rule34.js';
import { fetchGelbooru } from './gelbooru.js';
import { fetchRule34Video } from './rule34video.js';
import { fetchXbooru, fetchHypnohub, fetchTbib, fetchXbooruPostById } from './dapi.js';
import { fetchPawchive } from './pawchive.js';
import { fetchKemono } from './kemono.js';
import { isPostMatchingFilters } from '../utils/tagHelpers.js';
import { runWithDeadlineSignal } from '../utils/network.js';
import { 
  CURVY_INCLUDE_TAGS, 
  PETITE_INCLUDE_TAGS,
  FURRY_TAGS,
  PREGNANT_TAGS,
  LGBT_TAGS,
  SITES
} from '../config/constants.js';
import { logInfo, logError } from '../utils/logger.js';
import { learnAliasesFromPostMatches } from '../services/aliasService.js';

export {
  fetchDanbooru,
  fetchMoebooru,
  fetchSafebooru,
  fetchRule34,
  fetchGelbooru,
  fetchRule34Video,
  fetchXbooru,
  fetchXbooruPostById,
  fetchHypnohub,
  fetchTbib,
  fetchPawchive,
  fetchKemono,
  fetchSingleSiteBatch
};

const ALL_SITE_IDS = Object.keys(SITES);

async function fetchSingleSiteBatch(site, params, aiTagsList, settings) {
  try {
    switch (site) {
      case 'danbooru':
        return await fetchDanbooru(params, aiTagsList, settings);
      case 'rule34video':
        return await fetchRule34Video(params, aiTagsList, settings);
      case 'yandere':
        return await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', params, aiTagsList, settings);
      case 'safebooru':
        return await fetchSafebooru(params, aiTagsList, settings);
      case 'konachan':
        return await fetchMoebooru('konachan', 'https://konachan.com', 'Konachan', params, aiTagsList, settings);
      case 'rule34':
        return await fetchRule34(params, aiTagsList, settings);
      case 'gelbooru':
        return await fetchGelbooru(params, aiTagsList, settings);
      case 'xbooru':
        return await fetchXbooru(params, aiTagsList, settings);
      case 'hypnohub':
        return await fetchHypnohub(params, aiTagsList, settings);
      case 'tbib':
        return await fetchTbib(params, aiTagsList, settings);
      case 'pawchive':
        return await fetchPawchive(params, aiTagsList, settings);
      case 'kemono':
        return await fetchKemono(params, aiTagsList, settings);
      default:
        return [];
    }
  } catch (err) {
    logError('Parser Batch', `Ошибка выполнения парсера [${site}]`, err);
    return [];
  }
}

const SITE_FETCH_DEADLINE_MS = 15000;
const DEFAULT_DEEP_FETCH_DEPTH = 2;

// Races a site fetch against a deadline. Resolving early used to be all it did:
// the losing site kept fetching in the background, still holding its sockets, so
// a slow source could stall the next search long after the response was sent.
// The deadline now also aborts the in-flight requests, which means `work` must be
// a factory - the async context has to exist before any request is started.
// Nested deadlines compose (see runWithDeadlineSignal), so a per-page deadline
// inside the all-sites one cannot outlive the outer one.
function withDeadline(work, ms = SITE_FETCH_DEADLINE_MS) {
  const controller = new AbortController();
  let timer = null;

  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch {}
      resolve([]);
    }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  // A plain promise cannot be cancelled, but accepting one beats silently
  // resolving to [] because the caller forgot to wrap it in a function
  const factory = typeof work === 'function' ? work : () => work;

  const task = Promise.resolve()
    .then(() => runWithDeadlineSignal(controller.signal, factory))
    .catch(() => []);

  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function fetchPosts(site, params, aiTagsList, settings) {
  // Danbooru runs its own cursor loop (danbooru.js:185, up to 8 pages of fetches
  // with the default 25s timeout), so it needs the same site deadline as every
  // other source - without it a single slow search could hold the response for
  // minutes.
  if (site === 'danbooru') {
    return await withDeadline(() => fetchDanbooru(params, aiTagsList, settings));
  }

  if (site === 'all' || site === 'custom' || site.includes(',')) {
    let mainSites = [...ALL_SITE_IDS];

    if (site === 'custom' || site.includes(',')) {
      let customList = [];
      if (params.customSites) {
        customList = params.customSites.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      } else if (site.includes(',')) {
        customList = site.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      } else if (Array.isArray(settings?.customSources) && settings.customSources.length > 0) {
        customList = settings.customSources;
      } else {
        customList = ['danbooru', 'gelbooru', 'rule34', 'yandere'];
      }
      mainSites = customList.filter(s => ALL_SITE_IDS.includes(s));
      if (mainSites.length === 0) mainSites = ['danbooru', 'gelbooru'];
    }

    if (params.typeFilter === 'video' || params.typeFilter === 'audio' || params.typeFilter === 'sound') {
      mainSites = mainSites.filter(s => SITES[s]?.supportsVideo);
      if (mainSites.length === 0) mainSites = ['rule34video', 'danbooru'];
    } else if (params.typeFilter === 'image') {
      mainSites = mainSites.filter(s => SITES[s]?.supportsImages);
    } else if (params.typeFilter === 'zip' || params.typeFilter === 'archive') {
      mainSites = mainSites.filter(s => SITES[s]?.supportsArchives);
      if (mainSites.length === 0) mainSites = ['pawchive', 'kemono'];
    }

    if (params.ratingFilter === 'nsfw') {
      const nsfwAllowed = ['rule34video', 'danbooru', 'yandere', 'rule34', 'gelbooru', 'xbooru', 'hypnohub', 'konachan', 'tbib', 'pawchive', 'kemono'];
      mainSites = mainSites.filter(s => nsfwAllowed.includes(s));
      if (mainSites.length === 0) mainSites = ['danbooru', 'rule34'];
    } else if (params.ratingFilter === 'questionable' || params.ratingFilter === '16+') {
      const qAllowed = ['danbooru', 'yandere', 'rule34', 'gelbooru', 'xbooru', 'hypnohub', 'konachan', 'tbib', 'pawchive', 'kemono'];
      mainSites = mainSites.filter(s => qAllowed.includes(s));
      if (mainSites.length === 0) mainSites = ['danbooru', 'rule34', 'gelbooru'];
    } else if (params.ratingFilter === 'sfw') {
      const sfwAllowed = ['danbooru', 'safebooru', 'gelbooru', 'yandere', 'konachan'];
      mainSites = mainSites.filter(s => sfwAllowed.includes(s));
      if (mainSites.length === 0) mainSites = ['danbooru', 'safebooru'];
    }

    if (params.excludeSites) {
      const excluded = params.excludeSites.split(',').map(s => s.trim().toLowerCase());
      mainSites = mainSites.filter(s => !excluded.includes(s));
    }
    mainSites = [...new Set(mainSites)];

    const perSiteLimit = Math.max(25, Math.ceil((params.limit || 100) / Math.max(1, mainSites.length)));
    // In all-sites mode, 1 remote page per site (25-100 items) is more than enough.
    // Disabling multi-page deepFetch here avoids fan-out and dramatically cuts latency.
    const allModeSettings = { ...settings, deepFetchPages: 1 };
    const allSitesDeadline = 4000;
    const results = await Promise.allSettled(
      mainSites.map(s => withDeadline(() => fetchPosts(s, { ...params, limit: perSiteLimit }, aiTagsList, allModeSettings), allSitesDeadline))
    );
    const lists = [];
    results.forEach(res => {
      if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0) {
        lists.push(res.value);
      }
    });
    // Round-robin posts across sites for even variety
    const combined = [];
    const maxLength = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < maxLength; i++) {
      for (let j = 0; j < lists.length; j++) {
        if (i < lists[j].length) {
          combined.push(lists[j][i]);
        }
      }
    }
    const targetLimit = parseInt(params.limit, 10) || 100;
    const limited = combined.slice(0, Math.max(1, targetLimit));
    learnAliasesFromPostMatches(limited);
    return limited;
  }

  const targetLimit = parseInt(params.limit, 10) || 40;
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  // A non-numeric depth ("auto", "abc") used to reach the loop bound as NaN, and
  // `i < NaN` never runs - the site fetched one page and then discarded it.
  const parsedDeepFetchPages = parseInt(settings?.deepFetchPages, 10);
  const deepFetchPagesSetting = Number.isFinite(parsedDeepFetchPages) && parsedDeepFetchPages > 0
    ? parsedDeepFetchPages
    : DEFAULT_DEEP_FETCH_DEPTH;

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
    activeFurryTags: (Array.isArray(settings?.furryTags) && settings.furryTags.length > 0) ? settings.furryTags : FURRY_TAGS,
    activePregnantTags: (Array.isArray(settings?.pregnantTags) && settings.pregnantTags.length > 0) ? settings.pregnantTags : PREGNANT_TAGS,
    activeLgbtTags: (Array.isArray(settings?.lgbtTags) && settings.lgbtTags.length > 0) ? settings.lgbtTags : LGBT_TAGS,
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
  const startRemotePage = page;
  // Remote pages per single-site search, straight from the depth setting. 1 and 3+
  // mean what the UI says ("страниц на запрос": 1 = one page, 3 = three); the shipped
  // default (2) keeps the six pages single-site searches have always pulled, because
  // strict filters need that extra material to fill the feed. The old
  // Math.max(setting * 2, 6) raised every option the UI offers (1-5) back to six,
  // which is why the all-sites fan-out below - pinned to a depth of 1 - still fired
  // six requests per source instead of the single page it promises.
  const maxIterations = deepFetchPagesSetting === DEFAULT_DEEP_FETCH_DEPTH
    ? 6
    : deepFetchPagesSetting;
  // Respect the requested limit and make up depth with pipelined pages
  const batchLimit = Math.min(200, Math.max(targetLimit, 25));

  logInfo(site, `Глубокий поиск: tags="${params.tags || ''}", page=${page} (remote: ${startRemotePage}), limit=${targetLimit}, deepFetch=${shouldDeepFetch ? maxIterations + ' макс. стр.' : 'выкл'}`);

  const accumulatedPosts = [];
  const seenIds = new Set();

  // Pipeline: fetch the next page while the current one is still being processed
  const launchPage = (remotePage) =>
    withDeadline(() => fetchSingleSiteBatch(site, { ...params, page: remotePage, limit: batchLimit }, aiTagsList, settings))
      .catch(() => []);

  let inflight = launchPage(startRemotePage);
  let nextRemotePage = startRemotePage;

  for (let i = 0; i < maxIterations; i++) {
    const batch = await inflight;
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const post of batch) {
      if (!post || seenIds.has(post.id)) continue;
      seenIds.add(post.id);
      if (isPostMatchingFilters(post, filterCriteria)) {
        accumulatedPosts.push(post);
      }
    }

    // Early exit: as soon as we have enough filtered posts to fulfill the user's limit,
    // break immediately instead of waiting for extra remote pages
    if (accumulatedPosts.length >= targetLimit) {
      const isGlobalSortNeeded = (params.category === 'top' || params.category === 'views') && site !== 'all';
      if (!isGlobalSortNeeded || i >= 1) {
        break;
      }
    }

    // If a site returned fewer than 15 posts in a raw batch, its results are most likely exhausted
    if (batch.length < 15) {
      break;
    }
    if (i >= maxIterations - 1) {
      break;
    }

    nextRemotePage += 1;
    inflight = launchPage(nextRemotePage);
  }

  if (params.category === 'top' && site !== 'all') {
    accumulatedPosts.sort((a, b) => (b.score || 0) - (a.score || 0));
  } else if (params.category === 'views' && site !== 'all') {
    accumulatedPosts.sort((a, b) => (b.views || b.score || 0) - (a.views || a.score || 0));
  }

  return accumulatedPosts.slice(0, targetLimit);
}
