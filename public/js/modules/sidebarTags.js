import { state } from '../state.js';
import { getTagCategory, CATEGORY_ORDER, CATEGORY_CONFIG } from '../viewer/viewerSidebar.js';
import { showToast, copyToClipboard, haptic } from './uiUtils.js';
import { t } from '../i18n.js';

export function renderSidebarPageTags({ onTagSelect }) {
  const sidebarTagsList = document.getElementById('sidebarTagsList');
  const sidebarTagsCount = document.getElementById('sidebarTagsCount');
  if (!sidebarTagsList) return;

  if (!state.posts || state.posts.length === 0) {
    sidebarTagsList.innerHTML = `<span class="empty-tags-hint">${t('sbt.noTags', 'Теги отсутствуют')}</span>`;
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
    sidebarTagsList.innerHTML = `<span class="empty-tags-hint">${t('sbt.noTags', 'Теги отсутствуют')}</span>`;
    return;
  }

  // Group tags by category: Artist -> Copyright -> Character -> General -> Meta
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
      tagEl.title = t('sbt.searchTag.title', 'Искать по тегу: {tag} ({n})').replace('{tag}', tag).replace('{n}', count);

      // Tag name
      const nameEl = document.createElement('span');
      nameEl.className = `s-tag-name ${config.colorClass}`;
      nameEl.textContent = tag.replace(/_/g, ' ');

      // Count
      const countEl = document.createElement('span');
      countEl.className = 's-tag-count';
      countEl.textContent = String(count);

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
