// Markup for the viewerModal dialog, injected on first use of the owning module.
// Kept out of index.html so the initial shell stays small; data-i18n
// attributes are translated right after injection.
import { applyStaticTranslations } from '../i18n.js';

const MARKUP = `
  <!-- Full media viewer modal -->
  <div class="viewer-modal" id="viewerModal" style="display: none;" role="dialog" aria-modal="true" aria-label="Просмотр медиа">
    <div class="viewer-backdrop" id="viewerBackdrop"></div>
    
    <div class="viewer-content">
      <div class="viewer-header">
        <div class="viewer-meta">
          <span class="viewer-site-badge" id="viewerSiteBadge">Danbooru</span>
          <span class="viewer-album-badge" id="viewerAlbumBadge" style="display: none;" title="Страница альбома / сета" data-i18n-title="viewer.albumBadge.title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect width="16" height="16" x="2" y="2" rx="2"/><path d="M6 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2"/></svg>
            <span id="viewerAlbumPageText">1 / 1</span>
          </span>
          <span class="viewer-res" id="viewerResolution">1920 × 1080</span>
          <span class="viewer-ext-badge" id="viewerExtBadge">MP4</span>
          <button class="viewer-author-badge" id="viewerAuthorBadge" style="display: none;" title="Автор / Создатель (нажмите для поиска всех работ)" data-i18n-title="viewer.author.title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            <span id="viewerAuthorText">Автор</span>
          </button>
          <button class="viewer-fav-author-btn" id="viewerFavAuthorBtn" style="display: none;" title="Добавить/удалить автора из избранных" data-i18n-title="viewer.favAuthor.title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 22 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button class="viewer-fav-author-btn viewer-find-creator-btn" id="viewerFindCreatorBtn" style="display: none;" title="Найти оригинал или профиль автора на Kemono / Pawchive" data-i18n-title="viewer.findOnKemono.title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
        </div>
        <div class="viewer-top-actions">
          <!-- Not interested (hide from recommendations) -->
          <button class="viewer-btn" id="btnDislikeModal" title="Не интересно (скрыть и меньше рекомендовать)" data-i18n-title="viewer.dislike.title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          </button>
          <!-- Like (trains recommendations and syncs with the Booru API) -->
          <button class="viewer-btn" id="btnLikeModal" title="Нравится (обучает рекомендации и синхронизирует с API)" data-i18n-title="viewer.like.title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          </button>
          <!-- Favorites (TikTok-style bookmark flag) -->
          <button class="viewer-btn" id="btnFavModal" title="Сохранить в закладки (Избранное)" data-i18n-title="viewer.fav.title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
          </button>
          <button class="viewer-btn mobile-only" id="btnViewerTagsToggle" title="Теги и информация" data-i18n-title="viewer.tagsToggle.title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            <span class="viewer-tags-badge" id="viewerTagsBadgeCount">0</span>
          </button>
          <!-- Download the current media file -->
          <button class="viewer-btn" id="btnDownload" title="Скачать изображение прямо на устройство" data-i18n-title="viewer.download.title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <!-- Download the whole album (pack) -->
          <button class="viewer-btn" id="btnDownloadAlbum" style="display: none;" title="Скачать все изображения сета (альбом)" data-i18n-title="viewer.downloadAlbum.title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="4" x2="20" y2="4"/></svg>
          </button>
          <button class="viewer-btn" id="btnCopyLink" title="Скопировать ссылку" data-i18n-title="viewer.copyLink.title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button class="viewer-btn viewer-close" id="btnCloseViewer" title="Закрыть (Esc или свайп вниз)" data-i18n-title="viewer.close.title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div class="viewer-body">
        <button class="viewer-nav-btn nav-prev desktop-only" id="btnViewerPrev" title="Предыдущий (← или свайп)" data-i18n-title="viewer.prev.title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        <div class="viewer-main-column" id="viewerMainColumn">
          <div class="viewer-media-stage" id="viewerMediaStage">
            <div class="viewer-media-wrapper" id="viewerMediaWrapper"></div>

            <!-- Album page thumbnail filmstrip -->
            <div class="viewer-album-filmstrip" id="viewerAlbumFilmstrip" style="display: none;">
              <div class="album-filmstrip-inner" id="albumFilmstripInner"></div>
            </div>
          </div>

          <!-- Similar posts section below media -->
          <section class="viewer-similar-section" id="viewerSimilarFilmstrip" style="display: none;">
            <div class="similar-filmstrip-header">
              <div class="similar-filmstrip-title-wrap">
                <span class="similar-filmstrip-title" data-i18n="viewer.similarHeading">Похожие работы</span>
                <span class="similar-filmstrip-count" id="similarFilmstripCount"></span>
              </div>
              <span class="similar-filmstrip-hint" data-i18n="viewer.similarHint">Найдено на основе тегов и автора</span>
            </div>
            <div class="similar-filmstrip-inner" id="similarFilmstripInner"></div>
          </section>
        </div>

        <button class="viewer-nav-btn nav-next desktop-only" id="btnViewerNext" title="Следующий (→ или свайп)" data-i18n-title="viewer.next.title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        <!-- Info and tags sidebar / sheet -->
        <aside class="viewer-sidebar" id="viewerSidebar">
          <div class="viewer-sheet-handle mobile-only"></div>
          <div class="viewer-sidebar-header mobile-only">
            <span class="viewer-sidebar-title" data-i18n="viewer.sidebarTitle">Теги и информация</span>
            <button class="btn-icon" id="btnCloseViewerTags" title="Скрыть" data-i18n-title="viewer.sidebarClose.title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="sidebar-section">
            <h4 class="sidebar-heading" data-i18n="viewer.infoHeading">Информация</h4>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label" data-i18n="viewer.labelSite">Источник:</span>
                <span class="info-val" id="infoSite">Danbooru</span>
              </div>
              <div class="info-item" id="infoAlbumRow" style="display: none;">
                <span class="info-label" data-i18n="viewer.labelSeries">Сет / Серия:</span>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1;">
                  <button class="btn-album-fetch" id="btnFetchFullAlbum" title="Найти все слайды и изображения серии" data-i18n-title="viewer.findFullSet.title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><rect width="10" height="10" x="6" y="6" rx="1.5"/></svg>
                    <span id="btnFetchFullAlbumText" data-i18n="viewer.findFullSet">Найти весь сет</span>
                  </button>
                  <button class="btn-album-fetch btn-album-download-zip" id="btnDownloadAlbumSidebar" title="Скачать все изображения серии" style="display: none;" data-i18n-title="viewer.downloadSet.title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><line x1="4" y1="4" x2="20" y2="4"/></svg>
                    <span id="btnDownloadAlbumSidebarText" data-i18n="viewer.downloadSet">Скачать весь сет</span>
                  </button>
                </div>
              </div>
              <div class="info-item" id="infoAuthorRow" style="display: none;">
                <span class="info-label" data-i18n="viewer.labelAuthor">Автор:</span>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1;">
                  <span class="info-val info-val-author" id="infoAuthor" data-i18n="viewer.noAuthor">Не указан</span>
                  <button class="btn-fav-author-inline" id="btnFavAuthorSidebar" title="Добавить автора в избранное" data-i18n-title="viewer.favAuthor.title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span id="btnFavAuthorSidebarText" data-i18n="viewer.favAuthorInline">В избранное</span>
                  </button>
                  <button class="btn-fav-author-inline btn-cover-author-inline" id="btnSetAuthorCoverSidebar" title="Сделать этот арт обложкой автора" style="display: none;" data-i18n-title="viewer.makeCover.title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <span data-i18n="viewer.makeCover">Сделать обложкой</span>
                  </button>
                  <button class="btn-fav-author-inline btn-find-creator-inline" id="btnFindCreatorSidebar" title="Найти оригинал или профиль автора на Kemono / Pawchive" data-i18n-title="viewer.findOnKemono.title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    <span data-i18n="viewer.findOnKemono">Kemono / Pawchive</span>
                  </button>
                </div>
              </div>
              <div class="info-item" id="infoAssistantsRow" style="display: none;">
                <span class="info-label" data-i18n="viewer.labelAssistants">Помощники:</span>
                <div id="infoAssistantsList" style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap; flex: 1;"></div>
              </div>
              <div class="info-item" id="infoDurationRow" style="display: none;">
                <span class="info-label" data-i18n="viewer.labelDuration">Длительность:</span>
                <span class="info-val" id="infoDuration">0:00</span>
              </div>
              <div class="info-item" id="infoDateRow" style="display: none;">
                <span class="info-label" data-i18n="viewer.labelDate">Дата:</span>
                <span class="info-val" id="infoDate">-</span>
              </div>
              <div class="info-item">
                <span class="info-label" data-i18n="viewer.labelRating">Рейтинг:</span>
                <span class="info-val" id="infoRating">Explicit</span>
              </div>
              <div class="info-item">
                <span class="info-label" data-i18n="viewer.labelScore">Оценка:</span>
                <span class="info-val" id="infoScore">★ 142</span>
              </div>
              <div class="info-item" id="infoAiContainer">
                <span class="info-label" data-i18n="viewer.labelAi">ИИ:</span>
                <span class="info-val" id="infoAi">Нет</span>
              </div>
              <div class="info-item" id="infoDislikeRow">
                <span class="info-label" data-i18n="viewer.labelRecs">Рекомендации:</span>
                <button class="btn-dislike-sidebar" id="btnDislikeSidebar" title="Не интересно (скрыть и меньше рекомендовать)" data-i18n-title="viewer.hideFromFeed.title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  <span id="btnDislikeSidebarText" data-i18n="viewer.hideFromFeed">Скрыть из ленты</span>
                </button>
              </div>
            </div>
          </div>

          <div class="sidebar-section" id="viewerSidebarArchivesSection" style="display: none;">
            <div class="section-header-flex">
              <h4 class="sidebar-heading"><span data-i18n="viewer.attachedArchives">Прикреплённые архивы</span> (<span id="viewerSidebarArchivesCount">0</span>)</h4>
            </div>
            <div class="sidebar-archives-list" id="viewerSidebarArchivesList"></div>
          </div>

          <div class="sidebar-section" id="viewerSidebarCloudLinksSection" style="display: none;">
            <div class="section-header-flex">
              <h4 class="sidebar-heading"><span data-i18n="viewer.cloudLinksHeading">Ссылки на диск</span> (<span id="viewerSidebarCloudLinksCount">0</span>)</h4>
            </div>
            <div class="sidebar-cloud-links-list" id="viewerSidebarCloudLinksList"></div>
          </div>

          <div class="sidebar-section" id="viewerSidebarContentSection" style="display: none;">
            <div class="section-header-flex">
              <h4 class="sidebar-heading" data-i18n="viewer.contentHeading">Описание</h4>
            </div>
            <div class="viewer-post-content" id="viewerPostContent"></div>
          </div>



          <div class="sidebar-section">
            <div class="section-header-flex">
              <h4 class="sidebar-heading"><span data-i18n="viewer.tagsHeading">Теги</span> (<span id="tagsCountTotal">0</span>)</h4>
              <button class="btn-text" id="btnCopyAllTags" data-i18n="viewer.copyAll">Скопировать все</button>
            </div>
            <div class="tags-cloud" id="viewerTagsCloud"></div>
          </div>
        </aside>
      </div>
    </div>
  </div>
`;

export function ensureViewerMarkup() {
  if (document.getElementById('viewerModal')) return;
  document.body.insertAdjacentHTML('beforeend', MARKUP);
  applyStaticTranslations(document);
}
