import { showToast, copyToClipboard, haptic, getPostSiteUrl } from '../modules/uiUtils.js';
import { t } from '../i18n.js';

export function formatRating(r) {
  const raw = String(r || '').toLowerCase();
  const map = {
    'g': t('vsb.ratingSafe', 'Safe (Безопасный 0+)'),
    'general': t('vsb.ratingSafe', 'Safe (Безопасный 0+)'),
    'safe': t('vsb.ratingSafe', 'Safe (Безопасный 0+)'),
    's': t('vsb.ratingSensitive', 'Sensitive (Пикантный 16+)'),
    'sensitive': t('vsb.ratingSensitive', 'Sensitive (Пикантный 16+)'),
    'q': t('vsb.ratingQuestionable', 'Questionable (Эротика 16+)'),
    'questionable': t('vsb.ratingQuestionable', 'Questionable (Эротика 16+)'),
    'e': t('vsb.ratingExplicit', 'Explicit (Для взрослых 18+)'),
    'explicit': t('vsb.ratingExplicit', 'Explicit (Для взрослых 18+)')
  };
  return map[raw] || t('vsb.ratingSafe', 'Safe (Безопасный 0+)');
}

export const CATEGORY_ORDER = ['artist', 'assistant', 'copyright', 'character', 'general', 'meta'];

export function getCategoryLabel(catKey) {
  const map = {
    artist: t('vsb.groupArtist', 'Художник'),
    assistant: t('vsb.groupAssistant', 'Помощник / Озвучка'),
    copyright: t('vsb.groupSeries', 'Серия / Франшиза'),
    character: t('vsb.groupCharacter', 'Персонаж'),
    general: t('vsb.groupGeneral', 'Общие теги'),
    meta: t('vsb.groupMeta', 'Мета-теги')
  };
  return map[catKey] || catKey;
}

export const CATEGORY_CONFIG = {
  artist: {
    key: 'artist',
    get label() { return getCategoryLabel('artist'); },
    colorClass: 'category-artist',
    tagClass: 'tag-artist'
  },
  assistant: {
    key: 'assistant',
    get label() { return getCategoryLabel('assistant'); },
    colorClass: 'category-assistant',
    tagClass: 'tag-assistant'
  },
  copyright: {
    key: 'copyright',
    get label() { return getCategoryLabel('copyright'); },
    colorClass: 'category-copyright',
    tagClass: 'tag-copyright'
  },
  character: {
    key: 'character',
    get label() { return getCategoryLabel('character'); },
    colorClass: 'category-character',
    tagClass: 'tag-character'
  },
  general: {
    key: 'general',
    get label() { return getCategoryLabel('general'); },
    colorClass: 'category-general',
    tagClass: 'tag-general'
  },
  meta: {
    key: 'meta',
    get label() { return getCategoryLabel('meta'); },
    colorClass: 'category-meta',
    tagClass: 'tag-meta'
  }
};

const META_KEYWORDS = new Set([
  'highres', 'high_res', 'absurdres', 'superabsurdres', 'incredibly_absurdres', 'huge_filesize', 'large_filesize', 'bad_id',
  'bad_link', 'bad_pixiv_id', 'bad_twitter_id', 'duplicate', 'source_request', 'source_needed', 'tagme',
  'check_commentary', 'check_my_note', 'lossless', 'third-party_edit', 'watermark', 'sample', 'thumbnail',
  'patreon_reward', 'patreon_logo', 'fantia', 'fanbox', 'skeb', 'lowres', 'low_res', 'downscaled',
  'text', 'signature', 'username', 'artist_name', 'character_name', 'official_art', 'scan', 'wallpaper', 'cover', 'sound',
  'audio', 'video', 'animated', 'animation', 'ugoira', 'web_address', 'commission',
  'translated', 'translation_request', 'commentary', 'commentary_request', 'partial_commentary',
  'typeset', 'annotated', 'translated_subtitles', 'subtitled', 'voiced', 'no_sound',
  'spoiler', 'epilepsy_warning', 'dated', 'resized', 'pixel_art', 'vector', 'transparent_background',
  'white_background', 'simple_background', 'monochrome', 'greyscale', 'comic', 'manga', '4k', 'hd', '60fps', 'bad_aspect_ratio'
]);

