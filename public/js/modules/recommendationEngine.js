// Recommendation and similarity engine: taste extraction from likes, favorites
// and dislikes, session signals, seed generation and post matching.
import { state, saveLocalSettings } from '../state.js';

// Broad composition/generic tags that should NOT be wiped out by single dislikes
// and should receive dampening (IDF penalty) so they don't overpower specific characters/artists
const GENERIC_DISLIKE_PROTECTED_TAGS = new Set([
  'solo', '1girl', '1boy', '2girls', '2boys', 'multiple_girls', 'multiple_boys',
  'looking_at_viewer', 'smile', 'open_mouth', 'closed_eyes', 'blush', 'sitting', 'standing', 'lying',
  'long_hair', 'short_hair', 'medium_hair', 'blonde_hair', 'black_hair', 'brown_hair', 'blue_hair', 'white_hair', 'pink_hair', 'red_hair', 'green_hair', 'purple_hair',
  'blue_eyes', 'red_eyes', 'brown_eyes', 'green_eyes', 'purple_eyes', 'yellow_eyes', 'black_eyes',
  'breasts', 'large_breasts', 'medium_breasts', 'small_breasts',
  'simple_background', 'white_background', 'transparent_background', 'full_body', 'upper_body', 'portrait', 'cowboy_shot',
  'highres', 'absurdres', 'superabsurdres', 'comic', 'monochrome', 'greyscale'
]);

// Calculate exponential half-life decay for timestamps
function getTemporalDecayFactor(dateString, halfLifeDays = 25) {
  if (!dateString) return 0.65;
  try {
    const itemDate = new Date(dateString).getTime();
    if (isNaN(itemDate)) return 0.65;
    const now = Date.now();
    const daysDiff = Math.max(0, (now - itemDate) / (1000 * 60 * 60 * 24));
    // Half-life formula: 2^(-t / halfLife) with 0.20 floor so historical preferences persist as a subtle base
    return Math.max(0.20, Math.pow(2, -daysDiff / Math.max(1, halfLifeDays)));
  } catch (e) {
    return 0.65;
  }
}

// Short-term in-session interaction tracking
const sessionInterests = new Map(); // tag -> { score, category, lastSeen }

export function recordSessionInteraction(post, interactionType = 'view') {
  if (!post) return;
  const now = Date.now();
  const baseWeight = interactionType === 'similar' ? 1.2 : interactionType === 'zoom' ? 0.8 : 0.4;

  const addSessionTag = (rawTag, cat, mult = 1.0) => {
    const clean = cleanTagString(rawTag);
    if (!clean || GENERIC_DISLIKE_PROTECTED_TAGS.has(clean)) return;
    const prev = sessionInterests.get(clean) || { score: 0, category: cat, lastSeen: now };
    prev.score = Math.min(5.0, prev.score + baseWeight * mult);
    prev.lastSeen = now;
    sessionInterests.set(clean, prev);
  };

  if (post.author) addSessionTag(post.author, 'artist', 2.0);
  const td = post.tagDetails || {};
  if (Array.isArray(td.artist)) td.artist.forEach(a => addSessionTag(a, 'artist', 2.0));
  if (Array.isArray(td.character)) td.character.forEach(c => addSessionTag(c, 'character', 1.6));
  if (Array.isArray(td.copyright)) td.copyright.forEach(cp => addSessionTag(cp, 'copyright', 1.3));
  if (Array.isArray(td.general)) td.general.slice(0, 4).forEach(g => addSessionTag(g, 'general', 0.6));
}

export function getSessionInterests() {
  const now = Date.now();
  const ONE_HOUR = 3600 * 1000;
  const valid = [];
  for (const [tag, data] of sessionInterests.entries()) {
    if (now - data.lastSeen < ONE_HOUR) {
      valid.push({ tag, score: data.score, category: data.category });
    } else {
      sessionInterests.delete(tag);
    }
  }
  return valid;
}

export function clearSessionInterests() {
  sessionInterests.clear();
  sessionSkipPenalties.clear();
}

// Short-term in-session skip tracking for posts that lingered in viewport without clicks
const sessionSkipPenalties = new Map(); // tag -> { penalty, category, lastSeen }

