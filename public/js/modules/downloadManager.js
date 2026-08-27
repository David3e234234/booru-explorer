import { getProxiedUrl } from '../api.js';
import { showToast, haptic } from './uiUtils.js';
import { t } from '../i18n.js';

// Central in-page download manager for MEGA-style background downloads
class DownloadManager {
  constructor() {
    this.tasks = new Map(); // id -> task
    this.urlToId = new Map(); // url -> id
    this.subscribers = new Set(); // listeners for task state changes
    this.isMinimized = false;
    this.containerEl = null;
    this.pillEl = null;
    this.panelEl = null;
    this.listEl = null;
    this.rafId = null;
    this.hasRendered = false;
  }

  init() {
    if (this.hasRendered) return;
    this.hasRendered = true;
    this._createDOM();
    this._attachEvents();
    this._render();
  }

  // Subscribe to all download changes: fn(task, eventType)
  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  // Subscribe to updates for a specific URL: fn(task)
  subscribeToUrl(url, fn) {
    const handler = (task) => {
      if (task.url === url) fn(task);
    };
    this.subscribers.add(handler);
    // Immediate callback if task already exists
    const currentTask = this.getTaskByUrl(url);
    if (currentTask) fn(currentTask);
    return () => this.subscribers.delete(handler);
  }

  _notify(task, eventType = 'update') {
    for (const fn of this.subscribers) {
      try { fn(task, eventType); } catch (e) { console.warn('[DM Sub Error]', e); }
    }
    this._scheduleRender();
  }

  getTaskByUrl(url) {
    const id = this.urlToId.get(url);
    return id ? this.tasks.get(id) : null;
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  getActiveTasks() {
    return Array.from(this.tasks.values()).filter(t => t.status === 'downloading' || t.status === 'saving');
  }

  // Starts an in-page streaming download
  startDownload({ url, filename, size = 0, isZip = true }) {
    if (!url) return null;

    // If already downloading this URL, expand dock and return existing task
    const existing = this.getTaskByUrl(url);
    if (existing && (existing.status === 'downloading' || existing.status === 'saving')) {
      this.isMinimized = false;
      this._scheduleRender();
      showToast(t('dl.alreadyDownloading', 'Файл уже скачивается'));
      return existing;
    }

    const id = 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const cleanFilename = filename || (isZip ? 'archive.zip' : 'file.bin');

    const abortController = new AbortController();

    const task = {
      id,
      url,
      filename: cleanFilename,
      size: Number(size) || 0,
      loaded: 0,
      total: Number(size) || 0,
      percent: 0,
      speed: 0, // bytes/sec
      eta: 0,   // seconds
      status: 'downloading', // 'downloading' | 'saving' | 'completed' | 'error' | 'cancelled'
      errorMessage: null,
      abortController,
      startTime: Date.now(),
      lastSpeedSampleTime: Date.now(),
      lastSpeedSampleLoaded: 0,
      speedSamples: [],
      createdAt: Date.now(),
      completedAt: null
    };

    this.tasks.set(id, task);
    this.urlToId.set(url, id);

    this.isMinimized = false;
    this._scheduleRender();
    this._notify(task, 'start');

    showToast(t('dl.toastStarted', 'Скачивание "{name}" начато на сайте').replace('{name}', cleanFilename));
    haptic(10);

    this._runStreamDownload(task);
    return task;
  }

  async _runStreamDownload(task) {
    const { url, abortController } = task;

    try {
      const targetUrl = getProxiedUrl(url);
      const res = await fetch(targetUrl, {
        signal: abortController.signal
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const clHeader = res.headers.get('content-length');
      if (clHeader) {
        const parsedTotal = parseInt(clHeader, 10);
        if (parsedTotal > 0) {
          task.total = parsedTotal;
          task.size = parsedTotal;
        }
      }

      if (!res.body) {
        throw new Error('ReadableStream not supported or empty body');
      }

      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;
        task.loaded = loaded;

        // Calculate progress %
        if (task.total > 0) {
          task.percent = Math.min(100, Math.max(0, (loaded / task.total) * 100));
        } else {
          // Fallback approximate progress if content-length was omitted
          task.percent = Math.min(96, (loaded / 10000000) * 100);
        }

        // Rolling speed calculation (sampled every ~300ms)
        const now = Date.now();
        const deltaMs = now - task.lastSpeedSampleTime;
        if (deltaMs >= 300) {
          const deltaLoaded = loaded - task.lastSpeedSampleLoaded;
          const currentSpeed = (deltaLoaded / deltaMs) * 1000; // bytes/sec

          task.speedSamples.push(currentSpeed);
          if (task.speedSamples.length > 5) task.speedSamples.shift();

          const avgSpeed = task.speedSamples.reduce((a, b) => a + b, 0) / task.speedSamples.length;
          task.speed = avgSpeed;

          if (task.total > loaded && avgSpeed > 0) {
            task.eta = Math.max(0, Math.round((task.total - loaded) / avgSpeed));
          } else {
            task.eta = 0;
          }

          task.lastSpeedSampleTime = now;
          task.lastSpeedSampleLoaded = loaded;
        }

        this._notify(task, 'progress');
      }

      // Stream fully downloaded into memory!
      task.status = 'saving';
      task.percent = 100;
      task.loaded = loaded;
      if (!task.total || task.total < loaded) task.total = loaded;
      this._notify(task, 'saving');

      // Construct Blob and trigger zero-wait instant browser save
      const mimeType = task.filename.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';
      const blob = new Blob(chunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = task.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Revoke blob URL after browser accepts it
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

      task.status = 'completed';
      task.completedAt = Date.now();
      task.speed = 0;
      task.eta = 0;

      this._notify(task, 'complete');
      haptic([15, 20]);
      showToast(t('dl.toastSaved', 'Архив "{name}" сохранён на устройство').replace('{name}', task.filename));

    } catch (err) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        task.status = 'cancelled';
      } else {
        console.warn('[DownloadManager stream error]', err);
        task.status = 'error';
        task.errorMessage = err.message || 'Error';
        showToast(t('dl.error', 'Ошибка скачивания') + `: ${task.filename}`);
      }
      task.speed = 0;
      task.eta = 0;
      this._notify(task, 'error');
    }
  }

  cancelDownload(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === 'downloading' || task.status === 'saving') {
      try {
        task.abortController.abort();
      } catch {}
      task.status = 'cancelled';
      task.speed = 0;
      task.eta = 0;
      haptic(10);
      showToast(t('vw.downloadCancelled', 'Скачивание отменено'));
      this._notify(task, 'cancelled');
    }
  }

