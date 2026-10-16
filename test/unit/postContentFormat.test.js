import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSafePostContent } from '../../public/js/viewer/viewerCloudLinks.js';

describe('formatSafePostContent', () => {
  it('returns empty string for empty, null or undefined input', () => {
    assert.strictEqual(formatSafePostContent(''), '');
    assert.strictEqual(formatSafePostContent(null), '');
    assert.strictEqual(formatSafePostContent(undefined), '');
    assert.strictEqual(formatSafePostContent('   '), '');
  });

  it('formats plain text with URLs into paragraphs with safe links', () => {
    const text = 'Check this link:\nhttps://example.com/item\n\nSecond paragraph.';
    const result = formatSafePostContent(text);
    assert.match(result, /<p>Check this link:<br><a href="https:\/\/example\.com\/item" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/item<\/a><\/p>/);
    assert.match(result, /<p>Second paragraph\.<\/p>/);
  });

  it('escapes raw HTML in plain text input', () => {
    const text = 'Notice: 5 < 10 & 20 > 15';
    const result = formatSafePostContent(text);
    assert.match(result, /&lt; 10 &amp; 20 &gt;/);
  });

  it('sanitizes and preserves safe HTML content when DOMParser is available', () => {
    // Provide a lightweight DOMParser test double in Node test environment
    class MockElement {
      constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this._attrs = new Map();
        this.children = [];
        this.parentElement = null;
        this._textContent = '';
      }
      setAttribute(name, val) { this._attrs.set(name, String(val)); }
      getAttribute(name) { return this._attrs.get(name) || null; }
      removeAttribute(name) { this._attrs.delete(name); }
      get attributes() {
        return Array.from(this._attrs.entries()).map(([name, value]) => ({ name, value }));
      }
      get textContent() {
        if (this.children.length > 0) return this.children.map(c => c.textContent).join('');
        return this._textContent;
      }
      set textContent(v) { this._textContent = v; this.children = []; }
      remove() {
        if (this.parentElement) {
          const idx = this.parentElement.children.indexOf(this);
          if (idx !== -1) this.parentElement.children.splice(idx, 1);
        }
      }
      querySelectorAll(selector) {
        const matches = [];
        const selList = selector.split(',').map(s => s.trim().toUpperCase());
        const matchAny = selList.includes('*');
        const walk = (el) => {
          for (const child of el.children) {
            if (matchAny || selList.includes(child.tagName) || (selList.includes('A[HREF]') && child.tagName === 'A' && child._attrs.has('href'))) {
              matches.push(child);
            }
            walk(child);
          }
        };
        walk(this);
        return matches;
      }
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      }
      get innerHTML() {
        if (this.children.length === 0) return this._textContent;
        return this.children.map(c => {
          const attrs = Array.from(c._attrs.entries()).map(([k, v]) => ` ${k}="${v}"`).join('');
          return `<${c.tagName.toLowerCase()}${attrs}>${c.innerHTML}</${c.tagName.toLowerCase()}>`;
        }).join('');
      }
    }

    const origDOMParser = globalThis.DOMParser;
    globalThis.DOMParser = class {
      parseFromString(html) {
        const body = new MockElement('body');
        // Simple mock parse for <p> and <a> and <script>
        const pRegex = /<p>([\s\S]*?)<\/p>/gi;
        let match;
        while ((match = pRegex.exec(html)) !== null) {
          const p = new MockElement('p');
          p.parentElement = body;
          const inner = match[1];
          if (inner.includes('<script')) {
            const script = new MockElement('script');
            script.parentElement = p;
            p.children.push(script);
          } else if (inner.includes('<a href=')) {
            const aMatch = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
            if (aMatch) {
              const textBefore = inner.split(/<a /i)[0];
              if (textBefore) {
                const span = new MockElement('span');
                span.textContent = textBefore;
                span.parentElement = p;
                p.children.push(span);
              }
              const a = new MockElement('a');
              a.setAttribute('href', aMatch[1]);
              a.textContent = aMatch[2];
              a.parentElement = p;
              p.children.push(a);
            }
          } else if (inner.trim() === '<br>') {
            // empty paragraph
          } else {
            p.textContent = inner;
          }
          body.children.push(p);
        }
        return {
          body,
          querySelectorAll: (sel) => body.querySelectorAll(sel)
        };
      }
    };

    try {
      const rawHtml = '<p>Hello world</p><p><script>alert(1)</script></p><p><a href="https://example.com/post">Link</a></p><p><br></p>';
      const safe = formatSafePostContent(rawHtml);
      assert.ok(safe.includes('Hello world'));
      assert.ok(safe.includes('href="https://example.com/post"'));
      assert.ok(safe.includes('target="_blank"'));
      assert.ok(safe.includes('rel="noopener noreferrer"'));
      assert.ok(!safe.includes('<script>'));
    } finally {
      if (origDOMParser) {
        globalThis.DOMParser = origDOMParser;
      } else {
        delete globalThis.DOMParser;
      }
    }
  });
});