export function recordPostImpressionSkip(post) {
  if (!post || state.settings?.recommendationEnableSkipPenalty === false) return;
  const now = Date.now();
  const applySkip = (rawTag, cat, mult = 1.0) => {
    const clean = cleanTagString(rawTag);
    if (!clean || GENERIC_DISLIKE_PROTECTED_TAGS.has(clean)) return;
    const prev = sessionSkipPenalties.get(clean) || { penalty: 0, category: cat, lastSeen: now };
    prev.penalty = Math.min(1.8, prev.penalty + 0.20 * mult);
    prev.lastSeen = now;
    sessionSkipPenalties.set(clean, prev);
  };
  if (post.author) applySkip(post.author, 'artist', 1.5);
  const td = post.tagDetails || {};
  if (Array.isArray(td.artist)) td.artist.forEach(a => applySkip(a, 'artist', 1.5));
  if (Array.isArray(td.character)) td.character.forEach(c => applySkip(c, 'character', 1.2));
  if (Array.isArray(td.copyright)) td.copyright.forEach(cp => applySkip(cp, 'copyright', 1.0));
  if (Array.isArray(td.general)) td.general.slice(0, 3).forEach(g => applySkip(g, 'general', 0.5));
}

export function getSessionSkipPenalties() {
  const now = Date.now();
  const ONE_HOUR = 3600 * 1000;
  const valid = [];
  for (const [tag, data] of sessionSkipPenalties.entries()) {
    if (now - data.lastSeen < ONE_HOUR) {
      valid.push({ tag, penalty: data.penalty, category: data.category });
    } else {
      sessionSkipPenalties.delete(tag);
    }
  }
  return valid;
}

// Calculate user format preferences (videos vs images, portrait vs landscape)
let _mediaPrefsCache = null;
let _mediaPrefsCacheKey = '';

export function getUserMediaPreferences() {
  const cacheKey = `${state.likes.length}|${state.favorites.length}`;
  if (_mediaPrefsCache && _mediaPrefsCacheKey === cacheKey) {
    return _mediaPrefsCache;
  }

  const postsPool = [...state.likes, ...state.favorites];
  if (postsPool.length === 0) {
    _mediaPrefsCache = { videoAffinity: 0, prefersPortrait: false };
    _mediaPrefsCacheKey = cacheKey;
    return _mediaPrefsCache;
  }
  let videoCount = 0;
  let portraitCount = 0;
  let validAspectCount = 0;

  for (const p of postsPool) {
    if (p.isVideo) videoCount++;
    if (p.width && p.height) {
      validAspectCount++;
      if (p.height > p.width * 1.15) portraitCount++;
    }
  }

  const videoAffinity = videoCount / postsPool.length;
  const prefersPortrait = validAspectCount > 0 && (portraitCount / validAspectCount) > 0.65;
  _mediaPrefsCache = { videoAffinity, prefersPortrait };
  _mediaPrefsCacheKey = cacheKey;
  return _mediaPrefsCache;
}

// Extract top disliked tags to inject into seed queries as negative tokens (-tag)
export function getUserNegativeSeedTokens(maxTokens = 4) {
  if (!Array.isArray(state.dislikes) || state.dislikes.length === 0) return [];

  const halfLife = state.settings?.recommendationDecayDays || 25;
  const dislikeWeights = new Map();
  const positiveCounts = new Map();

  // Tally positive counts to prevent excluding tags that the user actually likes elsewhere
  for (const post of (state.likes || [])) {
    if (post.author) {
      const a = cleanTagString(post.author);
      if (a) positiveCounts.set(a, (positiveCounts.get(a) || 0) + 1);
    }
    const td = post.tagDetails || {};
    for (const arr of [td.artist, td.character, td.copyright, td.general]) {
      if (Array.isArray(arr)) {
        for (const t of arr) {
          const clean = cleanTagString(t);
          if (clean) positiveCounts.set(clean, (positiveCounts.get(clean) || 0) + 1);
        }
      }
    }
  }

  // Tally dislike penalties
  for (const post of state.dislikes) {
    const decay = getTemporalDecayFactor(post.dislikedAt, halfLife * 1.5);
    const inspect = (rawTag, mult) => {
      const clean = cleanTagString(rawTag);
      if (!clean || GENERIC_DISLIKE_PROTECTED_TAGS.has(clean)) return;
      dislikeWeights.set(clean, (dislikeWeights.get(clean) || 0) + mult * decay);
    };

    if (post.author) inspect(post.author, 4.0);
    const td = post.tagDetails || {};
    if (Array.isArray(td.artist)) td.artist.forEach(a => inspect(a, 4.0));
    if (Array.isArray(td.character)) td.character.forEach(c => inspect(c, 3.0));
    if (Array.isArray(td.copyright)) td.copyright.forEach(cp => inspect(cp, 2.5));
    if (Array.isArray(td.general)) td.general.forEach(g => inspect(g, 1.2));
  }

  const negativeCandidates = [];
  for (const [tag, dislikeScore] of dislikeWeights.entries()) {
    const pos = positiveCounts.get(tag) || 0;
    // Only exclude tags that have strong dislike signals and minimal/no positive history
    if (dislikeScore >= 2.5 && pos <= 1) {
      negativeCandidates.push({ tag, netPenalty: dislikeScore - pos * 2 });
    }
  }

  negativeCandidates.sort((a, b) => b.netPenalty - a.netPenalty);
  return negativeCandidates.slice(0, maxTokens).map(c => `-${c.tag}`);
}

