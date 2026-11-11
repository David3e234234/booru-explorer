import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// navigationUI renders the source panel through DOM APIs. Node has no document,
// so the suite installs a tiny shim that records what each node received: that
// is enough to assert the highlight (the `.active` class) and the click handler
// wiring, which is exactly what the regression broke.
class FakeNode {
  constructor(doc, tagName = 'div') {
    this.ownerDocument = doc;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.attributes = {};
    this.listeners = new Map();
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  click() {
    for (const fn of this.listeners.get('click') || []) {
      fn({ target: this, stopPropagation() {}, closest: () => null });
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelector() {
    return null;
  }
}

function installDomShim(containerIds) {
  const nodes = new Map();
  for (const id of containerIds) {
    const node = new FakeNode(globalThis.document, 'div');
    nodes.set(id, node);
  }
  globalThis.document = {
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tag) => new FakeNode(globalThis.document, tag),
    querySelector: () => null,
    documentElement: { setAttribute() {}, dataset: {}, lang: 'ru' }
  };
  return nodes;
}

describe('Source panel selection', () => {
  let navigationUI;
  let state;
  let nodes;

  beforeEach(async () => {
    nodes = installDomShim([
      'sourcesList',
      'sourcesListMobile',
      'currentSiteLabel',
      'pawchiveServiceBlock',
      'kemonoServiceBlock'
    ]);
    // Fresh module instances per case: navigationUI memoizes the last paint and
    // the last click handler, which must not leak across assertions.
    navigationUI = await import(`../../public/js/modules/navigationUI.js?case=${Math.random()}`);
    ({ state } = await import('../../public/js/state.js'));
    state.sites = [
      { id: 'danbooru', name: 'Danbooru' },
      { id: 'gelbooru', name: 'Gelbooru' }
    ];
    state.currentSite = 'gelbooru';
  });

  afterEach(() => {
    delete globalThis.document;
  });

  it('highlights the source named by state.currentSite', async () => {
    navigationUI.syncSourceSelectionUI({ force: true });

    const items = nodes.get('sourcesList').children;
    const activeIndexes = items
      .map((child, index) => (/\bactive\b/.test(child.className || '') ? index : -1))
      .filter((index) => index >= 0);

    // all = 0, custom = 1, then the sites in registry order
    assert.deepEqual(activeIndexes, [3], 'exactly one source, the selected one, may be active');
    assert.equal(state.sites[1].id, 'gelbooru');
  });

  it('moves the highlight when the site changes', async () => {
    navigationUI.syncSourceSelectionUI({ force: true });
    const firstActive = nodes.get('sourcesList').children.findIndex((child) => /\bactive\b/.test(child.className));

    state.currentSite = 'danbooru';
    navigationUI.syncSourceSelectionUI({ force: true });
    const secondActive = nodes.get('sourcesList').children.findIndex((child) => /\bactive\b/.test(child.className));

    assert.notEqual(firstActive, secondActive, 'the highlight has to follow the state');
  });

  it('keeps the remembered click handler across a repaint', async () => {
    const clicks = [];
    navigationUI.renderSitesBar({ onSelectSite: (id) => clicks.push(id) });
    navigationUI.syncSourceSelectionUI({ force: true });

    const gelbooruIndex = state.sites.findIndex((site) => site.id === 'gelbooru');
    // all, custom, then the two sites
    nodes.get('sourcesList').children[2 + gelbooruIndex].click();
    assert.deepEqual(clicks, ['gelbooru'], 'a repaint must not drop the click handler');
  });
});
