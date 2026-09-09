import { fetchArchiveInspect, fetchArchiveList } from '../api.js';
import { subscribeArchiveJob, notifyArchiveJob, startArchivePolling, stopArchivePolling, formatBytes } from './viewerArchives.js';
import { renderSidebarCloudLinks, renderSidebarContent } from './viewerCloudLinks.js';
import { downloadManager } from '../modules/downloadManager.js';
import { openSettingsModal, switchSettingsTab } from '../modules/settingsModal.js';
import { showToast, haptic, copyToClipboard } from '../modules/uiUtils.js';
import { state } from '../state.js';
import { t } from '../i18n.js';

let archiveInspectContext = null;

/**
 * Configure shared viewer context for archive unpacking and metadata updates.
 * @param {{ getCurrentPost: () => Object, onUnpacked: (post: Object, albumItems: Array) => void }} ctx
 */
export function setArchiveInspectContext(ctx) {
  archiveInspectContext = ctx;
}

/**
 * Checks if the archive inspection modal is currently open.
 * @returns {boolean}
 */
export function isArchiveInspectModalOpen() {
  const modal = document.getElementById('archiveInspectModal');
  return Boolean(modal && modal.style.display !== 'none');
}

/**
 * Closes the archive inspection modal.
 */
export function closeArchiveInspectModal() {
  const modal = document.getElementById('archiveInspectModal');
  if (modal) modal.style.display = 'none';
}

/**
 * Unpacks an archive on the server and opens it directly in the viewer gallery.
 * @param {string} url
 * @param {string} name
 * @param {Object} [options={}]
 * @param {Object} [options.currentPost]
 * @param {Function} [options.onUnpacked]
 */
export async function unpackAndViewArchive(url, name, options = {}) {
  const currentPost = options.currentPost || archiveInspectContext?.getCurrentPost?.();
  if (!currentPost) return;
  const cleanName = name || (url.split('?')[0].split('/').pop()) || 'archive.zip';
  haptic(10);

  closeArchiveInspectModal();

  notifyArchiveJob(url, { active: true, action: 'view', phase: 'download', percent: 0, received: 0, total: 0 });
  startArchivePolling(url);

  try {
    const res = await fetchArchiveList(url);
    stopArchivePolling(url);
    if (res && res.success && Array.isArray(res.albumItems) && res.albumItems.length > 0) {
      notifyArchiveJob(url, { active: false, action: 'view', completed: true, phase: 'unpack', percent: 100 });
      currentPost.albumItems = res.albumItems;
      currentPost.albumCount = res.albumItems.length;
      currentPost.isAlbum = true;
      currentPost.fileUrl = res.albumItems[0].fileUrl;
      currentPost.sampleUrl = res.albumItems[0].sampleUrl;
      currentPost.previewUrl = res.albumItems[0].previewUrl;
      currentPost.isVideo = Boolean(res.albumItems[0].isVideo);

      if (typeof options.onUnpacked === 'function') {
        options.onUnpacked(currentPost, res.albumItems);
      } else if (archiveInspectContext?.onUnpacked) {
        archiveInspectContext.onUnpacked(currentPost, res.albumItems);
      }
      showToast(t('vw.archiveOpenedInViewer', 'Архив распакован: открыто {n} файлов').replace('{n}', String(res.albumItems.length)));
    } else {
      notifyArchiveJob(url, { active: false, action: 'view', error: res?.error || 'No media', phase: 'unpack' });
      showToast(res?.error || t('vw.archiveNoMedia', 'В архиве не найдено поддерживаемых медиафайлов'), 3500);
    }
  } catch (err) {
    stopArchivePolling(url);
    notifyArchiveJob(url, { active: false, action: 'view', error: err.message, phase: 'unpack' });
    showToast(err.message || t('vw.archiveUnpackFailed', 'Ошибка при распаковке архива'), 3500);
  }
}

/**
 * Renders the file list inside the inspection modal with filtering and download triggers.
 * @param {Object} data
 * @param {HTMLElement} fileListContainer
 * @param {string} effectiveUrl
 * @param {string} [filterText='']
 * @param {Array<Function>} [unsubscribers=[]]
 * @returns {Array<Function>} Updated unsubscribers list.
 */
