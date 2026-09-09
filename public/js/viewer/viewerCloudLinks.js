import { copyToClipboard, haptic, showToast } from '../modules/uiUtils.js';
import { t } from '../i18n.js';

export const CLOUD_PROVIDERS = [
  { id: 'gdrive', name: 'Google Drive', match: /drive\.google\.com/i },
  { id: 'mega', name: 'MEGA', match: /mega\.(?:nz|co\.nz)/i },
  { id: 'yandex', name: 'Яндекс Диск', match: /(?:disk\.yandex\.|yadi\.sk)/i },
  { id: 'dropbox', name: 'Dropbox', match: /dropbox\.com/i },
  { id: 'mediafire', name: 'MediaFire', match: /mediafire\.com/i },
  { id: 'terabox', name: 'TeraBox', match: /terabox(?:app)?\.com/i },
  { id: 'onedrive', name: 'OneDrive', match: /(?:onedrive\.live\.com|1drv\.ms)/i },
  { id: 'box', name: 'Box', match: /box\.com/i },
  { id: 'cloud', name: 'Облако', match: /(?:anonfiles\.com|gofile\.io|pixeldrain\.com|qiwi\.gg|catbox\.moe|workupload\.com|fastupload\.io)/i },
];

/**
 * Classifies whether a given URL points to a supported cloud storage provider.
 * @param {string} url
 * @returns {{ id: string, name: string, match: RegExp }|null}
 */
export function classifyCloudUrl(url) {
  if (!url || typeof url !== 'string') return null;
  for (const p of CLOUD_PROVIDERS) {
    if (p.match.test(url)) return p;
  }
  return null;
}

/**
 * Extracts password pattern from textual descriptions.
 * @param {string} text
 * @returns {string|null}
 */