const NON_CHARACTER_PAREN_SUFFIXES = new Set([
  'artist', 'creator', 'circle', 'studio', 'animator', 'mangaka', 'illustrator', 'doujin_circle', 'cosplayer',
  'series', 'game', 'anime', 'manga', 'vtuber', 'novel', 'comic', 'franchise', 'project', 'visual_novel', 'light_novel', 'web_novel', 'mobile_game', 'company', 'label', 'universe',
  'medium', 'style', 'artwork', 'parody', 'group',
  'fruit', 'food', 'animal', 'vehicle', 'object', 'clothing', 'instrument', 'weapon', 'anatomy', 'pose', 'hair', 'eyes', 'color', 'background', 'furniture', 'disambiguation',
  'voice_actor', 'voice actor', 'voice', 'va', 'audio', 'sound', 'music', 'sfx', 'assistant', 'translator', 'typesetter', 'colorist'
]);

const ASSISTANT_ROLE_REGEX = /_?\((audio|sfx|sound|voice|va|music|voice[_\s]actor|translator|typesetter|colorist|assistant)\)$/i;

export function getTagCategory(tag, tagDetails, author = '', assistants = []) {
  if (!tag) return 'general';
  const clean = String(tag).toLowerCase().trim();
  const rawClean = clean.replace(/^(artist|character|copyright|meta):/i, '').replace(/_?\((artist|creator|circle|studio|character|cosplay|person|series|game|anime|manga|vtuber|novel|comic|franchise|project)\)$/i, '');

  // 1. Authoritative booru tag categories from database
  if (tagDetails) {
    if (tagDetails.character && (tagDetails.character.includes(clean) || tagDetails.character.includes(rawClean))) return 'character';
    if (tagDetails.copyright && (tagDetails.copyright.includes(clean) || tagDetails.copyright.includes(rawClean))) return 'copyright';
    if (tagDetails.meta && (tagDetails.meta.includes(clean) || tagDetails.meta.includes(rawClean))) return 'meta';
    if (tagDetails.assistant && (tagDetails.assistant.includes(clean) || tagDetails.assistant.includes(rawClean))) return 'assistant';
    if (tagDetails.artist && (tagDetails.artist.includes(clean) || tagDetails.artist.includes(rawClean))) {
      return ASSISTANT_ROLE_REGEX.test(clean) ? 'assistant' : 'artist';
    }
    if (tagDetails.general && (tagDetails.general.includes(clean) || tagDetails.general.includes(rawClean))) return 'general';
  }

  // 2. Explicit assistant / voice actor role annotations
  if (ASSISTANT_ROLE_REGEX.test(clean) || ASSISTANT_ROLE_REGEX.test(rawClean)) {
    return 'assistant';
  }

  // 3. Known assistants exact match
  if (Array.isArray(assistants) && assistants.length > 0) {
    const isExactAssistant = assistants.some(a => {
      const cleanA = String(a).toLowerCase().trim().replace(/^[@pixiv:]+/, '').replace(/\s+/g, '_');
      const cleanABase = cleanA.replace(/_\([^)]+\)$/, '');
      const cleanBase = clean.replace(/_\([^)]+\)$/, '');
      return clean === cleanA || cleanBase === cleanABase;
    });
    if (isExactAssistant && (ASSISTANT_ROLE_REGEX.test(clean) || ASSISTANT_ROLE_REGEX.test(rawClean))) {
      return 'assistant';
    }
  }

  // 4. Fallback matching against author (exact match only, never substring)
  if (author) {
    const authorClean = String(author).toLowerCase().replace(/^[@pixiv:]+/, '').trim().replace(/\s+/g, '_');
    const authorBase = authorClean.replace(/_\([^)]+\)$/, '');
    const cleanBase = clean.replace(/_\([^)]+\)$/, '');
    if (clean === authorClean || cleanBase === authorBase) {
      return 'artist';
    }
  }

  // 5. Conventional booru prefixes/suffixes
  if (clean.startsWith('character:') || clean.endsWith('_(character)') || clean.endsWith('_(cosplay)') || clean.endsWith('_(person)')) {
    return 'character';
  }

  if (clean.startsWith('copyright:') || clean.endsWith('_(series)') || clean.endsWith('_(game)') || 
      clean.endsWith('_(anime)') || clean.endsWith('_(manga)') || clean.endsWith('_(vtuber)') || 
      clean.endsWith('_(novel)') || clean.endsWith('_(comic)') || clean.endsWith('_(franchise)') || clean.endsWith('_(project)')) {
    return 'copyright';
  }

  if (clean.startsWith('artist:') || clean.startsWith('channel:') || clean.startsWith('uploader:') || 
      clean.endsWith('_(artist)') || clean.endsWith('_(creator)') || clean.startsWith('by_') || 
      clean.endsWith('_(circle)') || clean.endsWith('_(studio)')) {
    return 'artist';
  }

  if (clean.startsWith('meta:') || clean.startsWith('service:') || /^user_\d+$/i.test(clean) || META_KEYWORDS.has(clean) || clean.endsWith('_(medium)') || clean.endsWith('_(style)')) {
    return 'meta';
  }

  // 6. Universal Booru character detection: name_(series) where series is not in NON_CHARACTER_PAREN_SUFFIXES
  const parenMatch = clean.match(/^(.+)_\(([^)]+)\)$/);
  if (parenMatch) {
    const suffix = parenMatch[2].toLowerCase().trim();
    if (!NON_CHARACTER_PAREN_SUFFIXES.has(suffix)) {
      return 'character';
    }
  }

  return 'general';
}

