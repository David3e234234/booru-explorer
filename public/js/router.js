// Client-side URL state sync: mirrors search/viewer state into the address
// bar via the History API and restores it on popstate / deep links.
import { state } from './state.js';

const CATEGORIES = ['feed', 'following', 'recommended', 'favorites', 'profile'];

const KNOWN_SITES = new Set([
  'danbooru', 'gelbooru', 'rule34', 'yandere', 'konachan',
  'safebooru', 'rule34video', 'xbooru', 'hypnohub', 'tbib', 'pawchive', 'custom'
]);

const ENUMS = {
  sort: ['new', 'views', 'top'],
  ai: ['all', 'no-ai', 'only-ai'],
  rating: ['all', 'nsfw', 'questionable', 'sfw'],
  type: ['all', 'video', 'image'],
  age: ['all', 'adult', 'young'],
  date: ['all', '24h', '2d', '7d', '30d', '90d', '365d']
};

const MAX_URL_TAGS = 20;
const POST_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

let handlers = null;
let activePostId = null;     // post currently reflected in the URL (viewer open)
let bootPostId = null;       // post= param from the URL the app booted with
let awaitingBackPop = false; // our own history.back() is in flight
let applyingPopState = false; // inside popstate handling -> never push
let didFirstSync = false;    // first performSearch replaces instead of pushing

const enc = (s) => encodeURIComponent(String(s));

function currentUrl() {
  return window.location.pathname + window.location.search;
}

function buildQuery() {
  const parts = [];
  if (state.searchTags.length > 0) {
    parts.push(`tags=${state.searchTags.slice(0, MAX_URL_TAGS).map(enc).join('+').replace(/%3A/gi, ':')}`);
  }
  if (state.currentSite && state.currentSite !== 'danbooru') {
    parts.push(`site=${enc(state.currentSite)}`);
  }
  if (state.postSort && state.postSort !== 'new') {
    parts.push(`sort=${enc(state.postSort)}`);
  }
  if (state.currentCategory && state.currentCategory !== 'feed' && state.currentCategory !== 'new') {
    parts.push(`cat=${enc(state.currentCategory)}`);
  }
  if (state.currentCategory === 'favorites' && state.favoritesSubTab !== 'posts') {
    parts.push(`favtab=${enc(state.favoritesSubTab)}`);
  }
  if (state.currentCategory === 'profile' && state.profileSubTab !== 'likes') {
    parts.push(`ptab=${enc(state.profileSubTab)}`);
  }
  if (state.aiFilter !== 'no-ai') parts.push(`ai=${enc(state.aiFilter)}`);
  if (state.ratingFilter !== 'all') parts.push(`rating=${enc(state.ratingFilter)}`);
  if (state.typeFilter !== 'all') parts.push(`type=${enc(state.typeFilter)}`);
  if (state.ageFilter !== 'all') parts.push(`age=${enc(state.ageFilter)}`);
  if (state.dateFilter !== 'all') parts.push(`date=${enc(state.dateFilter)}`);
  return parts.join('&');
}

function buildUrl(postId) {
  const effectivePostId = postId !== undefined ? postId : (activePostId != null ? activePostId : bootPostId);
  const q = buildQuery();
  const postPart = effectivePostId != null && effectivePostId !== '' ? `post=${enc(effectivePostId)}` : '';
  const full = [q, postPart].filter(Boolean).join('&');
  return window.location.pathname + (full ? `?${full}` : '');
}

export function parseParams(searchStr = window.location.search) {
  const sp = new URLSearchParams(searchStr || '');
  const out = { tags: [], site: null, sort: null, cat: null, favtab: null, ptab: null, post: null };

  const tagsRaw = sp.get('tags');
  if (tagsRaw !== null) {
    for (const raw of tagsRaw.split(/[+\s]+/)) {
      const clean = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
      if (clean && !out.tags.includes(clean)) out.tags.push(clean);
      if (out.tags.length >= MAX_URL_TAGS) break;
    }
  }

  const site = sp.get('site');
  out.site = site && KNOWN_SITES.has(site) ? site : null;

  const rawCat = sp.get('cat');
  if (rawCat === 'new' || rawCat === 'views' || rawCat === 'top') {
    out.cat = 'feed';
    out.sort = rawCat;
  } else if (rawCat === 'random') {
    out.cat = 'feed';
  } else {
    out.cat = CATEGORIES.includes(rawCat) ? rawCat : null;
  }

  const sort = sp.get('sort');
  if (sort && ENUMS.sort.includes(sort)) {
    out.sort = sort;
  }

  const favtab = sp.get('favtab');
  out.favtab = favtab === 'authors' || favtab === 'posts' ? favtab : null;

  const ptab = sp.get('ptab');
  out.ptab = ['likes', 'favorites', 'authors', 'analytics'].includes(ptab) ? ptab : null;

  for (const key of Object.keys(ENUMS)) {
    if (key === 'sort') continue;
    const val = sp.get(key);
    out[key] = val && ENUMS[key].includes(val) ? val : null;
  }

  const post = sp.get('post');
  out.post = post && POST_ID_RE.test(post) ? post : null;

  return out;
}