// Advanced algorithm for extracting the user's interest map with temporal decay and category balancing
let _interestCache = null;
let _interestCacheKey = '';

export function invalidateInterestCache() {
  _interestCache = null;
  _interestCacheKey = '';
}

export function getUserInterestTags(limit = null, options = {}) {
  const halfLife = state.settings?.recommendationDecayDays || 25;
  const focusMode = options.focusMode || state.recommendationFocus || state.settings?.recommendationFocus || 'all';

  const cacheKey = [
    state.likes.length,
    state.favorites.length,
    (state.dislikes || []).length,
    state.favoriteAuthors.length,
    Object.keys(state.authorAliases || {}).length,
    state.settings?.excludedInterestTags?.length || 0,
    halfLife,
    focusMode
  ].join('|');

  if (_interestCache && _interestCacheKey === cacheKey) {
    const cached = _interestCache;
    return (typeof limit === 'number' && limit > 0) ? cached.slice(0, limit) : cached;
  }

  const counts = new Map(); // tag -> positive weight sum
  const dislikeCounts = new Map(); // tag -> negative penalty sum
  const weights = new Map(); // tag -> baseWeight
  const catMap = new Map(); // tag -> category

  // 1. Analyze all liked posts (weight 2.2 × temporal decay)
  for (const post of state.likes) {
    const decay = getTemporalDecayFactor(post.likedAt, halfLife);
    extractTagsFromPost(post, counts, weights, catMap, 2.2 * decay);
  }

  // 2. Analyze favorites (weight 1.8 × temporal decay with slightly longer half-life)
  for (const post of state.favorites) {
    const decay = getTemporalDecayFactor(post.favoritedAt || post.likedAt, halfLife * 1.4);
    extractTagsFromPost(post, counts, weights, catMap, 1.8 * decay);
  }

  // 3. Analyze hidden / disliked posts (penalty 2.0 × temporal decay with generic protection)
  for (const post of (state.dislikes || [])) {
    const decay = getTemporalDecayFactor(post.dislikedAt, halfLife * 1.5);
    extractTagsFromPost(post, dislikeCounts, weights, catMap, 2.0 * decay, true);
  }

  // 4. Inject short-term session signals (boost up to +0.8)
  const sessionList = getSessionInterests();
  for (const item of sessionList) {
    counts.set(item.tag, (counts.get(item.tag) || 0) + item.score * 0.8);
    if (!catMap.has(item.tag)) catMap.set(item.tag, item.category);
    if (!weights.has(item.tag)) weights.set(item.tag, 1.2);
  }

  // 5. Inject short-term session skip penalties (if enabled)
  if (state.settings?.recommendationEnableSkipPenalty !== false) {
    const skipList = getSessionSkipPenalties();
    for (const item of skipList) {
      dislikeCounts.set(item.tag, (dislikeCounts.get(item.tag) || 0) + item.penalty);
    }
  }

  const scores = new Map();

  // Apply sublinear smoothing with penalty subtraction: baseWeight * log2(1 + netCount)
  for (const [tag, count] of counts.entries()) {
    const penalty = dislikeCounts.get(tag) || 0;
    const netCount = count - penalty;
    if (netCount <= 0.08) continue; // Tag suppressed by dislikes

    let baseWeight = weights.get(tag) || 1.0;
    const category = catMap.get(tag) || 'general';

    // IDF Damping: Penalize ubiquitous/generic descriptor tags (1girl, solo, etc.)
    // so they do not dominate specific characters, franchises, or artistic elements
    if (GENERIC_DISLIKE_PROTECTED_TAGS.has(tag)) {
      baseWeight *= 0.45;
    }

    // Focus mode multipliers
    if (focusMode === 'artists' && category === 'artist') {
      baseWeight *= 2.2;
    } else if (focusMode === 'characters' && (category === 'character' || category === 'copyright')) {
      baseWeight *= 2.0;
    } else if (focusMode === 'discovery' && category === 'general') {
      baseWeight *= 1.4;
    }

    const score = baseWeight * Math.log2(1 + netCount);
    scores.set(tag, score);
  }

  // 5. Favorite authors bonus (including bidirectional aliases)
  const aliasMap = state.authorAliases || {};
  for (const author of state.favoriteAuthors) {
    const raw = (author.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    if (raw) {
      const bonus = (focusMode === 'artists' ? 16.0 : 10.0);
      scores.set(raw, (scores.get(raw) || 0) + bonus);
      catMap.set(raw, 'artist');

      const knownAliases = aliasMap[raw] || aliasMap[raw.replace(/[\s_.-]+/g, '')];
      if (Array.isArray(knownAliases)) {
        for (const al of knownAliases) {
          const cleanAl = String(al).toLowerCase().replace(/^(artist|creator|author):/i, '').replace(/\s+/g, '_').trim();
          if (cleanAl && cleanAl !== raw) {
            scores.set(cleanAl, (scores.get(cleanAl) || 0) + bonus * 0.9);
            catMap.set(cleanAl, 'artist');
          }
        }
      }
    }
  }

  const excludedSet = new Set((state.settings.excludedInterestTags || []).map(t => String(t).toLowerCase().trim()));

  const list = [];
  for (const [tag, score] of scores.entries()) {
    if (excludedSet.has(tag)) continue;
    list.push({ tag, score, category: catMap.get(tag) || 'general' });
  }

  list.sort((a, b) => b.score - a.score);
  _interestCache = list;
  _interestCacheKey = cacheKey;
  return (typeof limit === 'number' && limit > 0) ? list.slice(0, limit) : list;
}

// Extract stable tag pair combinations for seed queries
export function getUserInterestSeedPairs(limit = 12, precomputedInterests = null) {
  const userInterests = precomputedInterests || getUserInterestTags();
  if (userInterests.length === 0) return [];

  const interestMap = new Map(userInterests.map(i => [i.tag, i.score]));
  const excludedSet = new Set((state.settings.excludedInterestTags || []).map(t => String(t).toLowerCase().trim()));
  const pairScores = new Map();

  const postsPool = [...state.likes, ...state.favorites];
  for (const post of postsPool) {
    if (!post) continue;
    const td = post.tagDetails || {};
    const artists = (td.artist || (post.author ? [post.author] : []))
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const characters = (td.character || [])
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const copyrights = (td.copyright || [])
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const generals = (td.general || (Array.isArray(post.tags) ? post.tags : []))
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));

    const addPair = (t1, t2, boost = 1.0) => {
      if (!t1 || !t2 || t1 === t2) return;
      const sortedPair = [t1, t2].sort().join(' ');
      const s1 = interestMap.get(t1) || 1;
      const s2 = interestMap.get(t2) || 1;
      const pairScore = (s1 + s2) * boost;
      pairScores.set(sortedPair, (pairScores.get(sortedPair) || 0) + pairScore);
    };

    for (const a of artists) {
      for (const c of characters) addPair(a, c, 2.6);
      for (const cp of copyrights) addPair(a, cp, 2.0);
    }
    for (const c of characters) {
      for (const cp of copyrights) addPair(c, cp, 2.0);
      for (const g of generals.slice(0, 3)) addPair(c, g, 1.2);
    }
  }

  const sortedPairs = Array.from(pairScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  return sortedPairs.slice(0, limit);
}

