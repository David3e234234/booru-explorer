import { state } from '../state.js';
import { getTagCategory, CATEGORY_ORDER, CATEGORY_CONFIG } from '../viewer/viewerSidebar.js';
import { showToast, copyToClipboard, haptic } from './uiUtils.js';

export function renderSidebarPageTags({ onTagSelect }) {
  const sidebarTagsList = document.getElementById('sidebarTagsList');
  const sidebarTagsCount = document.getElementById('sidebarTagsCount');
  if (!sidebarTagsList) return;

  if (!state.posts || state.posts.length === 0) {
    sidebarTagsList.innerHTML = '<span class="empty-tags-hint">Теги отсутствуют</span>';
    if (sidebarTagsCount) sidebarTagsCount.textContent = '0';
    return;
  }

  const tagFrequency = {};
  const tagPostDetailsMap = {};

  state.posts.forEach(post => {
    const tags = Array.isArray(post.tags) ? post.tags : [];
    tags.forEach(t => {
      const clean = typeof t === 'string' ? t.toLowerCase().trim() : String(t || '').toLowerCase().trim();
      if (!clean) return;
      tagFrequency[clean] = (tagFrequency[clean] || 0) + 1;
      if (post.tagDetails && !tagPostDetailsMap[clean]) {
        tagPostDetailsMap[clean] = post.tagDetails;
      }
    });
  });

  const sortedTags = Object.entries(tagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  if (sidebarTagsCount) sidebarTagsCount.textContent = String(sortedTags.length);
  sidebarTagsList.innerHTML = '';

  if (sortedTags.length === 0) {
    sidebarTagsList.innerHTML = '<span class="empty-tags-hint">Теги отсутствуют</span>';
    return;
  }

  // Группируем теги по категориям: Artist -> Copyright -> Character -> General -> Meta
  const groups = {
    artist: [],
    copyright: [],
    character: [],
    general: [],
    meta: []
  };

  sortedTags.forEach(([tag, count]) => {
    const category = getTagCategory(tag, tagPostDetailsMap[tag]);
    if (groups[category]) {
      groups[category].push({ tag, count });
    } else {
      groups.general.push({ tag, count });
    }
  });

  const container = document.createElement('div');
  container.className = 'sidebar-tags-grouped-container';

  CATEGORY_ORDER.forEach(catKey => {
    const items = groups[catKey];
    if (!items || items.length === 0) return;

    const config = CATEGORY_CONFIG[catKey];
    const groupEl = document.createElement('div');
    groupEl.className = `sidebar-tag-group group-${catKey}`;

    const headerEl = document.createElement('div');
    headerEl.className = 'sidebar-tag-group-header';
    headerEl.innerHTML = `
      <span class="s-group-title ${config.colorClass}">${config.label}</span>
      <span class="s-group-count">${items.length}</span>
    `;
    groupEl.appendChild(headerEl);

    const listEl = document.createElement('div');
    listEl.className = 'sidebar-tag-group-list';

    items.forEach(({ tag, count }) => {
      const tagEl = document.createElement('div');
      tagEl.className = `sidebar-tag-item ${config.colorClass}`;
      tagEl.title = `Искать по тегу: ${tag} (${count})`;

      // Кнопка ? для быстрого копирования
      const wikiBtn = document.createElement('button');
      wikiBtn.type = 'button';
      wikiBtn.className = `s-tag-wiki ${config.colorClass}`;
      wikiBtn.textContent = '?';
      wikiBtn.title = `Скопировать тег: ${tag}`;
      wikiBtn.setAttribute('aria-label', `Скопировать ${tag}`);

      wikiBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        haptic(15);
        const copied = await copyToClipboard(tag);
        if (copied) {
          showToast(`Тег скопирован: ${tag.replace(/_/g, ' ')}`);
        }
      });

      // Название тега
      const nameEl = document.createElement('span');
      nameEl.className = `s-tag-name ${config.colorClass}`;
      nameEl.textContent = tag.replace(/_/g, ' ');

      // Счетчик
      const countEl = document.createElement('span');
      countEl.className = 's-tag-count';
      countEl.textContent = String(count);

      tagEl.appendChild(wikiBtn);
      tagEl.appendChild(nameEl);
      tagEl.appendChild(countEl);

      tagEl.addEventListener('click', () => {
        haptic(10);
        if (onTagSelect) onTagSelect(tag);
      });

      listEl.appendChild(tagEl);
    });

    groupEl.appendChild(listEl);
    container.appendChild(groupEl);
  });

  sidebarTagsList.appendChild(container);
}
