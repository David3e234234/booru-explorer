// "Following" feed: batched queries for followed favorite authors across the
// selected sites, merged, deduplicated, sorted and filtered down to posts that
// really belong to a followed author.
import { state, isAuthorFavorite } from '../state.js';
import { fetchPosts } from '../api.js';
import { renderSidebarPageTags } from '../modules/sidebarTags.js';
import { getGalleryInstance, getAutocompleteInstance } from '../modules/lazyLoader.js';

// ctx: { reset, options, isSuperseded(), renderFavoriteAuthors() }
export async function runFollowingSearch(ctx) {
  const { reset, options } = ctx;
  try {
    state.isLoading = true;
    const btnRefreshSearch = document.getElementById('btnRefreshSearch');
    if (btnRefreshSearch) btnRefreshSearch.classList.add('refreshing');

    const isAllSites = state.currentSite === 'all';
    const isCustomSites = state.currentSite === 'custom';
    const customSitesList = (isCustomSites && Array.isArray(state.settings?.customSources) && state.settings.customSources.length > 0)
      ? state.settings.customSources
      : ['danbooru', 'gelbooru', 'rule34', 'yandere'];

    const allFollowed = Array.isArray(state.favoriteAuthors) ? state.favoriteAuthors : [];
    const followedAuthors = allFollowed.filter(author => {
      if (!author) return false;
      const isArchiveAuthor = author.site === 'pawchive' || author.site === 'kemono' || Boolean(author.service && author.user);
      if (isArchiveAuthor) {
        const authSite = author.site || 'pawchive';
        if (isAllSites || (isCustomSites && customSitesList.includes(authSite)) || state.currentSite === authSite) {
          return true;
        }
        // If viewing another site (e.g. Booru), include archive author if they have known aliases
        const checkNames = [author.name, author.displayName].filter(Boolean);
        for (const n of checkNames) {
          const clean = String(n).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').trim();
          if (state.authorAliases && (state.authorAliases[clean] || state.authorAliases[clean.replace(/[\s_.-]+/g, '_')])) {
            return true;
          }
        }
        return false;
      }
      // General booru authors (e.g. the_atko, vicineko, doridoriko) exist across multiple boorus
      return true;
    });
    const currentLimit = state.settings.itemsPerPage || state.limit || 40;

    if (followedAuthors.length === 0) {
      state.posts = [];
      state.hasMore = false;
      galleryInstance.renderGallery(false);
      renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
      return { success: true };
    }

    // Helper to find aliases for a given author name
    const getKnownAliases = (name) => {
      if (!name || !state.authorAliases) return [];
      const nLower = String(name).toLowerCase().trim();
      const nUnder = nLower.replace(/[\s_.-]+/g, '_');
      const list = state.authorAliases[nLower] || state.authorAliases[nUnder] || [];
      return Array.isArray(list) ? list : [];
    };

    // Collect author queries for search
    const authorQueries = [];
    for (const author of followedAuthors) {
      const fallbackName = String(author.name || '').trim();
      const rawName = String(author.displayName || '').trim();
      const baseName = (fallbackName || rawName.split(',')[0]).replace(/^@/, '').replace(/^pixiv:/i, '').trim();
      if (!baseName) continue;

      const isArchiveAuthor = author.site === 'pawchive' || author.site === 'kemono' || Boolean(author.service && author.user);
      let targetSite = state.currentSite;

      if (isArchiveAuthor) {
        const authSite = author.site || 'pawchive';
        if (state.currentSite === 'all' || (isCustomSites && customSitesList.includes(authSite)) || state.currentSite === authSite) {
          targetSite = authSite;
          let queryTag = '';
          if (author.service && author.user) {
            queryTag = `service:${author.service} user:${author.user}`;
          } else {
            queryTag = `artist:${baseName.replace(/\s+/g, '_')}`;
          }
          const queryKey = `${targetSite}:${queryTag}`;
          if (queryTag && !authorQueries.some(q => q.key === queryKey)) {
            authorQueries.push({ site: targetSite, tag: queryTag, key: queryKey });
          }
        } else {
          // Archive author being queried on a non-archive site (e.g. Booru): query their aliases
          const aliases = getKnownAliases(baseName);
          for (const alias of aliases) {
            const queryTag = alias.replace(/\s+/g, '_');
            const queryKey = `${targetSite}:${queryTag}`;
            if (queryTag && !authorQueries.some(q => q.key === queryKey)) {
              authorQueries.push({ site: targetSite, tag: queryTag, key: queryKey });
            }
          }
        }
      } else {
        // Booru author queried on archive or booru site
        if (targetSite === 'pawchive' || targetSite === 'kemono') {
          const queryTag = `artist:${baseName.replace(/\s+/g, '_')}`;
          const queryKey = `${targetSite}:${queryTag}`;
          if (queryTag && !authorQueries.some(q => q.key === queryKey)) {
            authorQueries.push({ site: targetSite, tag: queryTag, key: queryKey });
          }
          // Also explicitly query known aliases if any
          const aliases = getKnownAliases(baseName);
          for (const alias of aliases) {
            const aQueryTag = `artist:${alias.replace(/\s+/g, '_')}`;
            const aQueryKey = `${targetSite}:${aQueryTag}`;
            if (!authorQueries.some(q => q.key === aQueryKey)) {
              authorQueries.push({ site: targetSite, tag: aQueryTag, key: aQueryKey });
            }
          }
        } else {
          const queryTag = baseName.replace(/\s+/g, '_');
          const queryKey = `${targetSite}:${queryTag}`;
          if (queryTag && !authorQueries.some(q => q.key === queryKey)) {
            authorQueries.push({ site: targetSite, tag: queryTag, key: queryKey });
          }
        }
      }
    }

    if (authorQueries.length === 0) {
      state.posts = [];
      state.hasMore = false;
      galleryInstance.renderGallery(false);
      renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
      return { success: true };
    }

    const searchQueryStr = state.searchTags.length > 0 ? state.searchTags.join(' ').trim() : '';
    const effectiveSort = (state.postSort && state.postSort !== 'new') ? state.postSort : 'new';
    
    // Fetch author posts in controlled concurrent batches to prevent API rate-limiting (e.g. Rule34 HTTP 429)
    const batchSize = 4;
    const results = [];
    for (let i = 0; i < authorQueries.length; i += batchSize) {
      const batch = authorQueries.slice(i, i + batchSize);
      const batchTasks = batch.map(aQuery => {
        const combinedTags = searchQueryStr ? `${aQuery.tag} ${searchQueryStr}` : aQuery.tag;
        return fetchPosts({
          site: aQuery.site,
          tags: combinedTags,
          page: state.page,
          limit: Math.min(40, currentLimit),
          category: effectiveSort,
          customSites: aQuery.site === 'custom' ? (state.settings?.customSources || customSitesList) : '',
          pawchiveService: aQuery.site === 'pawchive' ? (state.pawchiveService || 'all') : '',
          kemonoService: aQuery.site === 'kemono' ? (state.kemonoService || 'all') : '',
          aiFilter: state.aiFilter,
          ratingFilter: state.ratingFilter,
          typeFilter: state.typeFilter,
          ageFilter: state.ageFilter,
          hideFurry: state.hideFurry,
          hidePregnant: state.hidePregnant,
          hideLgbt: state.hideLgbt,
          bustCache: options.bustCache || false
        }).catch(() => null);
      });
      const batchResults = await Promise.allSettled(batchTasks);
      if (ctx.isSuperseded()) return;
      results.push(...batchResults);
    }
    if (ctx.isSuperseded()) return;

    let allFetchedPosts = [];
    const authorLists = [];
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value && res.value.success && Array.isArray(res.value.posts) && res.value.posts.length > 0) {
        authorLists.push(res.value.posts);
        allFetchedPosts.push(...res.value.posts);
      }
    }

    // If sorting by "hot", interleave across author lists so each creator gets equal representation
    let orderedPosts = allFetchedPosts;
    if (effectiveSort === 'hot' && authorLists.length > 1) {
      orderedPosts = [];
      const maxLength = Math.max(0, ...authorLists.map(l => l.length));
      for (let i = 0; i < maxLength; i++) {
        for (let j = 0; j < authorLists.length; j++) {
          if (i < authorLists[j].length) {
            orderedPosts.push(authorLists[j][i]);
          }
        }
      }
    }

    // Deduplicate posts
    const seenIds = new Set();
    const uniquePosts = [];
    for (const post of orderedPosts) {
      if (!post || !post.id || seenIds.has(post.id)) continue;
      seenIds.add(post.id);
      uniquePosts.push(post);
    }

    // Sort unique posts according to selected sort mode
    if (effectiveSort === 'top') {
      uniquePosts.sort((a, b) => {
        const scoreA = Number(a.score) || 0;
        const scoreB = Number(b.score) || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA && timeB && timeA !== timeB) return timeB - timeA;
        const numIdA = Number(String(a.originalId || a.id).replace(/\D/g, '')) || 0;
        const numIdB = Number(String(b.originalId || b.id).replace(/\D/g, '')) || 0;
        return numIdB - numIdA;
      });
    } else if (effectiveSort === 'views') {
      uniquePosts.sort((a, b) => {
        const viewsA = Number(a.views != null ? a.views : (a.favCount || a.score || 0));
        const viewsB = Number(b.views != null ? b.views : (b.favCount || b.score || 0));
        if (viewsB !== viewsA) return viewsB - viewsA;
        const scoreA = Number(a.score) || 0;
        const scoreB = Number(b.score) || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA && timeB && timeA !== timeB) return timeB - timeA;
        const numIdA = Number(String(a.originalId || a.id).replace(/\D/g, '')) || 0;
        const numIdB = Number(String(b.originalId || b.id).replace(/\D/g, '')) || 0;
        return numIdB - numIdA;
      });
    } else if (effectiveSort === 'new') {
      uniquePosts.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA && timeB && timeA !== timeB) return timeB - timeA;
        const numIdA = Number(String(a.originalId || a.id).replace(/\D/g, '')) || 0;
        const numIdB = Number(String(b.originalId || b.id).replace(/\D/g, '')) || 0;
        return numIdB - numIdA;
      });
    }

    // Strictly verify that the post belongs to followed favorite authors
    const isPostByFollowedAuthor = (post) => {
      if (!post) return false;

      if (post.site === 'pawchive' || post.site === 'kemono' || (post.service && post.user)) {
        const matchAuthor = followedAuthors.some(a => 
          a.service && a.user && 
          String(a.service).toLowerCase() === String(post.service || '').toLowerCase() && 
          String(a.user) === String(post.user)
        );
        if (matchAuthor) return true;
      }

      const artists = Array.isArray(post.tagDetails?.artist) && post.tagDetails.artist.length > 0
        ? post.tagDetails.artist
        : (post.author ? post.author.split(',').map(s => s.trim()).filter(Boolean) : []);

      if (artists.length > 0) {
        if (artists.some(art => isAuthorFavorite(art))) return true;
      }

      if (post.author && isAuthorFavorite(post.author)) return true;

      if (Array.isArray(post.tags)) {
        for (const t of post.tags) {
          const cleanT = String(t).replace(/^(artist|creator|author):/i, '').trim();
          if (isAuthorFavorite(cleanT)) {
            if (!post.author) {
              post.author = cleanT;
            }
            if (!post.tagDetails) post.tagDetails = {};
            if (!Array.isArray(post.tagDetails.artist)) post.tagDetails.artist = [];
            if (!post.tagDetails.artist.includes(cleanT)) post.tagDetails.artist.unshift(cleanT);
            return true;
          }
        }
      }

      return false;
    };

    const authorFilteredPosts = uniquePosts.filter(p => isPostByFollowedAuthor(p));
    const filteredPosts = authorFilteredPosts.filter(p => p && p.id && !state.dislikedIds.has(p.id));
    const pageSlice = filteredPosts.slice(0, currentLimit);

    if (reset) {
      state.posts = pageSlice;
    } else {
      const existingIds = new Set(state.posts.map(p => p.id));
      const newPosts = pageSlice.filter(p => !existingIds.has(p.id));
      state.posts.push(...newPosts);
    }
    state.hasMore = pageSlice.length > 0;

    galleryInstance.renderGallery(!reset);
    renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
  } catch (err) {
    console.error('Ошибка загрузки ленты подписок:', err);
    if (ctx.isSuperseded()) return { success: false, superseded: true };
    if (reset) {
      state.posts = [];
    } else {
      state.page--;
      state.hasMore = true;
    }
    galleryInstance.renderGallery(false);
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
