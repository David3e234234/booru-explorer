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

export function getTagCategoryClass(tag, details) {
  if (!details) return '';
  const clean = tag.toLowerCase();
  if (details.artist && details.artist.includes(clean)) return 'tag-artist';
  if (details.character && details.character.includes(clean)) return 'tag-character';
  if (details.copyright && details.copyright.includes(clean)) return 'tag-copyright';
  if (details.meta && details.meta.includes(clean)) return 'tag-meta';
  return '';
}

export function renderSidebarTags(post, { onTagSelect, closeViewer }) {
  const tagsCloud = document.getElementById('viewerTagsCloud');
  const tagsCountTotal = document.getElementById('tagsCountTotal');
  const viewerTagsBadgeCount = document.getElementById('viewerTagsBadgeCount');
  if (!tagsCloud) return;

  tagsCloud.innerHTML = '';
  const tags = Array.isArray(post.tags) ? post.tags : [];
  if (tagsCountTotal) tagsCountTotal.textContent = String(tags.length);
  if (viewerTagsBadgeCount) viewerTagsBadgeCount.textContent = String(tags.length);

  if (tags.length === 0) {
    tagsCloud.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">Теги отсутствуют</span>';
    return;
  }

  tags.forEach(tag => {
    const tagEl = document.createElement('a');
    tagEl.className = `post-tag ${getTagCategoryClass(tag, post.tagDetails)}`;
    tagEl.textContent = tag.replace(/_/g, ' ');
    tagEl.href = '#';

    tagEl.addEventListener('click', (e) => {
      e.preventDefault();
      closeViewer();
      if (onTagSelect) onTagSelect(tag);
    });

    tagsCloud.appendChild(tagEl);
  });
}