  clearCompleted() {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'error') {
        this.urlToId.delete(task.url);
        this.tasks.delete(id);
      }
    }
    this._scheduleRender();
  }

  dismissTask(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === 'downloading' || task.status === 'saving') {
      this.cancelDownload(id);
    }
    this.urlToId.delete(task.url);
    this.tasks.delete(id);
    this._scheduleRender();
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    this._scheduleRender();
  }

  _scheduleRender() {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this._render();
    });
  }

  _formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 MB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  _formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '';
    const mb = bytesPerSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
    const kb = bytesPerSec / 1024;
    return `${kb.toFixed(0)} KB/s`;
  }

  _formatEta(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
    if (seconds < 60) return `~${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `~${m}m ${s}s`;
  }

  _createDOM() {
    const dock = document.createElement('div');
    dock.id = 'dlManagerDock';
    dock.className = 'dl-manager-dock';
    dock.style.display = 'none';

    dock.innerHTML = `
      <!-- Minimized Floating Pill -->
      <button type="button" class="dl-manager-pill" id="dlManagerPill" title="${t('dl.expand', 'Развернуть загрузки')}">
        <span class="dl-pill-spinner"></span>
        <svg class="dl-pill-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span class="dl-pill-badge" id="dlPillBadge">1</span>
        <span class="dl-pill-speed" id="dlPillSpeed"></span>
      </button>

      <!-- Expanded Main Panel -->
      <div class="dl-manager-panel" id="dlManagerPanel">
        <div class="dl-panel-header">
          <div class="dl-panel-title-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span class="dl-panel-title" data-i18n="dl.managerTitle">${t('dl.managerTitle', 'Загрузки на сайте')}</span>
            <span class="dl-panel-count-badge" id="dlPanelCountBadge">0</span>
          </div>
          <div class="dl-panel-actions">
            <button type="button" class="dl-panel-btn-action" id="dlBtnClearCompleted" title="${t('dl.clear', 'Очистить завершённые')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
            <button type="button" class="dl-panel-btn-action" id="dlBtnMinimize" title="${t('dl.minimize', 'Свернуть')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="dl-panel-list" id="dlPanelList"></div>
      </div>
    `;

    document.body.appendChild(dock);

    this.containerEl = dock;
    this.pillEl = dock.querySelector('#dlManagerPill');
    this.panelEl = dock.querySelector('#dlManagerPanel');
    this.listEl = dock.querySelector('#dlPanelList');
  }

  _attachEvents() {
    if (this.pillEl) {
      this.pillEl.addEventListener('click', () => {
        this.toggleMinimize();
      });
    }

    const btnMinimize = this.containerEl.querySelector('#dlBtnMinimize');
    if (btnMinimize) {
      btnMinimize.addEventListener('click', () => {
        this.toggleMinimize();
      });
    }

    const btnClear = this.containerEl.querySelector('#dlBtnClearCompleted');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.clearCompleted();
      });
    }

    // Delegated actions for item cards (cancel, dismiss)
    if (this.listEl) {
      this.listEl.addEventListener('click', (e) => {
        const btnCancel = e.target.closest('.dl-item-btn-cancel');
        if (btnCancel) {
          const id = btnCancel.dataset.taskId;
          if (id) this.cancelDownload(id);
          return;
        }

        const btnDismiss = e.target.closest('.dl-item-btn-dismiss');
        if (btnDismiss) {
          const id = btnDismiss.dataset.taskId;
          if (id) this.dismissTask(id);
          return;
        }
      });
    }
  }

  _render() {
    if (!this.containerEl) return;

    const allTasks = Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);

    if (allTasks.length === 0) {
      this.containerEl.style.display = 'none';
      return;
    }

    this.containerEl.style.display = 'block';

    const activeTasks = allTasks.filter(t => t.status === 'downloading' || t.status === 'saving');
    const totalActiveSpeed = activeTasks.reduce((acc, t) => acc + (t.speed || 0), 0);

    // Update minimized Pill
    if (this.isMinimized) {
      this.pillEl.style.display = 'inline-flex';
      this.panelEl.style.display = 'none';

      const badgeEl = this.pillEl.querySelector('#dlPillBadge');
      const speedEl = this.pillEl.querySelector('#dlPillSpeed');
      const spinnerEl = this.pillEl.querySelector('.dl-pill-spinner');

      if (badgeEl) badgeEl.textContent = String(activeTasks.length || allTasks.length);
      if (speedEl) speedEl.textContent = this._formatSpeed(totalActiveSpeed);
      if (spinnerEl) spinnerEl.style.display = activeTasks.length > 0 ? 'inline-block' : 'none';
      return;
    }

    // Expanded panel view
    this.pillEl.style.display = 'none';
    this.panelEl.style.display = 'flex';

    const countBadge = this.containerEl.querySelector('#dlPanelCountBadge');
    if (countBadge) {
      countBadge.textContent = activeTasks.length > 0 
        ? `${activeTasks.length}` 
        : t('dl.allDone', 'Все завершены');
      countBadge.classList.toggle('is-active', activeTasks.length > 0);
    }

    // Build items HTML
    this.listEl.innerHTML = allTasks.map(task => {
      const isProgressing = task.status === 'downloading' || task.status === 'saving';
      const isComplete = task.status === 'completed';
      const isError = task.status === 'error';
      const isCancelled = task.status === 'cancelled';

      const pct = Math.round(task.percent || 0);
      const loadedStr = this._formatBytes(task.loaded);
      const totalStr = task.total > 0 ? this._formatBytes(task.total) : '...';
      const speedStr = this._formatSpeed(task.speed);
      const etaStr = this._formatEta(task.eta);

      let statusBadgeHtml = '';
      if (isComplete) {
        statusBadgeHtml = `<span class="dl-item-badge is-success">${t('dl.saved', 'Сохранено ✓')}</span>`;
      } else if (task.status === 'saving') {
        statusBadgeHtml = `<span class="dl-item-badge is-saving">${t('dl.saving', 'Сохранение...')}</span>`;
      } else if (isError) {
        statusBadgeHtml = `<span class="dl-item-badge is-error">${t('dl.error', 'Ошибка')}</span>`;
      } else if (isCancelled) {
        statusBadgeHtml = `<span class="dl-item-badge is-cancelled">${t('dl.cancelled', 'Отменено')}</span>`;
      } else {
        statusBadgeHtml = `<span class="dl-item-badge is-active">${pct}%</span>`;
      }

      return `
        <div class="dl-item-card status-${task.status}" data-task-id="${task.id}">
          <div class="dl-item-header">
            <div class="dl-item-icon-wrap">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>
            <div class="dl-item-info">
              <div class="dl-item-name" title="${task.filename}">${task.filename}</div>
              <div class="dl-item-meta">
                ${loadedStr} / ${totalStr}
                ${speedStr ? `<span class="dl-meta-speed">· ${speedStr}</span>` : ''}
                ${etaStr ? `<span class="dl-meta-eta">· ${etaStr}</span>` : ''}
              </div>
            </div>
            <div class="dl-item-end">
              ${statusBadgeHtml}
              ${isProgressing ? `
                <button type="button" class="dl-item-btn-cancel" data-task-id="${task.id}" title="${t('dl.cancel', 'Отменить')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              ` : `
                <button type="button" class="dl-item-btn-dismiss" data-task-id="${task.id}" title="${t('modal.close.title', 'Убрать')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              `}
            </div>
          </div>

          <div class="dl-item-progress-track">
            <div class="dl-item-progress-bar" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

export const downloadManager = new DownloadManager();

export function initDownloadManager() {
  downloadManager.init();
}
