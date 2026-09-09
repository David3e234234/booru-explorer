import { fetchArchiveList, fetchArchiveStatus } from '../api.js';
import { downloadManager } from '../modules/downloadManager.js';
import { showToast } from '../modules/uiUtils.js';
import { state } from '../state.js';
import { t } from '../i18n.js';
import { unpackAndViewArchive, openArchiveInspectModal } from './viewerArchiveInspect.js';

export const activeArchiveDownloads = new Map();

// Reactive tracker for archive server jobs (downloading / extracting / inspecting)
export const activeArchiveJobs = new Map(); // url -> { active, phase, percent, received, total, error, completed }
export const archiveJobListeners = new Map(); // url -> Set of callbacks
export const activeArchivePollers = new Map(); // url -> intervalId

export const ARCHIVE_PLAY_ICON_SVG = `<svg class="btn-archive-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
export const ARCHIVE_SEARCH_ICON_SVG = `<svg class="btn-archive-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
export const ARCHIVE_SPINNER_ICON_SVG = `<svg class="btn-archive-icon btn-archive-spinner" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="38" stroke-dashoffset="12"/></svg>`;
export const ARCHIVE_CHECK_ICON_SVG = `<svg class="btn-archive-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>`;

/**
 * Subscribes to reactive job updates for a given archive URL.
 * @param {string} url
 * @param {Function} callback
 * @returns {Function} Unsubscribe function.
 */
export function subscribeArchiveJob(url, callback) {
  if (!url || typeof callback !== 'function') return () => {};
  if (!archiveJobListeners.has(url)) {
    archiveJobListeners.set(url, new Set());
  }
  const set = archiveJobListeners.get(url);
  set.add(callback);

  const cur = activeArchiveJobs.get(url);
  if (cur) {
    try { callback(cur); } catch {}
  }

  return () => {
    set.delete(callback);
    if (set.size === 0) archiveJobListeners.delete(url);
  };
}

/**
 * Updates status of an archive job and notifies active listeners.
 * @param {string} url
 * @param {Object} jobState
 */
export function notifyArchiveJob(url, jobState) {
  if (!url) return;
  const prev = activeArchiveJobs.get(url) || {};
  const action = jobState.action || prev.action || 'view';
  const next = { ...prev, ...jobState, action };
  if (jobState.active === false && !jobState.completed && !jobState.error) {
    activeArchiveJobs.delete(url);
  } else {
    activeArchiveJobs.set(url, next);
  }
  const listeners = archiveJobListeners.get(url);
  if (listeners) {
    for (const cb of listeners) {
      try { cb(next); } catch (e) { console.warn(e); }
    }
  }
}

/**
 * Starts periodic status polling for an active archive extraction/download job.
 * @param {string} url
 */
export function startArchivePolling(url) {
  if (!url || activeArchivePollers.has(url)) return;

  const poll = async () => {
    try {
      const status = await fetchArchiveStatus(url);
      if (status) {
        if (status.active) {
          const pct = status.percent !== undefined
            ? status.percent
            : (status.total > 0 ? Math.min(100, Math.round((status.received / status.total) * 100)) : 0);
          notifyArchiveJob(url, {
            active: true,
            phase: status.phase,
            received: status.received || 0,
            total: status.total || 0,
            percent: pct,
            extractedFiles: status.extractedFiles || 0,
            scannedFiles: status.scannedFiles || 0,
            totalFiles: status.totalFiles || 0,
            currentFile: status.currentFile || ''
          });
        } else if (status.completed) {
          notifyArchiveJob(url, {
            active: false,
            completed: true,
            phase: status.phase || 'completed',
            percent: 100,
            extractedFiles: status.extractedFiles || 0,
            totalFiles: status.totalFiles || 0
          });
          stopArchivePolling(url);
        }
      }
    } catch {}
  };

  poll();
  const id = setInterval(poll, 300);
  activeArchivePollers.set(url, id);
}

/**
 * Stops status polling for an archive job.
 * @param {string} url
 */
export function stopArchivePolling(url) {
  if (!url) return;
  const id = activeArchivePollers.get(url);
  if (id) {
    clearInterval(id);
    activeArchivePollers.delete(url);
  }
}