// Applies parsed URL params onto the global state.
// Returns true when any search-affecting field has changed.
export function applyUrlToState(p) {
  let changed = false;

  if (p.tags && p.tags.join('|') !== state.searchTags.join('|')) {
    state.searchTags = [...p.tags];
    changed = true;
  }
  if (p.site && p.site !== state.currentSite) {
    state.currentSite = p.site;
    changed = true;
  }
  if (p.sort && p.sort !== state.postSort) {
    state.postSort = p.sort;
    changed = true;
  }
  if (p.cat && p.cat !== state.currentCategory) {
    state.currentCategory = p.cat;
    changed = true;
  }
  if (p.cat === 'favorites' && p.favtab && p.favtab !== state.favoritesSubTab) {
    state.favoritesSubTab = p.favtab;
    changed = true;
  }
  if (p.cat === 'profile' && p.ptab && p.ptab !== state.profileSubTab) {
    state.profileSubTab = p.ptab;
    changed = true;
  }
  if (p.ai && p.ai !== state.aiFilter) { state.aiFilter = p.ai; changed = true; }
  if (p.rating && p.rating !== state.ratingFilter) { state.ratingFilter = p.rating; changed = true; }
  if (p.type && p.type !== state.typeFilter) { state.typeFilter = p.type; changed = true; }
  if (p.age && p.age !== state.ageFilter) { state.ageFilter = p.age; changed = true; }
  if (p.date && p.date !== state.dateFilter) { state.dateFilter = p.date; changed = true; }

  return changed;
}

function onPopState() {
  awaitingBackPop = false;
  bootPostId = null;
  if (!handlers) return;

  const p = parseParams();
  applyingPopState = true;
  try {
    if (!p.post && handlers.onCloseViewerUi) handlers.onCloseViewerUi();
    const changed = applyUrlToState(p);
    if (handlers.onSearchParams) handlers.onSearchParams(changed);
    if (p.post && handlers.onOpenPost) handlers.onOpenPost(p.post);
  } finally {
    applyingPopState = false;
  }
}

export function initRouter(h) {
  handlers = h;
  window.addEventListener('popstate', onPopState);
}

// Boot-time restore: applies the current URL to state and returns params
// (caller decides what to do with params.post once the initial feed loads).
export function consumeInitialUrl() {
  const p = parseParams();
  bootPostId = p.post;
  applyUrlToState(p);
  return p;
}

// Mirrors current state into the address bar.
// mode: 'push' creates a history entry (new search), 'replace' rewrites it (load-more).
export function syncSearchUrl(mode = 'push') {
  didFirstSync = true;
  const target = buildUrl();
  if (target === currentUrl()) return;
  const usePush = !applyingPopState && mode === 'push';
  if (usePush) {
    history.pushState(history.state, '', target);
  } else {
    history.replaceState(history.state, '', target);
  }
}

export function notifyViewerOpened(postId) {
  activePostId = postId != null ? String(postId) : null;
  bootPostId = null;
  const target = buildUrl(activePostId);
  if (target === currentUrl()) {
    // Adopt the current entry as a viewer entry so Back closes the viewer.
    if (!(history.state && history.state.vr)) {
      history.replaceState({ ...(history.state || {}), vr: 1 }, '', target);
    }
  } else {
    history.pushState({ vr: 1 }, '', target);
  }
}

export function notifyViewerMoved(postId) {
  activePostId = postId != null ? String(postId) : null;
  bootPostId = null;
  history.replaceState({ vr: 1 }, '', buildUrl(activePostId));
}

export function notifyViewerClosed() {
  activePostId = null;
  bootPostId = null;
  if (applyingPopState) return;
  if (history.state && history.state.vr) {
    if (awaitingBackPop) return;
    awaitingBackPop = true;
    history.back();
  } else {
    history.replaceState(history.state, '', buildUrl(null));
  }
}
