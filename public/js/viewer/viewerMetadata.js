import { state, isAuthorFavorite, setFavoriteAuthors } from '../state.js';
import { toggleFavoriteAuthor, updateFavoriteAuthorPreview, syncFavoriteAuthors, getAuthHeaders } from '../api.js';
import { showToast, haptic } from '../modules/uiUtils.js';
import { t } from '../i18n.js';

function isVideoUrl(url) {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mov') || clean.endsWith('.mkv') || clean.endsWith('.avi');
}

/**
 * Asynchronously resolves and enriches post metadata upon opening the viewer:
 * - Rule34Video: resolves full video stream, tags, author, and duration.
 * - Pawchive / Kemono: resolves full content, attachments, title, author, and tags.
 * - Rule34 / Xbooru: resolves high-res source, artist tag, created date, and dimensions.
 *
 * Updates author and duration badges on the corresponding gallery card DOM elements.
 *
 * @param {Object} currentPost - The currently viewed post.
 * @param {Object} options - Callbacks.
 * @param {Function} [options.onPostUpdated] - Invoked when post fields change.
 * @returns {Promise<Object|null>|null} The active resolve promise.
 */
export function resolvePostMetadata(currentPost, { onPostUpdated } = {}) {
  if (!currentPost) return null;

  if (currentPost.site === 'rule34video' && (currentPost.source || currentPost.originalId)) {
    const targetPostId = currentPost.id;
    return fetch(`/api/resolve-video?url=${encodeURIComponent(currentPost.source || '')}&id=${currentPost.originalId}&site=rule34video`)
      .then(r => r.json())
      .then(data => {
        if (!data || currentPost?.id !== targetPostId) return null;
        let changed = false;

        if (data.author && data.author !== currentPost.author) {
          currentPost.author = data.author;
          changed = true;
        }
        if (data.tags && Array.isArray(data.tags) && data.tags.length > (currentPost.tags?.length || 0)) {
          currentPost.tags = data.tags;
          currentPost.tagDetails = data.tagDetails || currentPost.tagDetails;
          changed = true;
        }
        if (data.fullVideoUrl) {
          currentPost.fileUrl = data.fullVideoUrl;
          currentPost.hasSound = true;
          if (data.quality) currentPost.quality = data.quality;
        }
        if (data.duration && (!currentPost.duration || currentPost.duration === 20)) {
          currentPost.duration = data.duration;
          currentPost.durationText = data.durationText || currentPost.durationText;
          changed = true;
        }

        if (changed && typeof onPostUpdated === 'function') {
          onPostUpdated(currentPost, { changed: true });
        }

        const cardEl = document.querySelector(`.media-card[data-post-id="${targetPostId}"]`);
        if (cardEl) {
          if (data.author) {
            if (cardEl._post) cardEl._post.author = data.author;
            let authorBadge = cardEl.querySelector('.badge-format.author');
            const parts = data.author.split(',').map(s => s.trim()).filter(Boolean);
            const mainAuthor = parts.find(a => !/\((audio|sfx|sound|voice|va|music)\)/i.test(a)) || parts[0] || '';
            const cleanA = mainAuthor.replace(/^@/, '').replace(/^pixiv:/, '').replace(/_?\((artist|creator|circle|studio|doujin|illustrator)\)$/i, '').trim();
            if (cleanA && cleanA.length >= 2) {
              if (authorBadge) {
                authorBadge.textContent = cleanA;
                authorBadge.setAttribute('data-author', cleanA);
                authorBadge.setAttribute('title', `Автор: ${cleanA} (нажмите для поиска)`);
              } else {
                const bottomGroup = cardEl.querySelector('.badge-group-bottom');
                if (bottomGroup) {
                  const span = document.createElement('span');
                  span.className = 'badge-format author';
                  span.setAttribute('data-author', cleanA);
                  span.setAttribute('title', `Автор: ${cleanA} (нажмите для поиска)`);
                  span.textContent = cleanA;
                  bottomGroup.appendChild(span);
                }
              }
            }
          }
          if (data.duration) {
            if (cardEl._post) {
              cardEl._post.duration = data.duration;
              cardEl._post.durationText = data.durationText;
            }
            let durBadge = cardEl.querySelector('.badge-duration');
            if (!durBadge) {
              const topGroup = cardEl.querySelector('.badge-group-top > div');
              if (topGroup) {
                durBadge = document.createElement('span');
                durBadge.className = 'badge-format badge-duration';
                durBadge.style.cssText = 'background-color: rgba(12, 9, 6, 0.85); border: 1px solid rgba(255, 255, 255, 0.2);';
                topGroup.appendChild(durBadge);
              }
            }
            if (durBadge) {
              durBadge.textContent = data.durationText;
              durBadge.setAttribute('title', `Длительность: ${data.durationText}`);
            }
          }
        }
        return data;
      })
      .catch(() => null);
  } else if ((currentPost.site === 'pawchive' || currentPost.site === 'kemono') && (currentPost.originalId || currentPost.id)) {
    const targetSite = currentPost.site;
    const targetPostId = currentPost.id;
    const cleanOrigId = (currentPost.originalId || currentPost.id || '').replace(/^(pawchive|kemono)_/, '').split('_')[0];
    const targetService = currentPost.service || (currentPost.seriesKey ? currentPost.seriesKey.split(':')[1] : '') || '';
    const targetUser = currentPost.user || (currentPost.seriesKey ? currentPost.seriesKey.split(':')[2] : '') || '';
    const reqUrl = `/api/resolve-post?site=${encodeURIComponent(targetSite)}&postId=${encodeURIComponent(cleanOrigId)}&service=${encodeURIComponent(targetService)}&user=${encodeURIComponent(targetUser)}&seriesKey=${encodeURIComponent(currentPost.seriesKey || '')}&postUrl=${encodeURIComponent(currentPost.postUrl || currentPost.source || '')}`;

    return fetch(reqUrl)
      .then(r => r.json())
      .then(data => {
        if (!data || !data.success || !data.post || currentPost?.id !== targetPostId) return null;
        const resolved = data.post;
        let changed = false;

        if (resolved.content && resolved.content !== currentPost.content) {
          currentPost.content = resolved.content;
          if (Array.isArray(currentPost.albumItems)) {
            currentPost.albumItems.forEach(item => {
              if (item) item.content = resolved.content;
            });
          }
          changed = true;
        }

        if (resolved.title && !currentPost.title) {
          currentPost.title = resolved.title;
          changed = true;
        }

        if (resolved.author && resolved.author !== currentPost.author && (!currentPost.author || currentPost.author.startsWith('user_'))) {
          currentPost.author = resolved.author;
          changed = true;
        }

        if (resolved.tagDetails && Object.keys(resolved.tagDetails).length > 0) {
          currentPost.tagDetails = resolved.tagDetails;
          changed = true;
        }

        if (Array.isArray(resolved.albumItems) && resolved.albumItems.length > (currentPost.albumItems?.length || 1)) {
          currentPost.albumItems = resolved.albumItems;
          currentPost.albumCount = resolved.albumItems.length;
          currentPost.isAlbum = true;
          currentPost.hasChildren = true;
          changed = true;
        }

        if (Array.isArray(resolved.archiveUrls) && resolved.archiveUrls.length > (currentPost.archiveUrls?.length || 0)) {
          currentPost.isArchive = true;
          currentPost.archiveUrls = resolved.archiveUrls;
          currentPost.archiveNames = resolved.archiveNames;
          currentPost.archiveSizes = resolved.archiveSizes;
          changed = true;
        }

        if (changed && typeof onPostUpdated === 'function') {
          onPostUpdated(currentPost, { changed: true, contentChanged: Boolean(resolved.content) });
        }
        return data;
      })
      .catch(() => null);
  } else if ((currentPost.site === 'rule34' || currentPost.site === 'xbooru' || currentPost.site === 'allgirl') && (currentPost.originalId || currentPost.id)) {
    const targetPostId = currentPost.id;
    const cleanOrigId = (currentPost.originalId || currentPost.id || '').replace(/^(rule34|xbooru|allgirl)_/, '').split('_')[0];
    const needsResolve = !currentPost.width ||
      !currentPost.author ||
      !(currentPost.tagDetails?.artist?.length) ||
      !currentPost.source ||
      currentPost.source.includes('rule34.xxx/index.php') ||
      currentPost.source.includes('xbooru.com/index.php') ||
      currentPost.source.includes('allgirl.booru.org/index.php');

    if (needsResolve && cleanOrigId) {
      const tagsParam = Array.isArray(currentPost.tags) ? currentPost.tags.join(',') : '';
      const reqUrl = `/api/resolve-post?site=${encodeURIComponent(currentPost.site)}&id=${encodeURIComponent(cleanOrigId)}${tagsParam ? `&tags=${encodeURIComponent(tagsParam)}` : ''}`;

      return fetch(reqUrl, { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(data => {
          if (!data || !data.success || !data.post || currentPost?.id !== targetPostId) return null;
          const resolved = data.post;
          let changed = false;

          if (resolved.fileUrl && resolved.fileUrl !== currentPost.fileUrl) {
            currentPost.fileUrl = resolved.fileUrl;
            currentPost.sampleUrl = resolved.sampleUrl || resolved.fileUrl;
            currentPost.thumbSample = resolved.thumbSample || resolved.fileUrl;
            currentPost.thumbOriginal = resolved.thumbOriginal || resolved.fileUrl;
            currentPost.fileExt = resolved.fileExt || currentPost.fileExt;
            changed = true;
          }

          if (resolved.author && resolved.author !== currentPost.author) {
            currentPost.author = resolved.author;
            changed = true;
          }

          if (resolved.source && resolved.source !== currentPost.source && !resolved.source.includes('rule34.xxx/index.php') && !resolved.source.includes('xbooru.com/index.php')) {
            currentPost.source = resolved.source;
            changed = true;
          }

          if (resolved.tagDetails && Object.keys(resolved.tagDetails).length > 0) {
            if (resolved.tagDetails.artist?.length || resolved.tagDetails.copyright?.length || resolved.tagDetails.character?.length) {
              currentPost.tagDetails = resolved.tagDetails;
              changed = true;
            }
          }

          if (Array.isArray(resolved.tags) && resolved.tags.length > (currentPost.tags?.length || 0)) {
            currentPost.tags = resolved.tags;
            changed = true;
          }

          if (resolved.createdAt && !currentPost.createdAt) {
            currentPost.createdAt = resolved.createdAt;
            changed = true;
          }

          if (resolved.width && (!currentPost.width || currentPost.width !== resolved.width)) {
            currentPost.width = resolved.width;
            currentPost.height = resolved.height;
            changed = true;
          }

          if (changed) {
            if (typeof onPostUpdated === 'function') {
              onPostUpdated(currentPost, { changed: true });
            }

            const card = document.querySelector(`.media-card[data-post-id="${currentPost.id}"]`);
            if (card) {
              card._post = currentPost;
              const bottomGroup = card.querySelector('.badge-group-bottom');
              if (bottomGroup && currentPost.author) {
                let authorBadge = bottomGroup.querySelector('.badge-format.author');
                const cleanA = currentPost.author.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/i, '').trim();
                if (cleanA && cleanA.length >= 2) {
                  if (!authorBadge) {
                    authorBadge = document.createElement('span');
                    authorBadge.className = 'badge-format author';
                    bottomGroup.appendChild(authorBadge);
                  }
                  authorBadge.setAttribute('data-author', cleanA);
                  authorBadge.setAttribute('title', t('gal.authorBadge.title', 'Автор: {name} (нажмите для поиска)').replace('{name}', cleanA));
                  authorBadge.textContent = cleanA;
                }
              }
            }
          }
          return data;
        })
        .catch(() => null);
    }
  }

  return null;
}

/**
 * Renders author header badges, sidebar author details, assistants list,
 * favorite author button, and "Set as cover" action button.
 * @param {Object} currentPost
 * @param {Object} params
 * @param {Function} [params.closeViewer]
 * @param {Function} [params.onTagSelect]
 * @param {Function} [params.onFavoriteAuthorToggle]
 */
export function renderAuthorInfo(currentPost, { closeViewer, onTagSelect, onFavoriteAuthorToggle } = {}) {
  const viewerAuthorBadge = document.getElementById('viewerAuthorBadge');
  const viewerAuthorText = document.getElementById('viewerAuthorText');
  const viewerFavAuthorBtn = document.getElementById('viewerFavAuthorBtn');
  const infoAuthorRow = document.getElementById('infoAuthorRow');
  const infoAuthor = document.getElementById('infoAuthor');
  const infoAssistantsRow = document.getElementById('infoAssistantsRow');
  const infoAssistantsList = document.getElementById('infoAssistantsList');
  const btnFavAuthorSidebar = document.getElementById('btnFavAuthorSidebar');
  const btnFavAuthorSidebarText = document.getElementById('btnFavAuthorSidebarText');
  const btnSetAuthorCoverSidebar = document.getElementById('btnSetAuthorCoverSidebar');

  let primaryVisualArtist = '';
  if (currentPost?.tagDetails?.artist && currentPost.tagDetails.artist.length > 0) {
    const visualTag = currentPost.tagDetails.artist.find(a => !/_?\((audio|sfx|sound|voice|va|music)\)$/i.test(a));
    primaryVisualArtist = visualTag || currentPost.tagDetails.artist[0];
  }

  const rawAuthor = currentPost?.author || primaryVisualArtist || '';
  const authorName = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor ? String(rawAuthor) : '');
  const authorParts = authorName.split(',').map(s => s.trim()).filter(Boolean);
  const mainAuthorName = authorParts.find(a => !/\((audio|sfx|sound|voice|va|music)\)/i.test(a)) || authorParts[0] || authorName;

  if (authorName && authorName.trim()) {
    const cleanAuthorTag = (primaryVisualArtist || mainAuthorName).trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    const isFavAuthor = isAuthorFavorite(cleanAuthorTag);

    if (viewerAuthorBadge && viewerAuthorText) {
      viewerAuthorText.textContent = mainAuthorName;
      viewerAuthorBadge.style.display = 'inline-flex';
      viewerAuthorBadge.onclick = (e) => {
        e.stopPropagation();
        const targetSite = currentPost?.site;
        if (closeViewer) closeViewer();
        const tagToSearch = (targetSite === 'rule34video' && !cleanAuthorTag.includes(':'))
          ? `artist:${cleanAuthorTag}`
          : cleanAuthorTag;
        if (onTagSelect) onTagSelect(tagToSearch);
      };
    }
    if (viewerFavAuthorBtn) {
      viewerFavAuthorBtn.style.display = 'inline-flex';
      viewerFavAuthorBtn.classList.toggle('active', isFavAuthor);
      viewerFavAuthorBtn.title = isFavAuthor
        ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
        : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
    }
    if (infoAuthorRow && infoAuthor) {
      infoAuthor.textContent = mainAuthorName;
      infoAuthorRow.style.display = 'flex';
      infoAuthor.onclick = () => {
        const targetSite = currentPost?.site;
        if (closeViewer) closeViewer();
        const tagToSearch = (targetSite === 'rule34video' && !cleanAuthorTag.includes(':'))
          ? `artist:${cleanAuthorTag}`
          : cleanAuthorTag;
        if (onTagSelect) onTagSelect(tagToSearch);
      };
    }

    const assistants = Array.isArray(currentPost.assistants) ? currentPost.assistants : [];
    if (infoAssistantsRow && infoAssistantsList) {
      if (assistants.length > 0) {
        infoAssistantsList.innerHTML = '';
        assistants.forEach(asst => {
          const asstChip = document.createElement('span');
          asstChip.className = 'info-assistant-chip';
          asstChip.textContent = asst;
          asstChip.title = t('viewer.author.title', 'Автор / Создатель (нажмите для поиска всех работ)');
          asstChip.onclick = () => {
            const targetSite = currentPost?.site;
            if (closeViewer) closeViewer();
            const cleanAsstTag = asst.replace(/\s*\([^)]*\)/g, '').trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
            const tagToSearch = (targetSite === 'rule34video' && !cleanAsstTag.includes(':'))
              ? `artist:${cleanAsstTag}`
              : cleanAsstTag;
            if (onTagSelect) onTagSelect(tagToSearch);
          };
          infoAssistantsList.appendChild(asstChip);
        });
        infoAssistantsRow.style.display = 'flex';
      } else {
        infoAssistantsRow.style.display = 'none';
      }
    }
    if (btnFavAuthorSidebar && btnFavAuthorSidebarText) {
      btnFavAuthorSidebar.classList.toggle('active', isFavAuthor);
      btnFavAuthorSidebarText.textContent = isFavAuthor ? t('vw.authorFavOn', 'В избранном') : t('viewer.favAuthorInline', 'В избранное');
      btnFavAuthorSidebar.title = isFavAuthor
        ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
        : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
    }
    if (btnSetAuthorCoverSidebar) {
      btnSetAuthorCoverSidebar.style.display = isFavAuthor ? 'inline-flex' : 'none';
      btnSetAuthorCoverSidebar.onclick = async (e) => {
        e.stopPropagation();
        haptic(15);
        const isVideo = currentPost.isVideo || isVideoUrl(currentPost.fileUrl) || isVideoUrl(currentPost.sampleUrl) || isVideoUrl(currentPost.previewUrl);
        const rawUrl = currentPost.sampleUrl || currentPost.fileUrl || currentPost.previewUrl;
        const chosenUrl = isVideo ? (currentPost.previewUrl || rawUrl) : (currentPost.sampleUrl || currentPost.fileUrl || currentPost.previewUrl);
        if (!chosenUrl) return;

        const sampleUrl = isVideo ? '' : (currentPost.sampleUrl || '');
        const fileUrl = isVideo ? '' : (currentPost.fileUrl || '');
        const thumb180 = currentPost.previewUrl || '';
        const thumb360 = currentPost.sampleUrl || '';
        const thumb720 = currentPost.fileUrl || '';

        const target = state.favoriteAuthors.find(a => (a.name || '').toLowerCase() === cleanAuthorTag.toLowerCase());
        if (target) {
          target.previewUrl = chosenUrl;
          target.sampleUrl = sampleUrl;
          target.fileUrl = fileUrl;
          target.thumb180 = thumb180;
          target.thumb360 = thumb360;
          target.thumb720 = thumb720;
          target.site = currentPost.site || target.site || 'danbooru';
        }
        setFavoriteAuthors([...state.favoriteAuthors]);
        showToast(t('vw.coverSetForAuthor', 'Этот арт установлен обложкой автора {name}!').replace('{name}', mainAuthorName));
        if (onFavoriteAuthorToggle) onFavoriteAuthorToggle();

        try {
          await updateFavoriteAuthorPreview(cleanAuthorTag, chosenUrl, currentPost.site || 'danbooru', { sampleUrl, fileUrl, thumb180, thumb360, thumb720 });
          await syncFavoriteAuthors(state.favoriteAuthors);
        } catch (err) {
          console.error('Ошибка сохранения обложки автора:', err);
        }
      };
    }
  } else {
    if (viewerAuthorBadge) viewerAuthorBadge.style.display = 'none';
    if (viewerFavAuthorBtn) viewerFavAuthorBtn.style.display = 'none';
    if (infoAuthorRow) infoAuthorRow.style.display = 'none';
    if (infoAssistantsRow) infoAssistantsRow.style.display = 'none';
    if (btnSetAuthorCoverSidebar) btnSetAuthorCoverSidebar.style.display = 'none';
  }
}