export function renderFileList(data, fileListContainer, effectiveUrl, filterText = '', unsubscribers = []) {
  if (!fileListContainer) return unsubscribers;

  unsubscribers.forEach(u => {
    try { u(); } catch {}
  });
  unsubscribers = [];

  fileListContainer.innerHTML = '';
  const fileTree = data.fileTree || [];
  const q = filterText.toLowerCase().trim();
  const filtered = q ? fileTree.filter(f => (f.name || '').toLowerCase().includes(q) || (f.path || '').toLowerCase().includes(q)) : fileTree;

  if (filtered.length === 0) {
    fileListContainer.innerHTML = `<div style="padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center;">${t('vw.noMatchingFiles', 'Файлы не найдены')}</div>`;
    return unsubscribers;
  }

  const defaultIconHtml = `<svg class="btn-archive-file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  const spinnerIconHtml = `<svg class="btn-archive-file-icon btn-archive-spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="38" stroke-dashoffset="12"/></svg>`;
  const checkIconHtml = `<svg class="btn-archive-file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>`;

  filtered.forEach(f => {
    const row = document.createElement('div');
    row.className = 'archive-inspect-file-row';
    const sizeStr = f.size > 0 ? formatBytes(f.size) : '';
    const threads = state.settings?.archiveDownloadThreads || 4;
    const downloadUrl = effectiveUrl
      ? `/api/archive/download-file?url=${encodeURIComponent(effectiveUrl)}&name=${encodeURIComponent(f.path || f.name)}&threads=${threads}`
      : '';

    row.innerHTML = `
      <div class="archive-inspect-file-info">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); flex-shrink: 0;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        <span class="archive-inspect-file-name" title="${f.path || f.name}">${f.name}</span>
        ${f.hasLinks ? `<span class="archive-badge-links">🔗 ${t('vw.links', 'Ссылки')}</span>` : ''}
      </div>
      <div class="archive-inspect-file-meta">
        ${sizeStr ? `<span class="archive-inspect-file-size">${sizeStr}</span>` : ''}
        ${downloadUrl ? `
          <button type="button" class="btn-archive-file-download" title="${t('viewer.downloadThisFile', 'Скачать этот файл')}">
            <div class="btn-archive-file-progress" style="width: 0%;"></div>
            <span class="btn-archive-file-content">
              <svg class="btn-archive-file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span class="btn-archive-file-download-text">${t('viewer.downloadFileBtn', 'Скачать')}</span>
            </span>
          </button>
        ` : ''}
      </div>
    `;

    const dlBtn = row.querySelector('.btn-archive-file-download');
    const sizeEl = row.querySelector('.archive-inspect-file-size');
    if (dlBtn && downloadUrl) {
      const progressFill = dlBtn.querySelector('.btn-archive-file-progress');
      const dlText = dlBtn.querySelector('.btn-archive-file-download-text');
      let resetTimer = null;

      const updateBtnState = (task) => {
        if (!task) return;
        clearTimeout(resetTimer);

        if (task.status === 'downloading' || task.status === 'saving') {
          dlBtn.classList.remove('is-completed', 'is-error');
          dlBtn.classList.add('is-downloading');
          const curIcon = dlBtn.querySelector('.btn-archive-file-icon');
          if (curIcon && !curIcon.classList.contains('btn-archive-spinner')) {
            curIcon.outerHTML = spinnerIconHtml;
          }
          const pct = Math.round(task.percent || 0);
          if (progressFill) progressFill.style.width = `${pct}%`;
          if (task.status === 'saving') {
            if (dlText) dlText.textContent = t('dl.saving', 'Сохранение...');
          } else {
            if (dlText) dlText.textContent = pct > 0 ? `${pct}%` : t('vw.downloading', 'Загрузка');
          }
          if (sizeEl) {
            const totalBytes = task.total || f.size || 0;
            if (task.loaded > 0 && totalBytes > 0) {
              sizeEl.textContent = `${formatBytes(task.loaded)} / ${formatBytes(totalBytes)}`;
            }
          }
        } else if (task.status === 'completed') {
          dlBtn.classList.remove('is-downloading', 'is-error');
          dlBtn.classList.add('is-completed');
          if (progressFill) progressFill.style.width = '100%';
          const curIcon = dlBtn.querySelector('.btn-archive-file-icon');
          if (curIcon) curIcon.outerHTML = checkIconHtml;
          if (dlText) dlText.textContent = t('vw.archiveDownloadedShort', 'Скачано ✓');
          if (sizeEl) sizeEl.textContent = sizeStr;
          resetTimer = setTimeout(() => {
            dlBtn.classList.remove('is-completed', 'is-downloading', 'is-error');
            if (progressFill) progressFill.style.width = '0%';
            const resetIcon = dlBtn.querySelector('.btn-archive-file-icon');
            if (resetIcon) resetIcon.outerHTML = defaultIconHtml;
            if (dlText) dlText.textContent = t('viewer.downloadFileBtn', 'Скачать');
          }, 4000);
        } else if (task.status === 'error') {
          dlBtn.classList.remove('is-downloading');
          dlBtn.classList.add('is-error');
          if (progressFill) progressFill.style.width = '0%';
          if (dlText) dlText.textContent = t('vw.error', 'Ошибка');
          if (sizeEl) sizeEl.textContent = sizeStr;
          resetTimer = setTimeout(() => {
            dlBtn.classList.remove('is-error', 'is-downloading', 'is-completed');
            const resetIcon = dlBtn.querySelector('.btn-archive-file-icon');
            if (resetIcon) resetIcon.outerHTML = defaultIconHtml;
            if (dlText) dlText.textContent = t('viewer.downloadFileBtn', 'Скачать');
          }, 3000);
        } else if (task.status === 'cancelled') {
          dlBtn.classList.remove('is-downloading', 'is-completed', 'is-error');
          if (progressFill) progressFill.style.width = '0%';
          const resetIcon = dlBtn.querySelector('.btn-archive-file-icon');
          if (resetIcon) resetIcon.outerHTML = defaultIconHtml;
          if (dlText) dlText.textContent = t('viewer.downloadFileBtn', 'Скачать');
          if (sizeEl) sizeEl.textContent = sizeStr;
        }
      };

      const unsub = downloadManager.subscribeToUrl(downloadUrl, updateBtnState);
      unsubscribers.push(unsub);

      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic(10);
        downloadManager.startDownload({
          url: downloadUrl,
          filename: f.name,
          size: Number(f.size) || 0,
          showDock: false
        });
      });
    }

    fileListContainer.appendChild(row);
  });

  return unsubscribers;
}