// Build taste clusters by finding co-occurrence communities among liked/favorited posts
export function getUserTasteClusters(maxClusters = 4, precomputedInterests = null) {
  const postsPool = [...state.likes, ...state.favorites];
  if (postsPool.length < 3) return [];

  const userInterests = precomputedInterests || getUserInterestTags();
  if (userInterests.length === 0) return [];
  const interestMap = new Map(userInterests.map(i => [i.tag, i.score]));
  const excludedSet = new Set((state.settings?.excludedInterestTags || []).map(t => String(t).toLowerCase().trim()));

  const coCounts = new Map();
  const tagPostCounts = new Map();

  for (const post of postsPool) {
    if (!post) continue;
    const td = post.tagDetails || {};
    const artists = (td.artist || (post.author ? [post.author] : []))
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const characters = (td.character || [])
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const copyrights = (td.copyright || [])
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const generals = (td.general || (Array.isArray(post.tags) ? post.tags : []))
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && !GENERIC_DISLIKE_PROTECTED_TAGS.has(t) && interestMap.has(t))
      .slice(0, 4);

    const postTags = Array.from(new Set([...artists, ...characters, ...copyrights, ...generals]));
    for (const t of postTags) {
      tagPostCounts.set(t, (tagPostCounts.get(t) || 0) + 1);
    }

    for (let i = 0; i < postTags.length; i++) {
      for (let j = i + 1; j < postTags.length; j++) {
        const pairKey = [postTags[i], postTags[j]].sort().join('|');
        coCounts.set(pairKey, (coCounts.get(pairKey) || 0) + 1);
      }
    }
  }

  const candidateHubs = userInterests.filter(i =>
    (i.category === 'character' || i.category === 'copyright' || i.category === 'artist') &&
    (tagPostCounts.get(i.tag) || 0) >= 2
  );

  const assignedTags = new Set();
  const clusters = [];

  for (const hub of candidateHubs) {
    if (clusters.length >= maxClusters) break;
    if (assignedTags.has(hub.tag)) continue;

    const clusterTags = [hub.tag];
    assignedTags.add(hub.tag);

    for (const [tag] of interestMap.entries()) {
      if (assignedTags.has(tag)) continue;
      const pairKey = [hub.tag, tag].sort().join('|');
      const coVal = coCounts.get(pairKey) || 0;
      if (coVal >= 2) {
        clusterTags.push(tag);
        assignedTags.add(tag);
      }
    }

    if (clusterTags.length >= 2) {
      let label = hub.tag.replace(/_/g, ' ');
      if (hub.category === 'artist') label = `@${label}`;
      else if (hub.category === 'character') label = label.split('(')[0].trim();

      clusters.push({
        id: `cluster_${clusters.length + 1}`,
        label,
        hubTag: hub.tag,
        hubCategory: hub.category,
        tags: clusterTags,
        score: hub.score
      });
    }
  }

  return clusters;
}