export function getTagCategoryClass(tag, details) {
  const cat = getTagCategory(tag, details);
  return `tag-${cat}`;
}

export function renderSidebarTags(post, { onTagSelect, closeViewer }) {
  const tagsCloud = document.getElementById('viewerTagsCloud');
  const tagsCountTotal = document.getElementById('tagsCountTotal');
  const viewerTagsBadgeCount = document.getElementById('viewerTagsBadgeCount');
  if (!tagsCloud) return;

  tagsCloud.innerHTML = '';
  const rawTags = Array.isArray(post?.tags) ? post.tags : [];
  const validTags = rawTags.filter(t => typeof t === 'string' && t.trim().length > 0);

  if (tagsCountTotal) tagsCountTotal.textContent = String(validTags.length);
  if (viewerTagsBadgeCount) viewerTagsBadgeCount.textContent = String(validTags.length);

  if (validTags.length === 0) {
    tagsCloud.innerHTML = `<span class="empty-tags-hint">${t('vsb.noTags', 'Теги отсутствуют')}</span>`;
    return;
  }

  // Group tags into 6 categories in the given order
  const groups = {
    artist: [],
    assistant: [],
    copyright: [],
    character: [],
    general: [],
    meta: []
  };

  const seenTags = new Set();
  validTags.forEach(tag => {
    const cleanLower = tag.toLowerCase().trim();
    if (seenTags.has(cleanLower)) return;
    seenTags.add(cleanLower);

    const category = getTagCategory(tag, post?.tagDetails, post?.author, post?.assistants);
    if (groups[category]) {
      groups[category].push(tag);
    } else {
      groups.general.push(tag);
    }
  });

  // Sort groups.artist so the primary author always appears at index 0
  if (post?.author && groups.artist.length > 1) {
    const authorClean = post.author.toLowerCase().replace(/^[@pixiv:]+/, '').trim().replace(/\s+/g, '_');
    groups.artist.sort((a, b) => {
      const aMatch = a.toLowerCase().includes(authorClean);
      const bMatch = b.toLowerCase().includes(authorClean);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }

  const container = document.createElement('div');
  container.className = 'viewer-tags-container';

  CATEGORY_ORDER.forEach(catKey => {
    const tagList = groups[catKey];
    if (!tagList || tagList.length === 0) return;

    const config = CATEGORY_CONFIG[catKey];
    const groupEl = document.createElement('div');
    groupEl.className = `viewer-tag-group group-${catKey}`;

    // Category header (Artist, Copyright, Character, General, Meta)
    const headerEl = document.createElement('div');
    headerEl.className = 'viewer-tag-group-header';
    headerEl.innerHTML = `
      <div class="viewer-tag-group-title ${config.colorClass}">
        <span>${config.label}</span>
      </div>
      <span class="viewer-tag-group-count">${tagList.length}</span>
    `;
    groupEl.appendChild(headerEl);

    // Category tag list
    const listEl = document.createElement('div');
    listEl.className = 'viewer-tag-group-list';

    tagList.forEach(tag => {
      const rowEl = document.createElement('div');
      rowEl.className = `viewer-tag-row ${config.colorClass}`;

      // 1. Tag link/name (search in the gallery)
      const tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.className = `viewer-tag-link ${config.colorClass}`;
      tagBtn.title = t('vsb.searchTagTitle', 'Искать по тегу: {tag}').replace('{tag}', tag);
      tagBtn.innerHTML = `<span class="viewer-tag-text">${tag.replace(/_/g, ' ')}</span>`;

      tagBtn.addEventListener('click', (e) => {
        e.preventDefault();
        haptic(10);
        if (closeViewer) closeViewer();
        if (onTagSelect) onTagSelect(tag);
      });

      // 2. Tag copy button on the right
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'viewer-tag-copy';
      copyBtn.title = t('vsb.copyTagTitle', 'Скопировать тег "{tag}"').replace('{tag}', tag);
      copyBtn.setAttribute('aria-label', t('vsb.copyTagAria', 'Скопировать тег {tag}').replace('{tag}', tag));
      copyBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;

      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        haptic(15);
        const copied = await copyToClipboard(tag);
        if (copied) {
          showToast(t('vsb.tagCopied', 'Тег скопирован: {tag}').replace('{tag}', tag.replace(/_/g, ' ')));
        }
      });

      rowEl.appendChild(tagBtn);
      rowEl.appendChild(copyBtn);
      listEl.appendChild(rowEl);
    });

    groupEl.appendChild(listEl);
    container.appendChild(groupEl);
  });

  tagsCloud.appendChild(container);
}