/**
 * Toggles the favorite author status for the currently viewed post.
 * @param {Object} currentPost
 * @param {Object} [params]
 * @param {Function} [params.onFavoriteAuthorToggle]
 */
export async function handleAuthorFavToggle(currentPost, { onFavoriteAuthorToggle } = {}) {
  if (!currentPost) return;
  const rawAuthor = currentPost.author || (currentPost.tagDetails?.artist && currentPost.tagDetails.artist.length > 0 ? currentPost.tagDetails.artist.join(', ') : '');
  const authorName = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor ? String(rawAuthor) : '');
  if (!authorName || !authorName.trim()) return;

  const cleanAuthorTag = authorName.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
  const authorSite = currentPost.site || 'danbooru';
  const postService = currentPost.service || (currentPost.seriesKey ? currentPost.seriesKey.split(':')[1] : '') || '';
  const postUser = currentPost.user || (currentPost.seriesKey ? currentPost.seriesKey.split(':')[2] : '') || '';
  haptic([15, 25, 15]);

  try {
    const res = await toggleFavoriteAuthor({
      name: cleanAuthorTag,
      displayName: authorName,
      previewUrl: currentPost.previewUrl || currentPost.sampleUrl || '',
      site: authorSite,
      service: postService,
      user: postUser
    });

    if (res.success) {
      if (res.isFavorite) {
        state.favoriteAuthorNames.add(cleanAuthorTag.toLowerCase());
        state.favoriteAuthors.unshift(res.author || {
          id: cleanAuthorTag,
          name: cleanAuthorTag,
          displayName: authorName,
          previewUrl: currentPost.previewUrl || currentPost.sampleUrl || '',
          site: authorSite,
          service: postService,
          user: postUser,
          createdAt: new Date().toISOString()
        });
        showToast(t('vw.authorAdded', 'Автор {name} добавлен в любимые').replace('{name}', authorName));
      } else {
        state.favoriteAuthorNames.delete(cleanAuthorTag.toLowerCase());
        state.favoriteAuthors = state.favoriteAuthors.filter(a => (a.name || '').toLowerCase() !== cleanAuthorTag.toLowerCase());
        showToast(t('vw.authorRemoved', 'Автор {name} удален из любимых').replace('{name}', authorName));
      }

      const isFavAuthor = res.isFavorite;
      const viewerFavAuthorBtn = document.getElementById('viewerFavAuthorBtn');
      const btnFavAuthorSidebar = document.getElementById('btnFavAuthorSidebar');
      const btnFavAuthorSidebarText = document.getElementById('btnFavAuthorSidebarText');
      const btnSetAuthorCoverSidebar = document.getElementById('btnSetAuthorCoverSidebar');

      if (viewerFavAuthorBtn) {
        viewerFavAuthorBtn.classList.toggle('active', isFavAuthor);
        viewerFavAuthorBtn.title = isFavAuthor
          ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
          : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
      }
      if (btnFavAuthorSidebar && btnFavAuthorSidebarText) {
        btnFavAuthorSidebar.classList.toggle('active', isFavAuthor);
        btnFavAuthorSidebarText.textContent = isFavAuthor ? t('vw.authorFavOn', 'В избранном') : t('viewer.favAuthorInline', 'В избранное');
        btnFavAuthorSidebar.title = isFavAuthor
          ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
          : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
      }
      if (btnSetAuthorCoverSidebar) {
        btnSetAuthorCoverSidebar.style.display = isFavAuthor ? 'inline-flex' : 'none';
      }

      if (onFavoriteAuthorToggle) onFavoriteAuthorToggle();
    }
  } catch (err) {
    console.error('Ошибка добавления автора в любимые:', err);
    showToast(t('vw.authorUpdateFailed', 'Не удалось обновить избранного автора'));
  }
}
