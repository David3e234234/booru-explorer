import { state } from '../state.js';

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
  const tagCategories = {};

  state.posts.forEach(post => {
    const tags = Array.isArray(post.tags) ? post.tags : [];
    tags.forEach(t => {
      const clean = typeof t === 'string' ? t.toLowerCase().trim() : String(t || '').toLowerCase().trim();
      if (!clean) return;
      tagFrequency[clean] = (tagFrequency[clean] || 0) + 1;

      if (post.tagDetails) {
        if (post.tagDetails.artist?.includes(clean)) tagCategories[clean] = 'artist';
        else if (post.tagDetails.character?.includes(clean)) tagCategories[clean] = 'character';
        else if (post.tagDetails.copyright?.includes(clean)) tagCategories[clean] = 'copyright';
        else if (post.tagDetails.meta?.includes(clean)) tagCategories[clean] = 'meta';
      }
    });
  });

  const sortedTags = Object.entries(tagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);

  if (sidebarTagsCount) sidebarTagsCount.textContent = String(sortedTags.length);
  sidebarTagsList.innerHTML = '';

  sortedTags.forEach(([tag, count]) => {
    const category = tagCategories[tag] || 'general';
    const tagEl = document.createElement('div');
    tagEl.className = 'sidebar-tag-item';
    tagEl.title = `Искать по тегу: ${tag}`;
    tagEl.innerHTML = `
      <span class="s-tag-name category-${category}">${tag.replace(/_/g, ' ')}</span>
      <span class="s-tag-count">${count}</span>
    `;

    tagEl.addEventListener('click', () => {
      if (onTagSelect) onTagSelect(tag);
    });

    sidebarTagsList.appendChild(tagEl);
  });
}