/**
 * Renders structured archive inspection results: metadata, media player open button,
 * extracted cloud links & passwords, and file list tree.
 * @param {Object} data
 * @param {string} archiveName
 * @param {HTMLElement} container
 * @param {string} archiveUrl
 */
export function renderInspectResults(data, archiveName, container, archiveUrl) {
  const totalFiles = data.totalFiles || (data.fileTree ? data.fileTree.length : 0);
  const totalSize = data.archiveSize || data.totalBytes || 0;
  const links = data.scannedLinks || [];
  const fileTree = data.fileTree || [];
  const hasMedia = Boolean(data.hasMedia || fileTree.some(f => /\.(jpe?g|png|gif|webp|mp4|webm|mov|mkv)$/i.test(f.name || '')));
  const effectiveUrl = archiveUrl || data.zipUrl || '';

  container.innerHTML = `
    <div class="archive-inspect-meta">
      <div class="archive-inspect-meta-item">
        <span class="archive-inspect-meta-label">${t('vw.archive', 'Архив')}</span>
        <span class="archive-inspect-meta-value" style="font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${archiveName}">${archiveName}</span>
      </div>
      <div class="archive-inspect-meta-item">
        <span class="archive-inspect-meta-label">${t('vw.filesCount', 'Файлов')}</span>
        <span class="archive-inspect-meta-value">${totalFiles}</span>
      </div>
      <div class="archive-inspect-meta-item">
        <span class="archive-inspect-meta-label">${t('vw.archiveSize', 'Размер')}</span>
        <span class="archive-inspect-meta-value">${totalSize > 0 ? formatBytes(totalSize) : '--'}</span>
      </div>
    </div>

    ${hasMedia ? `
      <div class="archive-inspect-actions">
        <button type="button" class="btn-primary btn-archive-inspect-open-player" id="btnInspectOpenInPlayer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>${t('viewer.openArchiveInViewer', 'Открыть файлы в плеере / галерее')}</span>
        </button>
      </div>
    ` : ''}

    <div class="archive-inspect-links-section">
      <div class="archive-inspect-section-title">${t('viewer.archiveInspectLinksFound', 'Найденные ссылки и пароли')} (${links.length})</div>
      ${links.length > 0 ? `
        <div class="sidebar-cloud-links-list" id="inspectLinksList"></div>
      ` : `
        <div class="archive-inspect-no-links">${t('viewer.archiveInspectNoLinks', 'В файлах архива внешних ссылок не обнаружено')}</div>
      `}
    </div>

    <div class="archive-inspect-files-section">
      <div class="archive-inspect-section-title">${t('viewer.archiveInspectFiles', 'Файлы в архиве')} (${fileTree.length})</div>
      <input type="text" class="archive-inspect-search" id="archiveInspectSearchInput" placeholder="${t('viewer.archiveInspectSearchPlaceholder', 'Поиск по файлам в архиве...')}">
      <div class="archive-inspect-file-list" id="archiveInspectFileList"></div>
    </div>
  `;

  const openInPlayerBtn = container.querySelector('#btnInspectOpenInPlayer');
  if (openInPlayerBtn && effectiveUrl) {
    subscribeArchiveJob(effectiveUrl, (state) => {
      if (state.active) {
        openInPlayerBtn.disabled = true;
        const statusText = state.phase === 'extract'
          ? t('vw.archiveExtracting', 'Распаковка архива...')
          : `${t('vw.downloading', 'Загрузка')} ${state.percent || 0}%`;
        openInPlayerBtn.innerHTML = `
          <div class="loading-spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
          <span>${statusText}</span>
        `;
      }
    });
    openInPlayerBtn.addEventListener('click', () => {
      unpackAndViewArchive(effectiveUrl, archiveName);
    });
  }

  const linksContainer = container.querySelector('#inspectLinksList');
  if (linksContainer && links.length > 0) {
    links.forEach(item => {
      const card = document.createElement('div');
      card.className = 'sidebar-cloud-card';
      let displayUrl = item.url;
      try {
        const parsed = new URL(item.url);
        displayUrl = parsed.hostname + (parsed.pathname.length > 28 ? parsed.pathname.slice(0, 28) + '…' : parsed.pathname);
      } catch {}

      card.innerHTML = `
        <div class="cloud-card-header">
          <span class="cloud-card-service-badge" data-service="${item.serviceId}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
            ${item.service || 'Облако'}
          </span>
          ${item.sourceFile ? `<span class="cloud-card-source-tag" title="${t('vw.foundIn', 'Найдено в:')} ${item.sourceFile}">${item.sourceFile}</span>` : ''}
        </div>
        <div class="cloud-card-url" title="${item.url}">${displayUrl}</div>
        ${item.password ? `
          <div class="cloud-card-pass-row">
            <span class="cloud-card-pass-label">${t('vw.password', 'Пароль:')}</span>
            <code class="cloud-card-pass-code">${item.password}</code>
            <button type="button" class="btn-copy-pass" title="${t('viewer.copyPassword', 'Скопировать пароль')}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        ` : ''}
        <div class="cloud-card-actions">
          <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="cloud-card-btn cloud-card-btn-open">
            <span>${t('vw.openLink', 'Открыть')}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
          <button type="button" class="cloud-card-btn cloud-card-btn-copy" title="${t('viewer.copyLink', 'Копировать ссылку')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>${t('viewer.copyLink', 'Копировать')}</span>
          </button>
        </div>
      `;

      const copyBtn = card.querySelector('.cloud-card-btn-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          haptic(10);
          copyToClipboard(item.url);
          const span = copyBtn.querySelector('span');
          if (span) {
            const orig = span.textContent;
            span.textContent = t('viewer.copied', 'Скопировано!');
            setTimeout(() => { span.textContent = orig; }, 1800);
          }
        });
      }

      const copyPass = card.querySelector('.btn-copy-pass');
      if (copyPass && item.password) {
        copyPass.addEventListener('click', (e) => {
          e.stopPropagation();
          haptic(10);
          copyToClipboard(item.password);
          showToast(t('vw.passCopied', 'Пароль скопирован: ') + item.password);
        });
      }

      linksContainer.appendChild(card);
    });
  }

  const fileListContainer = container.querySelector('#archiveInspectFileList');
  const searchInput = container.querySelector('#archiveInspectSearchInput');

  let fileListUnsubscribers = [];
  fileListUnsubscribers = renderFileList(data, fileListContainer, effectiveUrl, '', fileListUnsubscribers);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      fileListUnsubscribers = renderFileList(data, fileListContainer, effectiveUrl, searchInput.value, fileListUnsubscribers);
    });
  }
}

/**
 * Opens the archive inspection modal and runs analysis via fetchArchiveInspect.
 * @param {string} url
 * @param {string} name
 */
export async function openArchiveInspectModal(url, name) {
  const modal = document.getElementById('archiveInspectModal');
  const bodyEl = document.getElementById('archiveInspectBody');
  if (!modal || !bodyEl) return;

  const cleanName = name || (url.split('?')[0].split('/').pop()) || 'archive.zip';
  modal.style.display = 'flex';
  haptic(10);

  bodyEl.innerHTML = `
    <div class="archive-inspect-loading">
      <div class="loading-spinner"></div>
      <div class="archive-inspect-loading-text" id="archiveInspectStatusText">${t('vw.inspectScanning', 'Подготовка архива...')}</div>
      <div class="archive-inspect-progress-wrap" id="archiveInspectProgressWrap">
        <div class="archive-inspect-progress-bar-track">
          <div class="archive-inspect-progress-bar-fill" id="archiveInspectProgressBar" style="width: 5%;"></div>
        </div>
        <div class="archive-inspect-progress-details">
          <span id="archiveInspectProgressPct">0%</span>
          <span id="archiveInspectProgressBytes">${t('vw.inspectingPhase', 'Инициализация...')}</span>
        </div>
      </div>
      <div class="archive-inspect-loading-sub">${cleanName}</div>
    </div>
  `;

  notifyArchiveJob(url, { active: true, action: 'inspect', phase: 'inspect', percent: 5 });
  startArchivePolling(url);

  const unsubscribe = subscribeArchiveJob(url, (status) => {
    if (!status) return;
    const wrap = document.getElementById('archiveInspectProgressWrap');
    const bar = document.getElementById('archiveInspectProgressBar');
    const statusText = document.getElementById('archiveInspectStatusText');
    const pctEl = document.getElementById('archiveInspectProgressPct');
    const bytesEl = document.getElementById('archiveInspectProgressBytes');
    if (wrap) wrap.style.display = 'block';

    if (status.active) {
      if (status.phase === 'download') {
        if (statusText) statusText.textContent = t('vw.archiveDownloading', 'Загрузка архива на сервер...');
        const pct = Math.max(5, status.percent || (status.total > 0 ? Math.min(100, Math.round((status.received / status.total) * 100)) : 5));
        if (bar) bar.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (bytesEl && status.received) {
          const recMb = (status.received / (1024 * 1024)).toFixed(1);
          const totMb = status.total > 0 ? (status.total / (1024 * 1024)).toFixed(1) + ' MB' : '';
          bytesEl.textContent = totMb ? `${recMb} / ${totMb}` : `${recMb} MB`;
        }
      } else if (status.phase === 'inspect' || status.phase === 'extract') {
        const pct = Math.max(10, status.percent || 15);
        if (bar) bar.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (status.totalFiles > 0) {
          if (statusText) statusText.textContent = `${t('vw.inspectScanning', 'Анализ файлов')}: ${status.scannedFiles || 0} / ${status.totalFiles} (${pct}%)`;
          if (bytesEl) bytesEl.textContent = status.currentFile ? status.currentFile.split('/').pop() : t('vw.inspectingPhase', 'Сканирование...');
        } else {
          if (statusText) statusText.textContent = t('vw.archiveAnalyzing', 'Анализ файлов, поиск ссылок и PDF...');
          if (bytesEl) bytesEl.textContent = t('vw.inspectingPhase', 'Сканирование...');
        }
      }
    } else if (status.completed) {
      if (bar) bar.style.width = '100%';
      if (pctEl) pctEl.textContent = '100%';
      if (bytesEl) bytesEl.textContent = t('vw.inspectedDone', 'Завершено ✓');
      if (statusText) statusText.textContent = t('vw.archiveAnalyzingDone', 'Анализ завершен');
    }
  });

  try {
    const result = await fetchArchiveInspect(url);
    stopArchivePolling(url);
    unsubscribe();
    notifyArchiveJob(url, { active: false, action: 'inspect', completed: true, phase: 'inspected', summary: result });

    function renderInspectError(errMsg) {
      const isKemonoBlocked = (url.includes('kemono.cr') || url.includes('kemono.su')) &&
        (errMsg.includes('Сервер архивов недоступен') || errMsg.includes('прокси') || errMsg.includes('fetch failed'));

      bodyEl.innerHTML = `
        <div class="archive-inspect-error" style="text-align: center; padding: 20px 14px;">
          <div class="archive-inspect-error-msg" style="margin-bottom: 16px; line-height: 1.5;">${errMsg}</div>
          <div class="archive-inspect-error-actions" style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn-secondary btn-sm" id="btnRetryArchiveInspect">${t('vw.retry', 'Повторить попытку')}</button>
            <a href="${url}" download="${cleanName}" target="_blank" rel="noopener noreferrer" class="btn-primary btn-sm" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              ${t('vw.downloadDirectly', 'Скачать напрямую')}
            </a>
            ${isKemonoBlocked ? `
              <button type="button" class="btn-secondary btn-sm" id="btnOpenProxySettings" style="display: inline-flex; align-items: center; gap: 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                ${t('vw.setupProxy', 'Настроить прокси')}
              </button>
            ` : ''}
          </div>
        </div>
      `;

      const retryBtn = bodyEl.querySelector('#btnRetryArchiveInspect');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => openArchiveInspectModal(url, name));
      }

      const proxyBtn = bodyEl.querySelector('#btnOpenProxySettings');
      if (proxyBtn) {
        proxyBtn.addEventListener('click', () => {
          closeArchiveInspectModal();
          openSettingsModal();
          switchSettingsTab('proxy');
          setTimeout(() => {
            document.getElementById('inputKemonoProxy')?.focus();
          }, 250);
        });
      }
    }

    if (!result || !result.success) {
      const errMsg = result?.error || t('vw.inspectFailed', 'Не удалось проанализировать архив');
      renderInspectError(errMsg);
      return;
    }

    renderInspectResults(result, cleanName, bodyEl, url);

    // Feedback toast with clear details
    const totalFiles = result.totalFiles || (result.fileTree ? result.fileTree.length : 0);
    const mediaCount = (result.fileTree || []).filter(f => f.isMedia).length;
    if (Array.isArray(result.scannedLinks) && result.scannedLinks.length > 0) {
      showToast(`${t('vw.inspectFoundLinksToast', 'В архиве найдено ссылок')}: ${result.scannedLinks.length}`);
    } else if (mediaCount > 0) {
      showToast(`${t('vw.inArchive', 'В архиве')}: ${mediaCount} ${t('vw.mediaFilesCount', 'медиафайлов')}, ${t('vw.noExternalLinks', 'внешних ссылок нет')}`);
    } else {
      showToast(`${t('vw.inspectDoneToast', 'Архив проверен')}: ${totalFiles} ${t('vw.filesCountShort', 'файлов')}, ${t('vw.noExternalLinks', 'внешних ссылок нет')}`);
    }

    // If cloud links were found in the archive, update post & sidebar
    const currentPost = archiveInspectContext?.getCurrentPost?.();
    if (Array.isArray(result.scannedLinks) && result.scannedLinks.length > 0 && currentPost) {
      if (!currentPost.inspectedLinks) currentPost.inspectedLinks = [];
      for (const sl of result.scannedLinks) {
        if (!currentPost.inspectedLinks.some(x => x.url === sl.url)) {
          currentPost.inspectedLinks.push(sl);
        }
      }
      const updatedCloud = renderSidebarCloudLinks(currentPost);
      renderSidebarContent(currentPost, (updatedCloud || []).map(l => l.url));
    }
  } catch (err) {
    stopArchivePolling(url);
    unsubscribe();
    notifyArchiveJob(url, { active: false, action: 'inspect', error: err.message, phase: 'inspected' });
    const modalStillOpen = isArchiveInspectModalOpen();
    if (modalStillOpen) {
      bodyEl.innerHTML = `
        <div class="archive-inspect-error" style="text-align: center; padding: 20px 14px;">
          <div class="archive-inspect-error-msg" style="margin-bottom: 16px; line-height: 1.5;">${err.message || t('vw.inspectFailed', 'Не удалось проанализировать архив')}</div>
          <button type="button" class="btn-secondary btn-sm" id="btnRetryArchiveInspect">${t('vw.retry', 'Повторить попытку')}</button>
        </div>
      `;
      bodyEl.querySelector('#btnRetryArchiveInspect')?.addEventListener('click', () => openArchiveInspectModal(url, name));
    }
  }
}