export function extractPasswordFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/(?:pass(?:word)?|пароль|pwd|code|код)\s*[:=–—\-]\s*([^\s<>"'\n]+)/i);
  return m ? m[1].replace(/^[\[({"'`]+|[\])}"':;.,`]+$/g, '') : null;
}

/**
 * Extracts and deduplicates cloud links from post description and inspected metadata.
 * @param {Object} post
 * @returns {Array<{ url: string, name: string, id: string, password: string|null, sourceFile: string|null }>}
 */
export function extractCloudLinks(post) {
  const links = [];
  const seen = new Set();
  const rawText = String(post?.content || post?.description || '');
  const globalPassword = extractPasswordFromText(rawText);

  // Inspected links from downloaded/analyzed archive
  if (Array.isArray(post?.inspectedLinks)) {
    for (const l of post.inspectedLinks) {
      if (l && l.url && !seen.has(l.url)) {
        seen.add(l.url);
        links.push({
          url: l.url,
          name: l.service || 'Облако',
          id: l.serviceId || 'cloud',
          password: l.password || globalPassword || null,
          sourceFile: l.sourceFile || null
        });
      }
    }
  }

  // Pre-parsed cloud links
  if (Array.isArray(post?.cloudLinks)) {
    for (const l of post.cloudLinks) {
      if (l && l.url && !seen.has(l.url)) {
        seen.add(l.url);
        links.push({
          url: l.url,
          name: l.name || 'Облако',
          id: l.id || 'cloud',
          password: l.password || globalPassword || null,
          sourceFile: null
        });
      }
    }
  }

  // Extract from raw description/content
  if (rawText) {
    const urlMatches = rawText.match(/https?:\/\/[^\s<>"']+/gi) || [];
    for (const url of urlMatches) {
      const cleanUrl = url.replace(/[,;.)>]+$/, '');
      const svc = classifyCloudUrl(cleanUrl);
      if (svc && !seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        links.push({
          url: cleanUrl,
          name: svc.name,
          id: svc.id,
          password: globalPassword,
          sourceFile: null
        });
      }
    }
  }

  return links;
}

/**
 * Safely sanitizes and formats post HTML/plain content.
 * Strips script tags, unsafe attributes, and cloud URLs if rendered in cards.
 * @param {string} rawText
 * @param {string[]} [excludedCloudUrls=[]]
 * @returns {string} Safe HTML string.
 */
export function formatSafePostContent(rawText, excludedCloudUrls = []) {
  if (!rawText || typeof rawText !== 'string') return '';
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  const isHtml = /<[a-z][\s\S]*>/i.test(trimmed);

  if (isHtml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'text/html');
      const forbidden = doc.querySelectorAll('script, iframe, object, embed, style, form, input, button, svg, meta, link');
      forbidden.forEach(el => el.remove());

      const allElements = doc.body.querySelectorAll('*');
      allElements.forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          if (attr.name.startsWith('on') || attr.name.toLowerCase() === 'style') {
            el.removeAttribute(attr.name);
          }
        });
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') || '';
          if (/^(javascript:|data:|vbscript:)/i.test(href)) {
            el.removeAttribute('href');
          } else {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        }
      });

      // Strip cloud storage links and empty container blocks
      if (excludedCloudUrls.length > 0) {
        const excludedSet = new Set(excludedCloudUrls.map(u => u.toLowerCase()));
        const aTags = doc.body.querySelectorAll('a[href]');
        aTags.forEach(a => {
          const href = (a.getAttribute('href') || '').toLowerCase().replace(/[,;.)>]+$/, '');
          if (excludedSet.has(href) || classifyCloudUrl(href)) {
            const p = a.parentElement;
            if (p && (p.tagName === 'P' || p.tagName === 'DIV' || p.tagName === 'LI')) {
              const textRest = p.textContent.replace(a.textContent, '').trim();
              if (!textRest || textRest.length < 25) {
                p.remove();
                return;
              }
            }
            a.remove();
          }
        });

        // Strip standalone password blocks
        const pTags = doc.body.querySelectorAll('p, div');
        pTags.forEach(p => {
          const t = p.textContent.trim();
          if (/^(?:pass(?:word)?|пароль|pwd|code|код)\s*[:=–—\-]\s*[^\s<>"'\n]+$/i.test(t)) {
            p.remove();
          }
        });
      }

      // Clean up empty or redundant container blocks (<p><br></p>, <p>&nbsp;</p>, etc.)
      const blockTags = doc.body.querySelectorAll('p, div');
      blockTags.forEach(block => {
        const text = block.textContent.replace(/[\s\u00a0\u200B\u200C\u200D\uFEFF]+/g, '');
        const hasMedia = Boolean(block.querySelector('img, video, audio, a[href]'));
        if (!text && !hasMedia) {
          block.remove();
        }
      });

      // Verify that the parsed body contains visible text or links/media
      const textContent = doc.body.textContent.replace(/[\s\u00a0\u200B\u200C\u200D\uFEFF]+/g, '');
      const hasMediaOrLinks = Boolean(doc.body.querySelector('a[href], img, video, audio'));
      if (!textContent && !hasMediaOrLinks) {
        return '';
      }

      // Clean redundant consecutive <br> tags
      let inner = doc.body.innerHTML;
      inner = inner.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
      return inner.trim();
    } catch {}
  }

  const escapeHtml = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Normalize unicode whitespace
  let cleanText = trimmed.replace(/[\u00a0\u200B\u200C\u200D\uFEFF]/g, ' ');

  if (excludedCloudUrls.length > 0) {
    for (const u of excludedCloudUrls) {
      const escapedUrl = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lineRegex = new RegExp(`(?:^|\\n)[^\\n]*?${escapedUrl}[^\\n]*(?:\\n|$)`, 'gi');
      cleanText = cleanText.replace(lineRegex, '\n');
    }
    cleanText = cleanText.replace(/(?:^|\n)(?:pass(?:word)?|пароль|pwd|code|код)\s*[:=–—\-]\s*[^\s<>"'\n]+(?:\n|$)/gi, '\n');
  }

  if (!cleanText.trim()) return '';

  const escaped = escapeHtml(cleanText);
  const urlPattern = /(https?:\/\/[^\s<>"']+)/g;
  const withLinks = escaped.replace(urlPattern, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  const normalizedNewlines = withLinks.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n');
  return normalizedNewlines.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * Renders detected cloud links into the viewer sidebar.
 * @param {Object} targetPost
 * @returns {Array<Object>} List of rendered cloud links.
 */
export function renderSidebarCloudLinks(targetPost) {
  const section = document.getElementById('viewerSidebarCloudLinksSection');
  const countEl = document.getElementById('viewerSidebarCloudLinksCount');
  const listEl = document.getElementById('viewerSidebarCloudLinksList');
  if (!section || !listEl) return [];

  const links = extractCloudLinks(targetPost);
  if (!links || links.length === 0) {
    section.style.display = 'none';
    listEl.innerHTML = '';
    return [];
  }

  section.style.display = 'block';
  if (countEl) countEl.textContent = String(links.length);
  listEl.innerHTML = '';

  links.forEach(item => {
    const card = document.createElement('div');
    card.className = 'sidebar-cloud-card';

    let displayUrl = item.url;
    try {
      const parsed = new URL(item.url);
      displayUrl = parsed.hostname + (parsed.pathname.length > 24 ? parsed.pathname.slice(0, 24) + '…' : parsed.pathname);
    } catch {}

    card.innerHTML = `
      <div class="cloud-card-header">
        <span class="cloud-card-service-badge" data-service="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
          ${item.name}
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
          const original = span.textContent;
          span.textContent = t('viewer.copied', 'Скопировано!');
          setTimeout(() => { span.textContent = original; }, 1800);
        }
      });
    }

    const copyPassBtn = card.querySelector('.btn-copy-pass');
    if (copyPassBtn && item.password) {
      copyPassBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic(10);
        copyToClipboard(item.password);
        showToast(t('vw.passCopied', 'Пароль скопирован: ') + item.password);
      });
    }

    listEl.appendChild(card);
  });

  return links;
}

/**
 * Renders sanitized text/HTML post description into the sidebar.
 * @param {Object} post
 * @param {string[]} [excludedUrls=[]]
 */
export function renderSidebarContent(post, excludedUrls = []) {
  const section = document.getElementById('viewerSidebarContentSection');
  const contentEl = document.getElementById('viewerPostContent');
  if (!section || !contentEl) return;

  const rawContent = post?.content || post?.description || '';
  if (!rawContent || !String(rawContent).trim()) {
    section.style.display = 'none';
    contentEl.innerHTML = '';
    return;
  }

  const safeHtml = formatSafePostContent(String(rawContent), excludedUrls);
  if (!safeHtml || !safeHtml.trim()) {
    section.style.display = 'none';
    contentEl.innerHTML = '';
    return;
  }

  contentEl.innerHTML = safeHtml;
  section.style.display = 'block';
}
