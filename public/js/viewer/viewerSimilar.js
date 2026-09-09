import { state, getSimilarPostPlan, calculatePostSimilarityScore } from '../state.js';
import { fetchPosts, getProxiedUrl } from '../api.js';
import { haptic } from '../modules/uiUtils.js';
import { t } from '../i18n.js';

let similarFetchSeq = 0;
let similarContext = {
  openViewer: null
};

/**
 * Configure shared viewer context for similar posts.
 * @param {{ openViewer: Function }} ctx
 */
export function configureSimilar(ctx) {
  similarContext = { ...similarContext, ...ctx };
}

/**
 * Multi-tier similar posts retrieval and bottom filmstrip rendering.
 * @param {Object} targetPost
 * @param {boolean} [forceRefresh=false]
 * @param {Object} [options={}]
 */
export async function renderSidebarSimilarPosts(targetPost, forceRefresh = false, options = {}) {
  if (!targetPost) return;
  const seq = ++similarFetchSeq;

  if (targetPost._similarSession && !forceRefresh) {
    resumeSimilarSession(targetPost, options);
    return;
  }

  try {
    const plan = getSimilarPostPlan(targetPost);
    if (!plan.queries || plan.queries.length === 0) {
      if (seq === similarFetchSeq) {
        renderSimilarFilmstrip([], options);
      }
      return;
    }

    const session = {
      plan,
      pool: [],
      seenIds: new Set(),
      renderedCount: 0,
      currentPage: 1,
      queryIndex: 0,
      hasMore: true,
      isLoadingMore: false,
      loaderEl: null
    };
    targetPost._similarSession = session;

    const postSite = targetPost.site || state.currentSite || 'danbooru';
    const initialQueries = plan.queries.slice(0, 4);
    session.queryIndex = initialQueries.length;

    const tasks = initialQueries.map(query => {
      return fetchPosts({
        site: postSite,
        tags: query,
        page: 1,
        limit: 30,
        category: 'new',
        aiFilter: state.aiFilter || 'all',
        ratingFilter: state.ratingFilter || 'all',
        typeFilter: state.typeFilter || 'all',
        ageFilter: state.ageFilter || 'all',
        hideFurry: state.hideFurry,
        hidePregnant: state.hidePregnant,
        hideLgbt: state.hideLgbt
      }).catch(() => null);
    });

    const results = await Promise.allSettled(tasks);
    if (seq !== similarFetchSeq) return;

    const candidateMap = new Map();
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value && res.value.success && Array.isArray(res.value.posts)) {
        for (const p of res.value.posts) {
          if (!p || !p.id || p.id === targetPost.id) continue;
          if (state.dislikedIds?.has(p.id)) continue;
          if (!candidateMap.has(p.id)) {
            candidateMap.set(p.id, p);
          }
        }
      }
    }

    for (const p of candidateMap.values()) {
      const score = calculatePostSimilarityScore(p, targetPost);
      session.pool.push({ post: p, score });
      session.seenIds.add(p.id);
    }

    session.pool.sort((a, b) => b.score - a.score);
    targetPost._similarPosts = session.pool;

    renderSimilarFilmstripSession(targetPost, options);
  } catch (err) {
    console.warn('Ошибка загрузки похожих постов:', err);
    if (seq === similarFetchSeq) {
      renderSimilarFilmstrip([], options);
    }
  }
}

/**
 * Renders the session into the similar posts bottom filmstrip.
 * @param {Object} targetPost
 * @param {Object} [options={}]
 */
export function renderSimilarFilmstripSession(targetPost, options = {}) {
  const viewerSimilarFilmstrip = document.getElementById('viewerSimilarFilmstrip');
  const similarFilmstripInner = document.getElementById('similarFilmstripInner');
  const viewerContent = document.querySelector('.viewer-content');
  if (!viewerSimilarFilmstrip || !similarFilmstripInner) return;

  const session = targetPost._similarSession;
  if (!session || session.pool.length === 0) {
    viewerSimilarFilmstrip.style.display = 'none';
    if (viewerContent) viewerContent.classList.remove('has-similar');
    return;
  }

  if (viewerContent) viewerContent.classList.add('has-similar');
  viewerSimilarFilmstrip.style.display = 'flex';

  similarFilmstripInner.innerHTML = '';
  session.renderedCount = 0;
  appendSimilarItems(targetPost, 18, options);
}

/**
 * Resumes an existing similar filmstrip session without refetching.
 * @param {Object} targetPost
 * @param {Object} [options={}]
 */