// Smart Multi-Tier Seed Generation with Page Rotation, Cluster Cohesion and Exploration
export function getRecommendationSeeds({ limit = 5, page = 1, focusMode = 'all' } = {}) {
  const userInterests = getUserInterestTags(40, { focusMode });
  if (userInterests.length === 0) return [];

  const seedPairs = getUserInterestSeedPairs(20, userInterests);
  const selectedSeeds = [];

  if (focusMode === 'artists') {
    const artistInterests = userInterests.filter(i => i.category === 'artist' || i.score >= 5.0);
    if (artistInterests.length > 0) {
      const offset = ((page - 1) * 3) % artistInterests.length;
      for (let i = 0; i < Math.min(limit, artistInterests.length); i++) {
        selectedSeeds.push(artistInterests[(offset + i) % artistInterests.length].tag);
      }
    }
  } else if (focusMode === 'characters') {
    const charInterests = userInterests.filter(i => i.category === 'character' || i.category === 'copyright');
    if (charInterests.length > 0) {
      const offset = ((page - 1) * 3) % charInterests.length;
      for (let i = 0; i < Math.min(limit, charInterests.length); i++) {
        selectedSeeds.push(charInterests[(offset + i) % charInterests.length].tag);
      }
    }
  } else if (focusMode === 'discovery') {
    // Discovery mode: mix top pair with second-tier interests and broad seeds
    if (seedPairs.length > 0) {
      const pairIdx = (page - 1) % seedPairs.length;
      selectedSeeds.push(seedPairs[pairIdx]);
    }
    const midInterests = userInterests.slice(5, 30);
    if (midInterests.length > 0) {
      const shuffled = [...midInterests].sort(() => Math.random() - 0.5);
      for (const item of shuffled) {
        if (selectedSeeds.length >= limit) break;
        if (!selectedSeeds.includes(item.tag)) selectedSeeds.push(item.tag);
      }
    }
  } else {
    // Balanced "all" mode: Use taste clusters to keep seed pairs thematically coherent
    const clusters = getUserTasteClusters(4, userInterests);
    if (clusters.length > 0) {
      const activeCluster = clusters[(page - 1) % clusters.length];
      if (activeCluster && activeCluster.tags.length >= 2) {
        selectedSeeds.push(`${activeCluster.tags[0]} ${activeCluster.tags[1]}`);
        if (activeCluster.tags.length >= 3) {
          selectedSeeds.push(activeCluster.tags[2]);
        }
      }
    }

    if (selectedSeeds.length < limit && seedPairs.length > 0) {
      const pairOffset = ((page - 1) * 2) % seedPairs.length;
      const p1 = seedPairs[pairOffset];
      if (!selectedSeeds.includes(p1)) selectedSeeds.push(p1);
      if (seedPairs.length > 1 && selectedSeeds.length < limit) {
        const p2 = seedPairs[(pairOffset + 1) % seedPairs.length];
        if (!selectedSeeds.includes(p2)) selectedSeeds.push(p2);
      }
    }

    const singleOffset = ((page - 1) * 3) % Math.min(userInterests.length, 25);
    for (let i = 0; i < userInterests.length; i++) {
      if (selectedSeeds.length >= limit) break;
      const candidate = userInterests[(singleOffset + i) % userInterests.length];
      if (!selectedSeeds.includes(candidate.tag) && !selectedSeeds.some(s => s.includes(candidate.tag))) {
        selectedSeeds.push(candidate.tag);
      }
    }
  }

  return selectedSeeds;
}