/**
 * Renders technical and metadata rows in the viewer sidebar:
 * duration, creation date, source site link, rating, score/views, and AI classification.
 * @param {Object} currentPost
 */
export function renderSidebarInfo(currentPost) {
  if (!currentPost) return;

  const infoDurationRow = document.getElementById('infoDurationRow');
  const infoDuration = document.getElementById('infoDuration');
  if (currentPost.isVideo && (currentPost.durationText || currentPost.duration > 0)) {
    const durText = currentPost.durationText || `${Math.floor(currentPost.duration / 60)}:${Math.floor(currentPost.duration % 60) < 10 ? '0' : ''}${Math.floor(currentPost.duration % 60)}`;
    if (infoDuration) infoDuration.textContent = durText;
    if (infoDurationRow) infoDurationRow.style.display = 'flex';
  } else {
    if (infoDurationRow) infoDurationRow.style.display = 'none';
  }

  const infoDateRow = document.getElementById('infoDateRow');
  const infoDate = document.getElementById('infoDate');
  if (infoDateRow && infoDate) {
    if (currentPost.createdAt) {
      try {
        const d = new Date(currentPost.createdAt);
        if (!isNaN(d.getTime())) {
          infoDate.textContent = d.toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          infoDateRow.style.display = 'flex';
        } else {
          infoDateRow.style.display = 'none';
        }
      } catch {
        infoDateRow.style.display = 'none';
      }
    } else {
      infoDateRow.style.display = 'none';
    }
  }

  const infoSite = document.getElementById('infoSite');
  if (infoSite) {
    const siteName = currentPost.siteName || currentPost.site;
    const postPageUrl = getPostSiteUrl(currentPost);
    if (postPageUrl) {
      infoSite.innerHTML = `<a href="${postPageUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="${t('vw.openOnSite', 'Открыть страницу на сайте {name}').replace('{name}', siteName)}">${siteName} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
    } else {
      infoSite.textContent = siteName;
    }
  }

  const infoRating = document.getElementById('infoRating');
  if (infoRating) infoRating.textContent = formatRating(currentPost.rating);

  const infoScore = document.getElementById('infoScore');
  if (infoScore) {
    let scoreText = `★ ${currentPost.score || 0}`;
    if (currentPost.views > 0 || currentPost.viewsText) {
      scoreText += ` · ${t('vw.viewsShort', '{n} просм.').replace('{n}', currentPost.viewsText || currentPost.views)}`;
    } else if (currentPost.favCount > 0) {
      scoreText += ` · ${t('vw.favsShort', '{n} в избранном').replace('{n}', currentPost.favCount)}`;
    }
    infoScore.textContent = scoreText;
  }

  const infoAi = document.getElementById('infoAi');
  if (infoAi) {
    infoAi.textContent = currentPost.isAi ? t('vw.aiYes', 'Да (ИИ-арт)') : t('vw.aiNo', 'Нет (Авторский)');
    infoAi.style.color = currentPost.isAi ? 'var(--accent-warning)' : 'var(--text-primary)';
  }
}