export function resumeSimilarSession(targetPost, options = {}) {
  const viewerSimilarFilmstrip = document.getElementById('viewerSimilarFilmstrip');
  const similarFilmstripInner = document.getElementById('similarFilmstripInner');
  const similarFilmstripCount = document.getElementById('similarFilmstripCount');
  const viewerContent = document.querySelector('.viewer-content');
  if (!viewerSimilarFilmstrip || !similarFilmstripInner) return;

  const session = targetPost._similarSession;
  if (!session || session.pool.length === 0) {
    viewerSimilarFilmstrip.style.display = 'none';
    if (viewerContent) viewerContent.classList.remove('has-similar');
    return;
  }

  if (viewerContent) viewerContent.classList.add('has-similar');
  viewerSimilarFilmstrip.style.display = 'flex';

  if (similarFilmstripInner.children.length > 0 && session.renderedCount > 0) {
    if (similarFilmstripCount) {
      similarFilmstripCount.textContent = session.hasMore ? `${session.renderedCount}+` : `${session.renderedCount}`;
    }
    return;
  }

  renderSimilarFilmstripSession(targetPost, options);
}

/**
 * Appends the next batch of items into the similar filmstrip.
 * @param {Object} targetPost
 * @param {number} [count=18]
 * @param {Object} [options={}]
 */
export function appendSimilarItems(targetPost, count = 18, options = {}) {
  const similarFilmstripInner = document.getElementById('similarFilmstripInner');
  const similarFilmstripCount = document.getElementById('similarFilmstripCount');
  if (!similarFilmstripInner || !targetPost?._similarSession) return;

  const session = targetPost._similarSession;
  const toRender = session.pool.slice(session.renderedCount, session.renderedCount + count);
  if (toRender.length === 0) return;

  const frag = document.createDocumentFragment();
  toRender.forEach(({ post: item, score }) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'similar-filmstrip-item';
    const rawThumb = item.thumb360 || item.previewUrl || item.sampleUrl || item.thumb180 || item.fileUrl || '';
    const thumbSrc = rawThumb ? (rawThumb.startsWith('/api/') ? rawThumb : getProxiedUrl(rawThumb)) : '';
    const isHighMatch = score >= 65;

    itemDiv.title = `${t('vw.similarity', 'Сходство:')} ${score}%${item.author ? `\n@${item.author}` : ''}`;
    itemDiv.innerHTML = `
      <img class="similar-filmstrip-img" src="${thumbSrc}" alt="Similar post" loading="lazy" referrerpolicy="no-referrer">
      <span class="similar-filmstrip-score ${isHighMatch ? 'score-high' : ''}">${score}%</span>
    `;

    itemDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic(15);
      const openFn = options.openViewer || similarContext.openViewer;
      if (typeof openFn === 'function') {
        openFn(-1, { directPost: item, move: true });
      }
    });

    frag.appendChild(itemDiv);
  });

  if (session.loaderEl && session.loaderEl.parentNode === similarFilmstripInner) {
    similarFilmstripInner.insertBefore(frag, session.loaderEl);
  } else {
    similarFilmstripInner.appendChild(frag);
  }

  session.renderedCount += toRender.length;
  if (similarFilmstripCount) {
    similarFilmstripCount.textContent = session.hasMore ? `${session.renderedCount}+` : `${session.renderedCount}`;
  }
}

/**
 * Loads more similar posts upon reaching the end of the filmstrip.
 * @param {Object} targetPost
 * @param {Object} [options={}]
 */
