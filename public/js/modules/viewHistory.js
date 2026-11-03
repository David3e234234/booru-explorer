// Client-only view tracking: the viewed-id set and the recency history live in
// localStorage, are capped and never sync to the server.
import { state, STORAGE_KEYS } from '../state.js';

export function loadLocalViewed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VIEWED);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      state.viewedIds = new Set(arr);
    }
    return arr;
  } catch (e) {
    return [];
  }
}

// Debounced: viewer navigation (including skip-media re-renders) calls this per
// keypress, and serializing up to 2000 ids on every call stalled typing
let viewedWriteTimer = null;

export function markPostViewed(id) {
  if (!id) return;
  state.viewedIds.add(id);
  if (viewedWriteTimer) clearTimeout(viewedWriteTimer);
  viewedWriteTimer = setTimeout(() => {
    viewedWriteTimer = null;
    try {
      let arr = Array.from(state.viewedIds);
      if (arr.length > 2000) {
        arr = arr.slice(arr.length - 2000);
        state.viewedIds = new Set(arr);
      }
      localStorage.setItem(STORAGE_KEYS.VIEWED, JSON.stringify(arr));
    } catch (e) {}
  }, 500);
}

// Client-side view history. Entries are kept minimal ({ i, s, t, v, ts }, ~150 B)
// and never leave the browser: unlike likes/favorites they are not synced to the
// server, so the Telegram backup size stays unaffected. The cap is intentional:
// it is a recency list, not an append-only user collection.
const VIEW_HISTORY_CAP = 500;
let historyWriteTimer = null;

export function recordPostHistory(post) {
  if (!post || !post.id || !post.site) return;
  const thumb = post.thumb360 || post.previewUrl || post.sampleUrl || '';
  const entry = {
    i: post.id,
    s: post.site,
    t: thumb,
    v: post.isVideo ? 1 : 0,
    ts: Date.now()
  };
  if (post.originalId && post.originalId !== post.id) {
    entry.o = post.originalId;
  }
  state.viewHistory = state.viewHistory.filter(e => e.i !== entry.i);
  state.viewHistory.unshift(entry);
  if (state.viewHistory.length > VIEW_HISTORY_CAP) {
    state.viewHistory.length = VIEW_HISTORY_CAP;
  }
  if (historyWriteTimer) clearTimeout(historyWriteTimer);
  historyWriteTimer = setTimeout(() => {
    historyWriteTimer = null;
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.viewHistory));
    } catch (e) {}
  }, 500);
}

export function loadViewHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      state.viewHistory = arr.filter(e => e && e.i && e.s);
    }
    return state.viewHistory;
  } catch (e) {
    state.viewHistory = [];
    return [];
  }
}

export function clearViewHistory() {
  state.viewHistory = [];
  if (historyWriteTimer) {
    clearTimeout(historyWriteTimer);
    historyWriteTimer = null;
  }
  try {
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
  } catch (e) {}
}

// Full wipe used by logout: stops the debounced write, drops the set and its storage.
export function clearViewedState() {
  if (viewedWriteTimer) {
    clearTimeout(viewedWriteTimer);
    viewedWriteTimer = null;
  }
  state.viewedIds = new Set();
  try {
    localStorage.removeItem(STORAGE_KEYS.VIEWED);
  } catch (e) {}
}