const IGNORED_INTEREST_TAGS = new Set([
  'fanbox', 'patreon', 'fantia', 'boosty', 'subscribestar', 'gumroad', 'afdian', 'discord', 'pawchive', 'kemono', 'dlsite',
  'rule34video', 'danbooru', 'gelbooru', 'safebooru', 'yande.re', 'konachan', 'rule34', 'xbooru', 'hypnohub', 'tbib',
  'highres', 'absurdres', 'superabsurdres', 'translation_request', 'translated',
  'tagme', 'bad_id', 'duplicate', 'watermark', 'sample', 'thumbnail', 'reward', 'psd', 'clip', 'zip', 'rar'
]);

function cleanTagString(str) {
  if (!str) return '';
  const clean = String(str).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/^(?:artist|creator|author|service|meta):/i, '').replace(/\s+/g, '_').trim();
  if (IGNORED_INTEREST_TAGS.has(clean) || /^user_\d+$/i.test(clean) || clean.startsWith('service_') || clean.startsWith('service:')) {
    return '';
  }
  return clean;
}

export function excludeInterestTag(tag) {
  if (!tag) return;
  const clean = cleanTagString(tag);
  if (!clean) return;
  if (!state.settings) state.settings = {};
  if (!Array.isArray(state.settings.excludedInterestTags)) {
    state.settings.excludedInterestTags = [];
  }
  if (!state.settings.excludedInterestTags.includes(clean)) {
    state.settings.excludedInterestTags.push(clean);
    state.excludedInterestTags = [...state.settings.excludedInterestTags];
    saveLocalSettings({ excludedInterestTags: state.settings.excludedInterestTags });
    invalidateInterestCache();
  }
}

export function restoreInterestTag(tag) {
  if (!tag) return;
  const clean = cleanTagString(tag);
  if (!state.settings || !Array.isArray(state.settings.excludedInterestTags)) return;
  state.settings.excludedInterestTags = state.settings.excludedInterestTags.filter(t => t !== clean);
  state.excludedInterestTags = [...state.settings.excludedInterestTags];
  saveLocalSettings({ excludedInterestTags: state.settings.excludedInterestTags });
  invalidateInterestCache();
}

export function resetExcludedInterestTags() {
  if (!state.settings) state.settings = {};
  state.settings.excludedInterestTags = [];
  state.excludedInterestTags = [];
  saveLocalSettings({ excludedInterestTags: [] });
}

function extractTagsFromPost(post, counts, weights, catMap, multiplier = 1.0, isDislike = false) {
  if (!post) return;

  const addTag = (rawTag, category, baseWeight) => {
    if (!rawTag) return;
    const clean = cleanTagString(String(rawTag).split(',')[0]);
    if (!clean) return;

    // Apply generic tag protection for dislikes to avoid killing common composition tags
    let effMult = multiplier;
    if (isDislike && GENERIC_DISLIKE_PROTECTED_TAGS.has(clean)) {
      effMult = multiplier * 0.10;
    }

    counts.set(clean, (counts.get(clean) || 0) + effMult);

    const currentWeight = weights.get(clean) || 0;
    if (baseWeight > currentWeight) {
      weights.set(clean, baseWeight);
      catMap.set(clean, category);
    }
  };

  // Authors (weight 5.0)
  if (post.author) {
    addTag(post.author, 'artist', 5.0);
  }

  const td = post.tagDetails || {};
  if (td.artist) {
    for (const a of td.artist) addTag(a, 'artist', 5.0);
  }
  if (td.character) {
    for (const c of td.character) addTag(c, 'character', 3.5);
  }
  if (td.copyright) {
    for (const cp of td.copyright) addTag(cp, 'copyright', 3.0);
  }
  if (td.general) {
    for (const g of td.general) addTag(g, 'general', 1.2);
  } else if (Array.isArray(post.tags)) {
    for (const t of post.tags) addTag(t, 'general', 1.0);
  }
}