export async function loadMoreSimilarPosts(targetPost, options = {}) {
  const similarFilmstripInner = document.getElementById('similarFilmstripInner');
  const similarFilmstripCount = document.getElementById('similarFilmstripCount');
  if (!targetPost || !targetPost._similarSession) return;

  const session = targetPost._similarSession;
  if (session.isLoadingMore || !session.hasMore) return;

  const unrenderedInPool = session.pool.length - session.renderedCount;
  if (unrenderedInPool >= 8) {
    appendSimilarItems(targetPost, 12, options);
    return;
  }

  session.isLoadingMore = true;

  if (!session.loaderEl && similarFilmstripInner) {
    session.loaderEl = document.createElement('div');
    session.loaderEl.className = 'similar-filmstrip-loader';
    session.loaderEl.innerHTML = '<div class="similar-filmstrip-loader-spinner"></div>';
    similarFilmstripInner.appendChild(session.loaderEl);
    similarFilmstripInner.scrollLeft += 40;
  }

  try {
    const postSite = targetPost.site || state.currentSite || 'danbooru';
    let queriesToFetch = [];

    if (session.queryIndex < session.plan.queries.length) {
      queriesToFetch = session.plan.queries.slice(session.queryIndex, session.queryIndex + 3);
      session.queryIndex += queriesToFetch.length;
    } else {
      session.currentPage++;
      if (session.currentPage > 5) {
        session.hasMore = false;
      } else {
        queriesToFetch = session.plan.queries.slice(0, 3);
      }
    }

    if (queriesToFetch.length > 0 && session.hasMore) {
      const tasks = queriesToFetch.map(query => {
        return fetchPosts({
          site: postSite,
          tags: query,
          page: session.currentPage,
          limit: 30,
          category: 'new',
          aiFilter: state.aiFilter || 'all',
          ratingFilter: state.ratingFilter || 'all',
          typeFilter: state.typeFilter || 'all',
          ageFilter: state.ageFilter || 'all',
          hideFurry: state.hideFurry,
          hidePregnant: state.hidePregnant,
          hideLgbt: state.hideLgbt
        }).catch(() => null);
      });

      const results = await Promise.allSettled(tasks);
      let newItemsAdded = 0;

      for (const res of results) {
        if (res.status === 'fulfilled' && res.value && res.value.success && Array.isArray(res.value.posts)) {
          for (const p of res.value.posts) {
            if (!p || !p.id || p.id === targetPost.id) continue;
            if (state.dislikedIds?.has(p.id) || session.seenIds.has(p.id)) continue;
            session.seenIds.add(p.id);
            const score = calculatePostSimilarityScore(p, targetPost);
            session.pool.push({ post: p, score });
            newItemsAdded++;
          }
        }
      }

      if (newItemsAdded === 0 && session.queryIndex >= session.plan.queries.length && session.currentPage >= 3) {
        session.hasMore = false;
      }
    }
  } catch (err) {
    console.warn('Ошибка догрузки похожих постов:', err);
    session.hasMore = false;
  } finally {
    if (session.loaderEl && session.loaderEl.parentNode) {
      session.loaderEl.remove();
      session.loaderEl = null;
    }
    session.isLoadingMore = false;
    appendSimilarItems(targetPost, 12, options);
    if (similarFilmstripCount) {
      similarFilmstripCount.textContent = session.hasMore ? `${session.renderedCount}+` : `${session.renderedCount}`;
    }
  }
}

/**
 * Renders static or pre-computed similar items in the filmstrip.
 * @param {Array<Object>} similarItems
 * @param {Object} [options={}]
 */
export function renderSimilarFilmstrip(similarItems, options = {}) {
  const viewerSimilarFilmstrip = document.getElementById('viewerSimilarFilmstrip');
  const viewerContent = document.querySelector('.viewer-content');
  if (!viewerSimilarFilmstrip) return;

  if (!similarItems || similarItems.length === 0) {
    viewerSimilarFilmstrip.style.display = 'none';
    if (viewerContent) viewerContent.classList.remove('has-similar');
    return;
  }

  const targetPost = options.currentPost || (options.getCurrentPost ? options.getCurrentPost() : null);
  if (targetPost) {
    targetPost._similarSession = {
      plan: { queries: [] },
      pool: Array.isArray(similarItems) ? similarItems : [],
      seenIds: new Set(similarItems.map(i => i.post?.id).filter(Boolean)),
      renderedCount: 0,
      currentPage: 1,
      queryIndex: 0,
      hasMore: false,
      isLoadingMore: false,
      loaderEl: null
    };
    renderSimilarFilmstripSession(targetPost, options);
  }
}

/**
 * Displays given similar posts.
 * @param {Array<Object>} similarItems
 * @param {Object} [sourcePost]
 * @param {Object} [options={}]
 */
export function displaySimilarPosts(similarItems, sourcePost, options = {}) {
  renderSimilarFilmstrip(similarItems, { ...options, currentPost: sourcePost });
}

/**
 * Initializes mouse wheel and infinite scroll events on the similar filmstrip.
 * @param {{ getCurrentPost: () => Object }} ctx
 */
export function initSimilarEvents(ctx) {
  const similarFilmstripInner = document.getElementById('similarFilmstripInner');
  if (!similarFilmstripInner) return;

  similarFilmstripInner.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      similarFilmstripInner.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  similarFilmstripInner.addEventListener('scroll', () => {
    const currentPost = ctx?.getCurrentPost?.();
    if (!currentPost || !currentPost._similarSession) return;
    const { scrollLeft, clientWidth, scrollWidth } = similarFilmstripInner;
    if (scrollLeft + clientWidth >= scrollWidth - 250) {
      loadMoreSimilarPosts(currentPost);
    }
  });
}
