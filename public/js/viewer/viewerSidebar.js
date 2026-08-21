import { showToast, copyToClipboard, haptic } from '../modules/uiUtils.js';

export function formatRating(r) {
  const raw = String(r || '').toLowerCase();
  const map = {
    'g': 'Safe (Безопасный 0+)',
    'general': 'Safe (Безопасный 0+)',
    'safe': 'Safe (Безопасный 0+)',
    's': 'Sensitive (Пикантный 16+)',
    'sensitive': 'Sensitive (Пикантный 16+)',
    'q': 'Questionable (Эротика 16+)',
    'questionable': 'Questionable (Эротика 16+)',
    'e': 'Explicit (Для взрослых 18+)',
    'explicit': 'Explicit (Для взрослых 18+)'
  };
  return map[raw] || 'Safe (Безопасный 0+)';
}

export const CATEGORY_ORDER = ['artist', 'copyright', 'character', 'general', 'meta'];

export const CATEGORY_CONFIG = {
  artist: {
    key: 'artist',
    label: 'Artist',
    labelRu: 'Художник',
    colorClass: 'category-artist',
    tagClass: 'tag-artist'
  },
  copyright: {
    key: 'copyright',
    label: 'Copyright',
    labelRu: 'Серия / Франшиза',
    colorClass: 'category-copyright',
    tagClass: 'tag-copyright'
  },
  character: {
    key: 'character',
    label: 'Character',
    labelRu: 'Персонаж',
    colorClass: 'category-character',
    tagClass: 'tag-character'
  },
  general: {
    key: 'general',
    label: 'General',
    labelRu: 'Общие теги',
    colorClass: 'category-general',
    tagClass: 'tag-general'
  },
  meta: {
    key: 'meta',
    label: 'Meta',
    labelRu: 'Мета-теги',
    colorClass: 'category-meta',
    tagClass: 'tag-meta'
  }
};

const META_KEYWORDS = new Set([
  'highres', 'absurdres', 'superabsurdres', '4k', 'sound', 'audio', 'video', 'animated', 
  'ugoira', 'translated', 'translation_request', 'commentary', 'commentary_request', 
  'tagme', 'bad_id', 'bad_link', 'duplicate', 'source_request', 'check_my_note', 
  'lossless', 'third-party_edit', 'watermark', 'sample', 'thumbnail', 'patreon_reward', 
  'fantia', 'fanbox', 'skeb', 'lowres', 'downscaled', 'text', 'signature', 'username',
  'official_art', 'scan', 'wallpaper'
]);

export function getTagCategory(tag, tagDetails, author = '') {
  if (!tag) return 'general';
  const clean = String(tag).toLowerCase().trim();
  const rawClean = clean.replace(/^(artist|character|copyright|meta):/i, '').replace(/_?\((artist|creator|circle|studio|character|cosplay|person|series|game|anime|manga|vtuber|novel|comic|franchise|project)\)$/i, '');

  if (tagDetails) {
    if (tagDetails.artist && (tagDetails.artist.includes(clean) || tagDetails.artist.includes(rawClean))) return 'artist';
    if (tagDetails.copyright && (tagDetails.copyright.includes(clean) || tagDetails.copyright.includes(rawClean))) return 'copyright';
    if (tagDetails.character && (tagDetails.character.includes(clean) || tagDetails.character.includes(rawClean))) return 'character';
    if (tagDetails.meta && (tagDetails.meta.includes(clean) || tagDetails.meta.includes(rawClean))) return 'meta';
    if (tagDetails.general && (tagDetails.general.includes(clean) || tagDetails.general.includes(rawClean))) return 'general';
  }

  if (author) {
    const authorClean = String(author).toLowerCase().replace(/^[@pixiv:]+/, '').trim().replace(/\s+/g, '_');
    if (authorClean && (clean === authorClean || clean.includes(authorClean))) {
      return 'artist';
    }
  }

  if (clean.startsWith('artist:') || clean.startsWith('channel:') || clean.startsWith('uploader:') || 
      clean.endsWith('_(artist)') || clean.endsWith('_(creator)') || clean.startsWith('by_') || 
      clean.endsWith('_(circle)') || clean.endsWith('_(studio)')) {
    return 'artist';
  }

  if (clean.startsWith('character:') || clean.endsWith('_(character)') || clean.endsWith('_(cosplay)') || clean.endsWith('_(person)')) {
    return 'character';
  }

  if (clean.startsWith('copyright:') || clean.endsWith('_(series)') || clean.endsWith('_(game)') || 
      clean.endsWith('_(anime)') || clean.endsWith('_(manga)') || clean.endsWith('_(vtuber)') || 
      clean.endsWith('_(novel)') || clean.endsWith('_(comic)') || clean.endsWith('_(franchise)') || clean.endsWith('_(project)')) {
    return 'copyright';
  }

  if (clean.startsWith('meta:') || META_KEYWORDS.has(clean) || clean.endsWith('_(medium)') || clean.endsWith('_(style)')) {
    return 'meta';
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
    tagsCloud.innerHTML = '<span class="empty-tags-hint">Теги отсутствуют</span>';
    return;
  }

  // Группировка тегов по 5 категориям в заданном порядке
  const groups = {
    artist: [],
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

    const category = getTagCategory(tag, post?.tagDetails, post?.author);
    if (groups[category]) {
      groups[category].push(tag);
    } else {
      groups.general.push(tag);
    }
  });

  const container = document.createElement('div');
  container.className = 'viewer-tags-container';

  CATEGORY_ORDER.forEach(catKey => {
    const tagList = groups[catKey];
    if (!tagList || tagList.length === 0) return;

    const config = CATEGORY_CONFIG[catKey];
    const groupEl = document.createElement('div');
    groupEl.className = `viewer-tag-group group-${catKey}`;

    // Заголовок категории (Artist, Copyright, Character, General, Meta)
    const headerEl = document.createElement('div');
    headerEl.className = 'viewer-tag-group-header';
    headerEl.innerHTML = `
      <div class="viewer-tag-group-title ${config.colorClass}">
        <span>${config.label}</span>
      </div>
      <span class="viewer-tag-group-count">${tagList.length}</span>
    `;
    groupEl.appendChild(headerEl);

    // Список тегов категории
    const listEl = document.createElement('div');
    listEl.className = 'viewer-tag-group-list';

    tagList.forEach(tag => {
      const rowEl = document.createElement('div');
      rowEl.className = `viewer-tag-row ${config.colorClass}`;

      // 1. Ссылка/название тега (поиск в галерее)
      const tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.className = `viewer-tag-link ${config.colorClass}`;
      tagBtn.title = `Искать по тегу: ${tag}`;
      tagBtn.innerHTML = `<span class="viewer-tag-text">${tag.replace(/_/g, ' ')}</span>`;

      tagBtn.addEventListener('click', (e) => {
        e.preventDefault();
        haptic(10);
        if (closeViewer) closeViewer();
        if (onTagSelect) onTagSelect(tag);
      });

      // 2. Кнопка копирования тега справа
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'viewer-tag-copy';
      copyBtn.title = `Скопировать тег "${tag}"`;
      copyBtn.setAttribute('aria-label', `Скопировать тег ${tag}`);
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
          showToast(`Тег скопирован: ${tag.replace(/_/g, ' ')}`);
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