// Compute a post's relevance percentage and rich matched tags breakdown with explanation
export function calculatePostMatchPercent(post, userInterestMap, options = {}) {
  if (!post || !userInterestMap || userInterestMap.size === 0) {
    return {
      percent: 0,
      matchedTags: [],
      matchedDetails: [],
      matchExplanation: '',
      valueOf() { return 0; },
      toString() { return '0'; }
    };
  }

  let matchPoints = 0;
  const matchedTags = [];
  const addedSet = new Set();

  const aliasMap = state.authorAliases || {};
  const checkTag = (tag, weightMultiplier = 1.0, displayPrefix = '', category = 'general') => {
    if (!tag) return;
    const clean = cleanTagString(tag);
    if (!clean) return;

    let score = userInterestMap.get(clean) || 0;
    if (score === 0 && category === 'artist') {
      const knownAliases = aliasMap[clean] || aliasMap[clean.replace(/[\s_.-]+/g, '')];
      if (Array.isArray(knownAliases)) {
        for (const al of knownAliases) {
          const cleanAl = cleanTagString(al);
          if (userInterestMap.has(cleanAl)) {
            score = userInterestMap.get(cleanAl) || 1;
            break;
          }
        }
      }
    }

    if (score > 0) {
      matchPoints += score * weightMultiplier;
      if (!addedSet.has(clean)) {
        addedSet.add(clean);
        matchedTags.push({
          tag: clean,
          display: displayPrefix ? `${displayPrefix}${clean}` : clean,
          category,
          score
        });
      }
    }
  };

  if (post.author) checkTag(post.author, 4.5, '@', 'artist');
  if (post.tagDetails) {
    if (Array.isArray(post.tagDetails.artist)) post.tagDetails.artist.forEach(a => checkTag(a, 4.5, '@', 'artist'));
    if (Array.isArray(post.tagDetails.character)) post.tagDetails.character.forEach(c => checkTag(c, 3.5, '', 'character'));
    if (Array.isArray(post.tagDetails.copyright)) post.tagDetails.copyright.forEach(cp => checkTag(cp, 2.8, '', 'copyright'));
    if (Array.isArray(post.tagDetails.general)) post.tagDetails.general.forEach(g => checkTag(g, 1.0, '', 'general'));
  } else if (Array.isArray(post.tags)) {
    for (const t of post.tags) checkTag(t, 1.0, '', 'general');
  }

  if (matchPoints === 0) {
    return {
      percent: 0,
      matchedTags: [],
      matchedDetails: [],
      matchExplanation: '',
      valueOf() { return 0; },
      toString() { return '0'; }
    };
  }

  // Sort matched tags by significance
  matchedTags.sort((a, b) => b.score - a.score);

  const hasArtist = matchedTags.some(m => m.category === 'artist');
  const hasChar = matchedTags.some(m => m.category === 'character');
  const isKeyMatch = hasArtist || hasChar;

  const ratio = matchPoints / (matchPoints + (isKeyMatch ? 7 : 14));
  let percent = Math.min(99, Math.max(55, Math.round((isKeyMatch ? 72 : 55) + ratio * (isKeyMatch ? 27 : 38))));

  // Format preference adjustment (video / aspect ratio)
  if (options && options.mediaPrefs) {
    if (post.isVideo && options.mediaPrefs.videoAffinity > 0.3) {
      percent = Math.min(99, percent + Math.round(options.mediaPrefs.videoAffinity * 6));
    }
    if (options.mediaPrefs.prefersPortrait && post.width && post.height && post.height > post.width * 1.15) {
      percent = Math.min(99, percent + 3);
    }
  }

  // Build human-friendly explanation
  const displayTags = matchedTags.map(m => m.display).slice(0, 4);
  const matchExplanation = displayTags.join(', ');

  return {
    percent,
    matchedTags: displayTags,
    matchedDetails: matchedTags,
    matchExplanation,
    valueOf() { return this.percent; },
    toString() { return String(this.percent); }
  };
}

// Build multi-tier search queries for "More Like This" to avoid 0-result AND queries
export function getSimilarPostPlan(post) {
  if (!post) return { queries: [], label: '' };

  const site = post.site || state.currentSite;
  const isCreatorCentric = (site === 'pawchive' || site === 'kemono');

  const td = post.tagDetails || {};
  const artists = (td.artist || (post.author ? [post.author] : []))
    .map(cleanTagString).filter(Boolean);
  const characters = (td.character || [])
    .map(cleanTagString).filter(Boolean);
  const copyrights = (td.copyright || [])
    .map(cleanTagString).filter(Boolean);
  const generals = (td.general || (Array.isArray(post.tags) ? post.tags : []))
    .map(cleanTagString).filter(t => t && !GENERIC_DISLIKE_PROTECTED_TAGS.has(t));

  if (isCreatorCentric) {
    const author = artists[0] || post.author || '';
    if (author) {
      return {
        queries: [`artist:${author}`, author],
        label: `@${author}`,
        sourcePost: post
      };
    }
    return {
      queries: characters.slice(0, 2).concat(generals.slice(0, 2)),
      label: characters[0] || generals[0] || '',
      sourcePost: post
    };
  }

  const queries = [];

  // Tier 1: Character + Artist (ideal match)
  if (characters.length > 0 && artists.length > 0) {
    queries.push(`${characters[0]} ${artists[0]}`);
  }
  // Tier 2: Character + Copyright (franchise match)
  if (characters.length > 0 && copyrights.length > 0) {
    queries.push(`${characters[0]} ${copyrights[0]}`);
  }
  // Tier 3: Pure Character (broader content match)
  if (characters.length > 0) {
    queries.push(characters[0]);
    if (characters.length > 1) {
      queries.push(characters[1]);
    }
  }
  // Tier 4: Pure Artist (artist style match)
  if (artists.length > 0) {
    queries.push(artists[0]);
  }
  // Tier 5: Copyright / Franchise
  if (copyrights.length > 0 && queries.length < 4) {
    queries.push(copyrights[0]);
  }
  // Tier 6: Specific characteristic general tags (visual aesthetic)
  for (const g of generals) {
    if (queries.length >= 8) break;
    if (!queries.includes(g)) queries.push(g);
  }

  // Fallback: If queries are sparse, add raw post tags
  const rawTags = (Array.isArray(post.tags) ? post.tags : []).map(cleanTagString).filter(Boolean);
  if (queries.length < 2 && rawTags.length > 0) {
    if (rawTags.length >= 2) {
      queries.push(`${rawTags[0]} ${rawTags[1]}`);
    }
    for (const rt of rawTags.slice(0, 6)) {
      if (!queries.includes(rt)) queries.push(rt);
    }
  }

  // Deduplicate queries
  const uniqueQueries = Array.from(new Set(queries.map(q => q.trim()).filter(Boolean)));
  const label = (characters[0] && artists[0])
    ? `${characters[0]} (@${artists[0]})`
    : (characters[0] || (artists[0] ? `@${artists[0]}` : (copyrights[0] || generals[0] || '')));

  return {
    queries: uniqueQueries,
    label,
    sourcePost: post
  };
}

