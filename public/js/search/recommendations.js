// "For you" recommendations: candidate generation from taste seeds (or the
// cold-start popular/new/random streams), match scoring and MMR
// diversification across authors, characters and franchises.
import {
  state,
  getUserInterestTags,
  getRecommendationSeeds,
  getUserNegativeSeedTokens,
  getUserMediaPreferences,
  calculatePostMatchPercent
} from '../state.js';
import { fetchPosts } from '../api.js';
import { renderSidebarPageTags } from '../modules/sidebarTags.js';
import { getGalleryInstance, getAutocompleteInstance } from '../modules/lazyLoader.js';

// ctx: { reset, options, isSuperseded() }
export async function runRecommendedSearch(ctx) {
  const { reset, options } = ctx;
  const galleryInstance = getGalleryInstance();
  const autocompleteInstance = getAutocompleteInstance();
  try {
    state.isLoading = true;
    const btnRefreshSearch = document.getElementById('btnRefreshSearch');
    if (btnRefreshSearch) btnRefreshSearch.classList.add('refreshing');

    const focusMode = state.recommendationFocus || state.settings?.recommendationFocus || 'all';
    const userInterests = getUserInterestTags(null, { focusMode });
    const interestMap = new Map(userInterests.map(i => [i.tag, i.score]));
    const currentLimit = state.settings.itemsPerPage || state.limit || 40;
    let candidatePosts = [];

    if (state.searchTags.length > 0) {
      const res = await fetchPosts({
        site: state.currentSite,
        tags: state.searchTags.join(' '),
        page: state.page,
        limit: currentLimit,
        category: 'recommended',
        aiFilter: state.aiFilter,
        ratingFilter: state.ratingFilter,
        typeFilter: state.typeFilter,
        ageFilter: state.ageFilter,
        hideFurry: state.hideFurry,
        hidePregnant: state.hidePregnant,
        hideLgbt: state.hideLgbt,
        bustCache: options.bustCache || false
      });
      if (res.success && Array.isArray(res.posts)) {
        candidatePosts = res.posts;
      }
    } else {
      const fetchTasks = [];

      if (state.currentSite === 'pawchive' || state.currentSite === 'kemono') {
        const recSite = state.currentSite;
        // Creator-centric recommendation: extract liked and favorite artists
        const candidateArtists = [];
        const addArtistCandidate = (name) => {
          if (!name) return;
          const clean = name.toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/^artist:/i, '').trim();
          if (clean && !candidateArtists.includes(clean)) {
            candidateArtists.push(clean);
          }
          if (state.authorAliases) {
            const aliases = state.authorAliases[clean] || state.authorAliases[clean.replace(/[\s_.-]+/g, '_')] || [];
            for (const a of aliases) {
              const aClean = String(a).toLowerCase().trim();
              if (aClean && !candidateArtists.includes(aClean)) {
                candidateArtists.push(aClean);
              }
            }
          }
        };

        if (userInterests.length > 0) {
          const creatorInterests = userInterests.filter(i => i.category === 'artist' || i.score >= 5.0);
          for (const item of creatorInterests) {
            addArtistCandidate(item.tag);
          }
        }
        for (const fa of (state.favoriteAuthors || [])) {
          addArtistCandidate(fa.name || '');
          if (fa.displayName) addArtistCandidate(fa.displayName);
        }

        if (candidateArtists.length > 0) {
          const authorsPerPage = 5;
          const startIndex = ((state.page - 1) * authorsPerPage) % candidateArtists.length;
          const selectedAuthors = [];
          for (let i = 0; i < Math.min(authorsPerPage, candidateArtists.length); i++) {
            selectedAuthors.push(candidateArtists[(startIndex + i) % candidateArtists.length]);
          }
          const authorPageNum = Math.max(1, Math.ceil(state.page / Math.max(1, Math.ceil(candidateArtists.length / authorsPerPage))));

          for (const creator of selectedAuthors) {
            fetchTasks.push(
              fetchPosts({
                site: recSite,
                tags: `artist:${creator}`,
                page: authorPageNum,
                limit: 30,
                category: 'new',
                pawchiveService: recSite === 'pawchive' ? (state.pawchiveService || 'all') : '',
                kemonoService: recSite === 'kemono' ? (state.kemonoService || 'all') : '',
                aiFilter: state.aiFilter,
                ratingFilter: state.ratingFilter,
                typeFilter: state.typeFilter,
                ageFilter: state.ageFilter,
                hideFurry: state.hideFurry,
                hidePregnant: state.hidePregnant,
                hideLgbt: state.hideLgbt,
                bustCache: options.bustCache || false
              }).catch(() => null)
            );
          }
        }

        fetchTasks.push(
          fetchPosts({
            site: recSite,
            tags: '',
            page: state.page,
            limit: Math.min(currentLimit, 50),
            category: 'new',
            pawchiveService: recSite === 'pawchive' ? (state.pawchiveService || 'all') : '',
            kemonoService: recSite === 'kemono' ? (state.kemonoService || 'all') : '',
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter,
            ageFilter: state.ageFilter,
            hideFurry: state.hideFurry,
            hidePregnant: state.hidePregnant,
            hideLgbt: state.hideLgbt,
            bustCache: options.bustCache || false
          }).catch(() => null),
          fetchPosts({
            site: recSite,
            tags: '',
            page: state.page,
            limit: Math.min(currentLimit, 50),
            category: 'random',
            pawchiveService: recSite === 'pawchive' ? (state.pawchiveService || 'all') : '',
            kemonoService: recSite === 'kemono' ? (state.kemonoService || 'all') : '',
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter,
            ageFilter: state.ageFilter,
            hideFurry: state.hideFurry,
            hidePregnant: state.hidePregnant,
            hideLgbt: state.hideLgbt,
            bustCache: options.bustCache || false
          }).catch(() => null)
        );
      } else if (userInterests.length > 0) {
        // Dynamic Multi-Tier seeds rotated with page offset
        const selectedSeeds = getRecommendationSeeds({
          limit: 4,
          page: state.page,
          focusMode
        });

        // Extract top user negative tokens from dislikes to filter out at Booru API level
        const negativeSeedTokens = getUserNegativeSeedTokens(3);
        const isDanbooru = (state.currentSite === 'danbooru');
        // Danbooru budgets 2 tags anonymously and 3 for a member account. The
        // server enforces the real budget, so seeds are only kept short enough
        // to avoid spending slots on negative padding.
        const maxAllowedTokens = isDanbooru ? 3 : 5;

        for (const rawSeed of selectedSeeds) {
          const cleanSeedTag = rawSeed.replace(/[()]/g, '').trim();
          if (!cleanSeedTag) continue;

          const seedParts = cleanSeedTag.split(/\s+/).filter(Boolean);
          let queryTokens = [...seedParts];

          if (isDanbooru) {
            if (queryTokens.length === 1 && negativeSeedTokens.length > 0) {
              queryTokens.push(negativeSeedTokens[0]);
            } else if (queryTokens.length > maxAllowedTokens) {
              queryTokens = queryTokens.slice(0, maxAllowedTokens);
            }
          } else {
            for (const neg of negativeSeedTokens) {
              if (queryTokens.length >= maxAllowedTokens) break;
              queryTokens.push(neg);
            }
            if (focusMode === 'discovery' && queryTokens.length <= 2) {
              queryTokens.push('score:>10');
            }
          }

          const finalSeedQuery = queryTokens.join(' ');

          fetchTasks.push(
            fetchPosts({
              site: state.currentSite,
              tags: finalSeedQuery,
              page: 1 + Math.floor((state.page - 1) / Math.max(1, selectedSeeds.length)),
              limit: 28,
              category: 'new',
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null)
          );
        }

        // Serendipity / discovery stream
        const discoveryCategory = (focusMode === 'discovery') ? 'random' : 'popular';
        fetchTasks.push(
          fetchPosts({
            site: state.currentSite,
            tags: '',
            page: state.page,
            limit: Math.min(currentLimit, 35),
            category: discoveryCategory,
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter,
            ageFilter: state.ageFilter,
            hideFurry: state.hideFurry,
            hidePregnant: state.hidePregnant,
            hideLgbt: state.hideLgbt,
            bustCache: options.bustCache || false
          }).catch(() => null)
        );
      } else {
        // Cold start / No interest history
        fetchTasks.push(
          fetchPosts({
            site: state.currentSite,
            tags: '',
            page: state.page,
            limit: 35,
            category: 'popular',
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter,
            ageFilter: state.ageFilter,
            hideFurry: state.hideFurry,
            hidePregnant: state.hidePregnant,
            hideLgbt: state.hideLgbt,
            bustCache: options.bustCache || false
          }).catch(() => null),
          fetchPosts({
            site: state.currentSite,
            tags: '',
            page: state.page,
            limit: 35,
            category: 'new',
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter,
            ageFilter: state.ageFilter,
            hideFurry: state.hideFurry,
            hidePregnant: state.hidePregnant,
            hideLgbt: state.hideLgbt,
            bustCache: options.bustCache || false
          }).catch(() => null),
          fetchPosts({
            site: state.currentSite,
            tags: '',
            page: state.page,
            limit: 30,
            category: 'random',
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter,
            ageFilter: state.ageFilter,
            hideFurry: state.hideFurry,
            hidePregnant: state.hidePregnant,
            hideLgbt: state.hideLgbt,
            bustCache: options.bustCache || false
          }).catch(() => null)
        );
      }

      const results = await Promise.allSettled(fetchTasks);
      if (ctx.isSuperseded()) return;
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value && res.value.success && Array.isArray(res.value.posts)) {
          candidatePosts.push(...res.value.posts);
        }
      }
    }

    const seen = new Set();
    const filteredCandidates = [];

    candidatePosts.forEach(p => {
      if (!p || !p.id) return;
      if (seen.has(p.id)) return;
      seen.add(p.id);

      if (state.likedIds.has(p.id) || state.favoriteIds.has(p.id) || state.dislikedIds.has(p.id)) {
        return;
      }

      filteredCandidates.push(p);
    });

    const mediaPrefs = getUserMediaPreferences();
    const scoredCandidates = filteredCandidates.map(p => {
      const matchResult = calculatePostMatchPercent(p, interestMap, { mediaPrefs });
      let basePercent = typeof matchResult === 'object' ? matchResult.percent : matchResult;
      const matchedTags = typeof matchResult === 'object' ? matchResult.matchedTags : [];
      const matchedDetails = typeof matchResult === 'object' ? (matchResult.matchedDetails || []) : [];
      const matchExplanation = typeof matchResult === 'object' ? matchResult.matchExplanation : '';
      const isViewed = state.viewedIds.has(p.id);
      if (isViewed && basePercent > 0) {
        basePercent = Math.round(basePercent * 0.55);
      }
      return {
        ...p,
        matchPercent: basePercent,
        matchedTags,
        matchedDetails,
        matchExplanation,
        isViewed
      };
    });

    // Multi-Attribute MMR Diversification (Authors, Characters, Franchises)
    const finalRecommended = [];
    const authorCountMap = new Map();
    const characterCountMap = new Map();
    const copyrightCountMap = new Map();
    let lastAuthor = null;
    let lastCharacter = null;
    const candidatePool = [...scoredCandidates];

    while (candidatePool.length > 0 && finalRecommended.length < currentLimit) {
      let bestIndex = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < candidatePool.length; i++) {
        const item = candidatePool[i];
        const rawAuthor = item.author || (item.tagDetails?.artist?.[0]) || 'unknown';
        const cleanAuthor = String(rawAuthor).toLowerCase().trim();
        const seenAuthorCount = authorCountMap.get(cleanAuthor) || 0;

        let authorPenalty = 1.0;
        if (cleanAuthor !== 'unknown') {
          if (seenAuthorCount === 1) authorPenalty = 0.65;
          else if (seenAuthorCount === 2) authorPenalty = 0.35;
          else if (seenAuthorCount >= 3) authorPenalty = 0.10;
        }
        const adjacentAuthorPenalty = (cleanAuthor !== 'unknown' && cleanAuthor === lastAuthor) ? 0.35 : 1.0;

        // Character diversity penalty
        const primaryChar = item.tagDetails?.character?.[0] ? String(item.tagDetails.character[0]).toLowerCase().trim() : 'unknown';
        const seenCharCount = characterCountMap.get(primaryChar) || 0;
        let charPenalty = 1.0;
        if (primaryChar !== 'unknown') {
          if (seenCharCount === 1) charPenalty = 0.75;
          else if (seenCharCount === 2) charPenalty = 0.45;
          else if (seenCharCount >= 3) charPenalty = 0.20;
        }
        const adjacentCharPenalty = (primaryChar !== 'unknown' && primaryChar === lastCharacter) ? 0.50 : 1.0;

        // Franchise diversity penalty
        const primaryCp = item.tagDetails?.copyright?.[0] ? String(item.tagDetails.copyright[0]).toLowerCase().trim() : 'unknown';
        const seenCpCount = copyrightCountMap.get(primaryCp) || 0;
        const cpPenalty = (primaryCp !== 'unknown' && seenCpCount >= 3) ? 0.65 : 1.0;

        const effectiveScore = (item.matchPercent || 0) * authorPenalty * adjacentAuthorPenalty * charPenalty * adjacentCharPenalty * cpPenalty;

        if (effectiveScore > bestScore) {
          bestScore = effectiveScore;
          bestIndex = i;
        }
      }

      if (bestIndex !== -1) {
        const [selected] = candidatePool.splice(bestIndex, 1);
        finalRecommended.push(selected);

        const rawAuthor = selected.author || (selected.tagDetails?.artist?.[0]) || 'unknown';
        const cleanAuthor = String(rawAuthor).toLowerCase().trim();
        if (cleanAuthor !== 'unknown') {
          authorCountMap.set(cleanAuthor, (authorCountMap.get(cleanAuthor) || 0) + 1);
          lastAuthor = cleanAuthor;
        } else {
          lastAuthor = null;
        }

        const primaryChar = selected.tagDetails?.character?.[0] ? String(selected.tagDetails.character[0]).toLowerCase().trim() : 'unknown';
        if (primaryChar !== 'unknown') {
          characterCountMap.set(primaryChar, (characterCountMap.get(primaryChar) || 0) + 1);
          lastCharacter = primaryChar;
        } else {
          lastCharacter = null;
        }

        const primaryCp = selected.tagDetails?.copyright?.[0] ? String(selected.tagDetails.copyright[0]).toLowerCase().trim() : 'unknown';
        if (primaryCp !== 'unknown') {
          copyrightCountMap.set(primaryCp, (copyrightCountMap.get(primaryCp) || 0) + 1);
        }
      } else {
        break;
      }
    }

    if (finalRecommended.length < currentLimit && candidatePool.length > 0) {
      finalRecommended.push(...candidatePool.slice(0, currentLimit - finalRecommended.length));
    }

    if (reset) {
      state.posts = finalRecommended;
    } else {
      const existingIds = new Set(state.posts.map(p => p.id));
      const newPosts = finalRecommended.filter(p => !existingIds.has(p.id));
      state.posts.push(...newPosts);
    }
    state.hasMore = candidatePosts.length > 0 || finalRecommended.length > 0;

    galleryInstance?.renderGallery(!reset);
    renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance?.selectTag(t) });
  } catch (err) {
    console.error('Ошибка рекомендаций:', err);
    if (ctx.isSuperseded()) return { success: false, superseded: true };
    if (reset) {
      state.posts = [];
    } else {
      state.page--;
      state.hasMore = true;
    }
    galleryInstance?.renderGallery(false);
    return { success: false, error: err };
  } finally {
    if (!ctx.isSuperseded()) {
      state.isLoading = false;
      const btnRefreshSearch = document.getElementById('btnRefreshSearch');
      if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
    }
  }
  return { success: true };
}