/**
 * Cancels and aborts all active archive downloads and uncompressions.
 */
export function cancelAllArchiveDownloads() {
  if (activeArchiveDownloads && activeArchiveDownloads.size > 0) {
    activeArchiveDownloads.forEach((ctrl) => {
      try { ctrl.abort(); } catch {}
    });
    activeArchiveDownloads.clear();
  }
}

/**
 * Helper to format byte count into human-readable representation.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Creates a reactive archive card component with live progress bars,
 * download speeds, unpacking counter, and inspection states.
 * @param {Object} param0
 * @param {string} param0.url
 * @param {string} [param0.name]
 * @param {number} [param0.size=0]
 * @param {boolean} [param0.isSidebar=false]
 * @param {Function} [param0.onUnpack]
 * @param {Function} [param0.onInspect]
 * @returns {HTMLDivElement}
 */
export function createArchiveCardComponent({ url, name, size = 0, isSidebar = false, onUnpack, onInspect }) {
  const card = document.createElement('div');
  card.className = 'sidebar-archive-card';
  card.dataset.url = url;

  const cleanName = name || (url.split('?')[0].split('/').pop()) || 'archive.zip';
  const displaySize = size > 0 ? formatBytes(size) : '';

  card.innerHTML = `
    <div class="sidebar-archive-card-header">
      <div class="sidebar-archive-file-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 8v13H3V8"/>
          <path d="M1 3h22v5H1z"/>
          <path d="M10 12h4"/>
        </svg>
      </div>
      <div class="sidebar-archive-file-info">
        <div class="sidebar-archive-filename" title="${cleanName}">${cleanName}</div>
        <div class="sidebar-archive-filesize">${displaySize || t('vw.archiveZip', 'ZIP-архив')}</div>
      </div>
    </div>

    <div class="sidebar-archive-actions">
      <button type="button" class="btn-archive-pill btn-archive-pill-download" title="${t('viewer.downloadArchiveTitle', 'Скачать архив на устройство')}">
        <div class="btn-archive-progress-fill" style="width: 0%;"></div>
        <span class="btn-archive-pill-content">
          <svg class="btn-archive-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span class="btn-archive-pill-text">${t('viewer.downloadArchive', 'Скачать')}</span>
        </span>
      </button>
      <button type="button" class="btn-archive-pill btn-archive-pill-view" title="${t('viewer.viewArchiveTitle', 'Распаковать и просмотреть в галерее')}">
        <div class="btn-archive-progress-fill" style="width: 0%;"></div>
        <span class="btn-archive-pill-content">
          <svg class="btn-archive-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span class="btn-archive-pill-text">${t('viewer.viewArchive', 'Просмотр')}</span>
        </span>
      </button>
      <button type="button" class="btn-archive-pill btn-archive-pill-inspect" title="${t('viewer.inspectArchiveTitle', 'Проверить содержимое архива (файлы, ссылки, пароли)')}">
        <div class="btn-archive-progress-fill" style="width: 0%;"></div>
        <span class="btn-archive-pill-content">
          <svg class="btn-archive-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span class="btn-archive-pill-text">${t('viewer.inspectArchive', 'Проверить архив')}</span>
        </span>
      </button>
    </div>

    <div class="sidebar-archive-live-status" style="display: none;">
      <div class="sidebar-archive-live-bar-track">
        <div class="sidebar-archive-live-bar-fill" style="width: 0%;"></div>
      </div>
      <div class="sidebar-archive-live-info">
        <span class="sidebar-archive-live-phase"></span>
        <span class="sidebar-archive-live-pct">0%</span>
      </div>
    </div>

    <div class="sidebar-archive-summary" style="display: none;"></div>
  `;

  const btnDownload = card.querySelector('.btn-archive-pill-download');
  const btnView = card.querySelector('.btn-archive-pill-view');
  const btnInspect = card.querySelector('.btn-archive-pill-inspect');

  const liveStatus = card.querySelector('.sidebar-archive-live-status');
  const liveBarFill = card.querySelector('.sidebar-archive-live-bar-fill');
  const livePhase = card.querySelector('.sidebar-archive-live-phase');
  const livePct = card.querySelector('.sidebar-archive-live-pct');
  const summaryEl = card.querySelector('.sidebar-archive-summary');

  const dlFill = btnDownload.querySelector('.btn-archive-progress-fill');
  const dlText = btnDownload.querySelector('.btn-archive-pill-text');
  const dlIcon = btnDownload.querySelector('.btn-archive-icon');

  const viewFill = btnView.querySelector('.btn-archive-progress-fill');
  const viewText = btnView.querySelector('.btn-archive-pill-text');
  const viewIcon = btnView.querySelector('.btn-archive-icon');

  const inspFill = btnInspect.querySelector('.btn-archive-progress-fill');
  const inspText = btnInspect.querySelector('.btn-archive-pill-text');
  const inspIcon = btnInspect.querySelector('.btn-archive-icon');

  let serverUnpackAbortController = null;
  let isServerUnpacking = false;
  let resetTimer = null;

  const triggerUnpack = () => {
    if (typeof onUnpack === 'function') {
      onUnpack(url, cleanName);
    } else {
      unpackAndViewArchive(url, cleanName);
    }
  };

  const triggerInspect = () => {
    if (typeof onInspect === 'function') {
      onInspect(url, cleanName);
    } else {
      openArchiveInspectModal(url, cleanName);
    }
  };

  const renderSummary = (data) => {
    if (!summaryEl || !data) return;
    const totalFiles = data.totalFiles || (data.fileTree ? data.fileTree.length : 0);
    const links = data.scannedLinks || [];
    const fileTree = data.fileTree || [];
    const videos = fileTree.filter(f => /\.(mp4|webm|mov|mkv|avi|flv)$/i.test(f.name || ''));
    const images = fileTree.filter(f => /\.(jpe?g|png|gif|webp|avif)$/i.test(f.name || ''));
    const sizeMb = (data.archiveSize || data.totalBytes)
      ? (Number(data.archiveSize || data.totalBytes) / (1024 * 1024)).toFixed(1) + ' MB'
      : '';

    let descText = '';
    let iconHtml = '📁';
    if (links.length > 0) {
      iconHtml = '🔗';
      const services = [...new Set(links.map(l => l.service || l.name || 'Облако'))].slice(0, 2).join(', ');
      descText = `${t('vw.linksFoundSummary', 'Найдено ссылок')}: ${links.length} (${services})`;
      summaryEl.className = 'sidebar-archive-summary has-links';
    } else if (videos.length > 0 && images.length === 0) {
      descText = `${t('vw.inArchive', 'В архиве')}: ${videos.length} ${t('vw.videosShort', 'видео')}${sizeMb ? ` (${sizeMb})` : ''}. ${t('vw.noExternalLinks', 'Внешних ссылок нет.')}`;
      summaryEl.className = 'sidebar-archive-summary';
    } else if (images.length > 0 && videos.length === 0) {
      descText = `${t('vw.inArchive', 'В архиве')}: ${images.length} ${t('vw.imagesShort', 'изображений')}${sizeMb ? ` (${sizeMb})` : ''}. ${t('vw.noExternalLinks', 'Внешних ссылок нет.')}`;
      summaryEl.className = 'sidebar-archive-summary';
    } else if (totalFiles > 0) {
      descText = `${t('vw.inArchive', 'В архиве')}: ${totalFiles} ${t('vw.filesCountShort', 'файлов')}${sizeMb ? ` (${sizeMb})` : ''}. ${t('vw.noExternalLinks', 'Внешних ссылок нет.')}`;
      summaryEl.className = 'sidebar-archive-summary';
    } else {
      descText = t('vw.archiveEmptySummary', 'В архиве нет файлов или ссылок.');
      summaryEl.className = 'sidebar-archive-summary';
    }

    const canOpen = Boolean(data.hasMedia || videos.length > 0 || images.length > 0);

    summaryEl.innerHTML = `
      <div class="sidebar-archive-summary-header">
        <span class="sidebar-archive-summary-icon">${iconHtml}</span>
        <span class="sidebar-archive-summary-text">${descText}</span>
      </div>
      <div class="sidebar-archive-summary-actions">
        ${canOpen ? `<button type="button" class="btn-archive-summary-action btn-summary-open">${t('viewer.viewArchive', 'Просмотр')}</button>` : ''}
        <button type="button" class="btn-archive-summary-action btn-summary-details">${t('vw.details', 'Детали')}</button>
      </div>
    `;
    summaryEl.style.display = 'flex';

    const openBtn = summaryEl.querySelector('.btn-summary-open');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerUnpack();
      });
    }
    const detailsBtn = summaryEl.querySelector('.btn-summary-details');
    if (detailsBtn) {
      detailsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerInspect();
      });
    }
  };

  const resetToDefault = () => {
    btnDownload.className = 'btn-archive-pill btn-archive-pill-download';
    btnView.className = 'btn-archive-pill btn-archive-pill-view';
    btnInspect.className = 'btn-archive-pill btn-archive-pill-inspect';

    if (dlFill) dlFill.style.width = '0%';
    if (viewFill) viewFill.style.width = '0%';
    if (inspFill) inspFill.style.width = '0%';

    if (dlText) dlText.textContent = t('viewer.downloadArchive', 'Скачать');
    if (viewText) viewText.textContent = t('viewer.viewArchive', 'Просмотр');
    if (inspText) inspText.textContent = t('viewer.inspectArchive', 'Проверить архив');

    if (dlIcon) dlIcon.outerHTML = `<svg class="btn-archive-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    if (viewIcon) viewIcon.outerHTML = `<svg class="btn-archive-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    if (inspIcon) inspIcon.outerHTML = `<svg class="btn-archive-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

    if (liveStatus) {
      liveStatus.style.display = 'none';
      liveStatus.className = 'sidebar-archive-live-status';
    }
    if (liveBarFill) liveBarFill.style.width = '0%';

    isServerUnpacking = false;
    serverUnpackAbortController = null;
  };

  // 1. Subscribe to downloadManager for direct browser streaming downloads
  downloadManager.subscribeToUrl(url, (task) => {
    if (!task || isServerUnpacking) return;
    clearTimeout(resetTimer);

    if (task.status === 'downloading' || task.status === 'saving') {
      btnDownload.classList.remove('is-completed', 'is-error');
      btnDownload.classList.add('is-downloading');

      const curIcon = btnDownload.querySelector('.btn-archive-icon');
      if (curIcon && !curIcon.classList.contains('btn-archive-spinner')) {
        curIcon.outerHTML = ARCHIVE_SPINNER_ICON_SVG;
      }

      const pct = Math.round(task.percent || 0);
      if (dlFill) dlFill.style.width = `${pct}%`;

      if (liveStatus) {
        liveStatus.style.display = 'flex';
        liveStatus.className = 'sidebar-archive-live-status';
      }
      if (liveBarFill) liveBarFill.style.width = `${pct}%`;
      if (livePct) livePct.textContent = `${pct}%`;

      const loadedMb = (task.loaded / (1024 * 1024)).toFixed(1);
      const totalMb = task.total > 0 ? (task.total / (1024 * 1024)).toFixed(1) + ' MB' : '';

      if (task.status === 'saving') {
        if (dlText) dlText.textContent = t('dl.saving', 'Сохранение...');
        if (livePhase) livePhase.textContent = t('dl.saving', 'Сохранение файла на устройство...');
      } else {
        const speedText = task.speed > 0 ? ` · ${formatBytes(task.speed)}/s` : '';
        if (dlText) dlText.textContent = `${pct}%`;
        if (livePhase) {
          livePhase.textContent = totalMb
            ? `${t('vw.downloading', 'Загрузка')}: ${loadedMb} / ${totalMb}${speedText}`
            : `${t('vw.downloading', 'Загрузка')}: ${loadedMb} MB${speedText}`;
        }
      }
    } else if (task.status === 'completed') {
      btnDownload.classList.remove('is-downloading', 'is-error');
      btnDownload.classList.add('is-completed');
      if (dlFill) dlFill.style.width = '100%';
      if (dlText) dlText.textContent = t('vw.archiveDownloadedShort', 'Скачано ✓');
      const curIcon = btnDownload.querySelector('.btn-archive-icon');
      if (curIcon) curIcon.outerHTML = ARCHIVE_CHECK_ICON_SVG;

      if (liveStatus) {
        liveStatus.style.display = 'flex';
        liveStatus.className = 'sidebar-archive-live-status is-completed';
      }
      if (liveBarFill) liveBarFill.style.width = '100%';
      if (livePct) livePct.textContent = '100%';
      if (livePhase) livePhase.textContent = t('dl.toastSaved', 'Архив сохранён на устройство ✓');

      resetTimer = setTimeout(resetToDefault, 4000);
    } else if (task.status === 'error') {
      btnDownload.classList.remove('is-downloading');
      btnDownload.classList.add('is-error');
      if (dlFill) dlFill.style.width = '0%';
      if (dlText) dlText.textContent = t('vw.error', 'Ошибка');

      if (liveStatus) {
        liveStatus.style.display = 'flex';
        liveStatus.className = 'sidebar-archive-live-status is-error';
      }
      if (livePhase) livePhase.textContent = task.errorMessage || t('dl.error', 'Ошибка скачивания');
      resetTimer = setTimeout(resetToDefault, 4000);
    } else if (task.status === 'cancelled') {
      resetToDefault();
    }
  });

  // 2. Subscribe to centralized archive job tracker (server unpacking / inspection)
  subscribeArchiveJob(url, (jobState) => {
    if (!jobState) return;
    clearTimeout(resetTimer);

    if (jobState.summary) {
      renderSummary(jobState.summary);
    }

    if (jobState.active) {
      if (liveStatus) {
        liveStatus.style.display = 'flex';
        liveStatus.className = 'sidebar-archive-live-status';
      }

      const pct = Math.max(5, jobState.percent || 0);
      if (liveBarFill) liveBarFill.style.width = `${pct}%`;
      if (livePct) livePct.textContent = `${pct}%`;

      if (jobState.phase === 'download') {
        const isInspectDownload = jobState.action === 'inspect';
        if (isInspectDownload) {
          btnInspect.classList.remove('is-completed', 'is-error');
          btnInspect.classList.add('is-inspecting');
          const iIcon = btnInspect.querySelector('.btn-archive-icon');
          if (iIcon && !iIcon.classList.contains('btn-archive-spinner')) {
            iIcon.outerHTML = ARCHIVE_SPINNER_ICON_SVG;
          }
          if (inspFill) inspFill.style.width = `${pct}%`;
          if (inspText) inspText.textContent = `${pct}%`;

          // Keep btnView clean in its idle state
          btnView.classList.remove('is-downloading', 'is-extracting', 'is-completed', 'is-error');
          if (viewFill) viewFill.style.width = '0%';
          if (viewText) viewText.textContent = t('viewer.viewArchive', 'Просмотр');
          const vIcon = btnView.querySelector('.btn-archive-icon');
          if (vIcon && vIcon.classList.contains('btn-archive-spinner')) {
            vIcon.outerHTML = ARCHIVE_PLAY_ICON_SVG;
          }
        } else {
          btnView.classList.remove('is-completed', 'is-error', 'is-extracting');
          btnView.classList.add('is-downloading');
          const vIcon = btnView.querySelector('.btn-archive-icon');
          if (vIcon && !vIcon.classList.contains('btn-archive-spinner')) {
            vIcon.outerHTML = ARCHIVE_SPINNER_ICON_SVG;
          }
          if (viewFill) viewFill.style.width = `${pct}%`;
          if (viewText) viewText.textContent = `${pct}%`;

          // Keep btnInspect clean
          btnInspect.classList.remove('is-inspecting');
          if (inspFill) inspFill.style.width = '0%';
          if (inspText) inspText.textContent = t('viewer.inspectArchive', 'Проверить архив');
          const iIcon = btnInspect.querySelector('.btn-archive-icon');
          if (iIcon && iIcon.classList.contains('btn-archive-spinner')) {
            iIcon.outerHTML = ARCHIVE_SEARCH_ICON_SVG;
          }
        }

        const recMb = (jobState.received / (1024 * 1024)).toFixed(1);
        const totMb = jobState.total > 0 ? (jobState.total / (1024 * 1024)).toFixed(1) + ' MB' : '';
        if (livePhase) {
          const label = isInspectDownload
            ? t('vw.archiveDownloadingInspect', 'Скачивание для проверки')
            : t('vw.archiveDownloading', 'Загрузка на сервер');
          livePhase.textContent = totMb
            ? `${label}: ${recMb} / ${totMb} (${pct}%)`
            : `${label}: ${recMb} MB`;
        }
      } else if (jobState.phase === 'extract') {
        btnView.classList.remove('is-completed', 'is-error', 'is-downloading');
        btnView.classList.add('is-extracting');
        const vIcon = btnView.querySelector('.btn-archive-icon');
        if (vIcon && !vIcon.classList.contains('btn-archive-spinner')) {
          vIcon.outerHTML = ARCHIVE_SPINNER_ICON_SVG;
        }
        if (viewFill) viewFill.style.width = `${pct}%`;
        if (viewText) viewText.textContent = `${pct}%`;

        btnInspect.classList.remove('is-inspecting');
        if (inspFill) inspFill.style.width = '0%';
        if (inspText) inspText.textContent = t('viewer.inspectArchive', 'Проверить архив');
        const iIcon = btnInspect.querySelector('.btn-archive-icon');
        if (iIcon && iIcon.classList.contains('btn-archive-spinner')) {
          iIcon.outerHTML = ARCHIVE_SEARCH_ICON_SVG;
        }

        if (livePhase) {
          if (jobState.totalFiles > 0) {
            const fileHint = jobState.currentFile ? ` · ${jobState.currentFile}` : '';
            livePhase.textContent = `${t('vw.archiveExtracting', 'Распаковка')}: ${jobState.extractedFiles || 0} / ${jobState.totalFiles} файлов (${pct}%)${fileHint}`;
          } else {
            livePhase.textContent = t('vw.archiveExtracting', 'Распаковка архива на сервере...');
          }
        }
      } else if (jobState.phase === 'inspect') {
        btnInspect.classList.remove('is-completed', 'is-error');
        btnInspect.classList.add('is-inspecting');
        const iIcon = btnInspect.querySelector('.btn-archive-icon');
        if (iIcon && !iIcon.classList.contains('btn-archive-spinner')) {
          iIcon.outerHTML = ARCHIVE_SPINNER_ICON_SVG;
        }
        if (inspFill) inspFill.style.width = `${pct}%`;
        if (inspText) inspText.textContent = `${pct}%`;

        btnView.classList.remove('is-downloading', 'is-extracting', 'is-completed', 'is-error');
        if (viewFill) viewFill.style.width = '0%';
        if (viewText) viewText.textContent = t('viewer.viewArchive', 'Просмотр');
        const vIcon = btnView.querySelector('.btn-archive-icon');
        if (vIcon && vIcon.classList.contains('btn-archive-spinner')) {
          vIcon.outerHTML = ARCHIVE_PLAY_ICON_SVG;
        }

        if (livePhase) {
          const fileHint = jobState.currentFile ? ` · ${jobState.currentFile}` : '';
          if (jobState.totalFiles > 0) {
            livePhase.textContent = `${t('vw.inspectScanning', 'Анализ')}: ${jobState.scannedFiles || 0} / ${jobState.totalFiles} файлов (${pct}%)${fileHint}`;
          } else {
            livePhase.textContent = `${t('vw.archiveAnalyzing', 'Анализ архива: поиск ссылок и файлов...')}${fileHint}`;
          }
        }
      }
    } else if (jobState.completed) {
      if (jobState.phase === 'unpack' || jobState.phase === 'extract' || jobState.phase === 'completed') {
        btnView.classList.remove('is-downloading', 'is-extracting');
        btnView.classList.add('is-completed');
        if (viewFill) viewFill.style.width = '100%';
        if (viewText) viewText.textContent = t('vw.openedInViewer', 'Открыто ✓');
        const vIcon = btnView.querySelector('.btn-archive-icon');
        if (vIcon) vIcon.outerHTML = ARCHIVE_CHECK_ICON_SVG;

        btnInspect.classList.remove('is-inspecting');
        if (inspFill) inspFill.style.width = '0%';
        if (inspText) inspText.textContent = t('viewer.inspectArchive', 'Проверить архив');
        const iIcon = btnInspect.querySelector('.btn-archive-icon');
        if (iIcon && iIcon.classList.contains('btn-archive-spinner')) {
          iIcon.outerHTML = ARCHIVE_SEARCH_ICON_SVG;
        }

        if (liveStatus) {
          liveStatus.style.display = 'flex';
          liveStatus.className = 'sidebar-archive-live-status is-completed';
        }
        if (liveBarFill) liveBarFill.style.width = '100%';
        if (livePct) livePct.textContent = '100%';
        if (livePhase) livePhase.textContent = t('vw.archiveOpenedInViewer', 'Архив распакован и открыт в галерее ✓');
        resetTimer = setTimeout(resetToDefault, 4000);
      } else if (jobState.phase === 'inspected') {
        btnInspect.classList.remove('is-inspecting');
        btnInspect.classList.add('is-completed');
        if (inspFill) inspFill.style.width = '100%';
        if (inspText) inspText.textContent = t('vw.inspectedDone', 'Проверено ✓');
        const iIcon = btnInspect.querySelector('.btn-archive-icon');
        if (iIcon) iIcon.outerHTML = ARCHIVE_CHECK_ICON_SVG;

        btnView.classList.remove('is-downloading', 'is-extracting', 'is-completed', 'is-error');
        if (viewFill) viewFill.style.width = '0%';
        if (viewText) viewText.textContent = t('viewer.viewArchive', 'Просмотр');
        const vIcon = btnView.querySelector('.btn-archive-icon');
        if (vIcon && vIcon.classList.contains('btn-archive-spinner')) {
          vIcon.outerHTML = ARCHIVE_PLAY_ICON_SVG;
        }

        if (liveStatus) {
          liveStatus.style.display = 'flex';
          liveStatus.className = 'sidebar-archive-live-status is-completed';
        }
        if (liveBarFill) liveBarFill.style.width = '100%';
        if (livePct) livePct.textContent = '100%';
        if (livePhase) livePhase.textContent = t('vw.inspectedDone', 'Проверено ✓');
        resetTimer = setTimeout(resetToDefault, 3500);
      }
    } else if (jobState.error) {
      if (liveStatus) {
        liveStatus.style.display = 'flex';
        liveStatus.className = 'sidebar-archive-live-status is-error';
      }
      if (livePhase) livePhase.textContent = jobState.error || t('vw.archiveFailed', 'Ошибка при обработке архива');
      resetTimer = setTimeout(resetToDefault, 4000);
    }
  });

  // Button event listeners
  btnDownload.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    const activeTask = downloadManager.getTaskByUrl(url);
    if (activeTask && (activeTask.status === 'downloading' || activeTask.status === 'saving')) {
      downloadManager.cancelDownload(activeTask.id);
      resetToDefault();
      return;
    }

    if (isServerUnpacking) {
      if (serverUnpackAbortController) {
        serverUnpackAbortController.abort();
      }
      resetToDefault();
      showToast(t('vw.downloadCancelled', 'Скачивание отменено'));
      return;
    }

    const isUnpackEnabled = state.settings?.unpackArchivesOnDownload === true;
    const isExtractable = /\.(zip|rar|7z)$/i.test(cleanName) || url.toLowerCase().includes('.zip');

    if (isUnpackEnabled && isExtractable) {
      isServerUnpacking = true;
      serverUnpackAbortController = new AbortController();
      activeArchiveDownloads.set(url, serverUnpackAbortController);

      notifyArchiveJob(url, { active: true, phase: 'download', percent: 5, received: 0, total: 0 });
      startArchivePolling(url);

      try {
        const res = await fetchArchiveList(url);
        stopArchivePolling(url);

        if (serverUnpackAbortController.signal.aborted) {
          resetToDefault();
          return;
        }

        if (res && res.success && Array.isArray(res.albumItems) && res.albumItems.length > 0) {
          notifyArchiveJob(url, { active: false, completed: true, phase: 'unpack', percent: 100 });
          if (livePhase) livePhase.textContent = t('vw.savingFiles', 'Сохранение файлов ({n})...').replace('{n}', String(res.albumItems.length));

          for (let i = 0; i < res.albumItems.length; i++) {
            if (serverUnpackAbortController.signal.aborted) break;
            const item = res.albumItems[i];
            const downloadUrl = `${item.fileUrl}&download=1`;
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = item.title || `file_${i + 1}.${item.fileExt || 'jpg'}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            if (res.albumItems.length > 1) {
              await new Promise(r => setTimeout(r, 200));
            }
          }

          showToast(t('vw.archiveExtractedAndSaved', 'Архив распакован, файлы ({n} шт.) сохранены на устройство').replace('{n}', String(res.albumItems.length)));
          return;
        }
      } catch (err) {
        stopArchivePolling(url);
        if (err.name === 'AbortError') {
          resetToDefault();
          return;
        }
      } finally {
        activeArchiveDownloads.delete(url);
      }
    }

    // Direct in-page streaming download
    downloadManager.startDownload({
      url,
      filename: cleanName,
      size: Number(size) || 0,
      isZip: true
    });
  });

  btnView.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerUnpack();
  });

  btnInspect.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerInspect();
  });

  return card;
}

/**
 * Renders an archive post card in place of image/video inside viewerMediaWrapper.
 * @param {Object} targetPost
 * @param {HTMLElement} [mediaWrapper]
 */
export function renderArchivePostCard(targetPost, mediaWrapper) {
  const wrapper = mediaWrapper || document.getElementById('viewerMediaWrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'archive-post-card';

  const archiveCount = Array.isArray(targetPost.archiveUrls) ? targetPost.archiveUrls.length : 1;
  const descText = t('vw.archiveCardDesc', 'Пост содержит архив с материалами ({n} шт.). Нажмите кнопку ниже для сохранения на устройство.').replace('{n}', String(archiveCount));
  const titleText = targetPost.title || t('vw.archiveCardTitle', 'Архив файлов');

  card.innerHTML = `
    <div class="archive-card-icon-wrap">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 8v13H3V8"/>
        <path d="M1 3h22v5H1z"/>
        <path d="M10 12h4"/>
      </svg>
    </div>
    <div class="archive-card-header">
      <div class="archive-card-title">${titleText}</div>
      <div class="archive-card-desc">${descText}</div>
    </div>
    <div class="archive-card-buttons"></div>
  `;

  const buttonsContainer = card.querySelector('.archive-card-buttons');
  if (Array.isArray(targetPost.archiveUrls) && targetPost.archiveUrls.length > 0) {
    targetPost.archiveUrls.forEach((url, idx) => {
      const name = (Array.isArray(targetPost.archiveNames) && targetPost.archiveNames[idx]) || `archive_${idx + 1}.zip`;
      const size = (Array.isArray(targetPost.archiveSizes) && targetPost.archiveSizes[idx]) || 0;
      const archiveBlock = createArchiveCardComponent({ url, name, size, isSidebar: false });
      buttonsContainer.appendChild(archiveBlock);
    });
  }

  wrapper.appendChild(card);
}

/**
 * Renders the archives section in the viewer sidebar.
 * @param {Object} targetPost
 */
export function renderSidebarArchives(targetPost) {
  const section = document.getElementById('viewerSidebarArchivesSection');
  const countEl = document.getElementById('viewerSidebarArchivesCount');
  const listEl = document.getElementById('viewerSidebarArchivesList');
  if (!section || !listEl) return;

  if (!targetPost || !targetPost.isArchive || !Array.isArray(targetPost.archiveUrls) || targetPost.archiveUrls.length === 0) {
    section.style.display = 'none';
    listEl.innerHTML = '';
    return;
  }

  section.style.display = 'block';
  if (countEl) countEl.textContent = String(targetPost.archiveUrls.length);
  listEl.innerHTML = '';

  targetPost.archiveUrls.forEach((url, idx) => {
    const name = (Array.isArray(targetPost.archiveNames) && targetPost.archiveNames[idx]) || `archive_${idx + 1}.zip`;
    const size = (Array.isArray(targetPost.archiveSizes) && targetPost.archiveSizes[idx]) || 0;
    const archiveBlock = createArchiveCardComponent({ url, name, size, isSidebar: true });
    listEl.appendChild(archiveBlock);
  });
}