// Compute visual and semantic similarity score (0..100) between candidate and source post
export function calculatePostSimilarityScore(candidate, sourcePost) {
  if (!candidate || !sourcePost || candidate.id === sourcePost.id) return 0;

  const srcTd = sourcePost.tagDetails || {};
  const candTd = candidate.tagDetails || {};

  const srcArtists = new Set((srcTd.artist || (sourcePost.author ? [sourcePost.author] : [])).map(cleanTagString).filter(Boolean));
  const candArtists = new Set((candTd.artist || (candidate.author ? [candidate.author] : [])).map(cleanTagString).filter(Boolean));

  const srcChars = new Set((srcTd.character || []).map(cleanTagString).filter(Boolean));
  const candChars = new Set((candTd.character || []).map(cleanTagString).filter(Boolean));

  const srcCopy = new Set((srcTd.copyright || []).map(cleanTagString).filter(Boolean));
  const candCopy = new Set((candTd.copyright || []).map(cleanTagString).filter(Boolean));

  const srcGeneral = new Set((srcTd.general || (Array.isArray(sourcePost.tags) ? sourcePost.tags : [])).map(cleanTagString).filter(t => t && !GENERIC_DISLIKE_PROTECTED_TAGS.has(t)));
  const candGeneral = new Set((candTd.general || (Array.isArray(candidate.tags) ? candidate.tags : [])).map(cleanTagString).filter(t => t && !GENERIC_DISLIKE_PROTECTED_TAGS.has(t)));

  let score = 0;

  // 1. Author match (huge artistic style signal: +35 points)
  let authorMatched = false;
  for (const a of srcArtists) {
    if (candArtists.has(a)) {
      score += 35;
      authorMatched = true;
      break;
    }
  }

  // 2. Character match (strong content signal: +30 points each, up to 45)
  let charMatchCount = 0;
  for (const c of srcChars) {
    if (candChars.has(c)) {
      charMatchCount++;
      score += 30;
      if (charMatchCount >= 2) break;
    }
  }

  // 3. Franchise / Copyright match (+15 points)
  for (const cp of srcCopy) {
    if (candCopy.has(cp)) {
      score += 15;
      break;
    }
  }

  // 4. Jaccard similarity of specific descriptive tags (up to +25 points)
  if (srcGeneral.size > 0 && candGeneral.size > 0) {
    let intersection = 0;
    for (const g of candGeneral) {
      if (srcGeneral.has(g)) intersection++;
    }
    const union = srcGeneral.size + candGeneral.size - intersection;
    if (union > 0) {
      const jaccard = intersection / union;
      score += Math.round(jaccard * 25);
    }
  }

  // 5. Media format consistency bonus (video with video, image with image: +5 points)
  if (Boolean(candidate.isVideo) === Boolean(sourcePost.isVideo)) {
    score += 5;
  }

  // Cap score between 0 and 99
  return Math.min(99, Math.max(0, Math.round(score)));
}

// Backward compatibility alias
export function getSimilarPostQuery(post) {
  const plan = getSimilarPostPlan(post);
  return plan.queries[0] || '';
}

// Media-format preference cache; collection mutators in state.js invalidate it
// through this hook instead of touching the cache variables directly.
export function invalidateMediaPrefsCache() {
  _mediaPrefsCache = null;
  _mediaPrefsCacheKey = '';
}
