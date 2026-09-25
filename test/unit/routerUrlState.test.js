import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../public/js/state.js';
import { parseParams, applyUrlToState } from '../../public/js/router.js';

// Canonical defaults, mirroring the `state` initializer in public/js/state.js.
// applyUrlToState() mutates that shared singleton, so every case starts from here.
function resetState(overrides = {}) {
  Object.assign(state, {
    currentSite: 'danbooru',
    postSort: 'new',
    currentCategory: 'feed',
    favoritesSubTab: 'posts',
    profileSubTab: 'likes',
    aiFilter: 'no-ai',
    ratingFilter: 'all',
    typeFilter: 'all',
    ageFilter: 'all',
    searchTags: []
  }, overrides);
}

describe('Router URL state', () => {
  beforeEach(() => resetState());

  describe('parseParams', () => {
    it('omits the site param for the default site and defaults it back to danbooru', () => {
      assert.strictEqual(parseParams('?ai=no-ai&rating=all').site, null);
      assert.strictEqual(parseParams('?site=gelbooru').site, 'gelbooru');
    });

    it('rejects unknown sites and malformed post ids', () => {
      assert.strictEqual(parseParams('?site=not-a-booru').site, null);
      assert.strictEqual(parseParams('?post=abc').post, 'abc');
      assert.strictEqual(parseParams('?post=' + encodeURIComponent('bad id!')).post, null);
      assert.strictEqual(parseParams('?post=').post, null);
    });

    it('maps legacy feed sort values onto the feed category', () => {
      const parsed = parseParams('?cat=top');
      assert.strictEqual(parsed.cat, 'feed');
      assert.strictEqual(parsed.sort, 'top');
    });
  });

  describe('applyUrlToState', () => {
    // Regression: Back from the viewer landed on a URL without `site`, while
    // state.currentSite was still 'danbooru'. Comparing p.site directly made
    // `changed` true, which re-ran the search and scrolled the feed to the top.
    it('reports no change when Back from the viewer returns to the default site', () => {
      const parsed = parseParams('?ai=no-ai&rating=all&type=all&age=all');
      assert.strictEqual(applyUrlToState(parsed), false);
    });

    it('still reports a change when the site really differs', () => {
      const parsed = parseParams('?site=gelbooru&ai=no-ai&rating=all&type=all&age=all');
      assert.strictEqual(applyUrlToState(parsed), true);
      assert.strictEqual(state.currentSite, 'gelbooru');
    });

    it('reports a change when moving from a non-default site back to the default', () => {
      resetState({ currentSite: 'gelbooru' });
      const parsed = parseParams('?ai=no-ai&rating=all&type=all&age=all');
      assert.strictEqual(applyUrlToState(parsed), true);
      assert.strictEqual(state.currentSite, 'danbooru');
    });

    // Every field buildQuery() omits at its default must compare equal when
    // parsed back, or Back re-runs the search and resets the scroll.
    it('treats every omitted default as unchanged', () => {
      assert.strictEqual(applyUrlToState(parseParams('')), false);
      assert.strictEqual(applyUrlToState(parseParams('?site=gelbooru')), true);
    });

    it('detects real changes in the other normalized defaults', () => {
      assert.strictEqual(applyUrlToState(parseParams('?sort=hot')), true);
      assert.strictEqual(state.postSort, 'hot');

      resetState();
      assert.strictEqual(applyUrlToState(parseParams('?ai=only-ai')), true);
      assert.strictEqual(state.aiFilter, 'only-ai');

      resetState();
      assert.strictEqual(applyUrlToState(parseParams('?rating=nsfw')), true);
      assert.strictEqual(state.ratingFilter, 'nsfw');

      resetState();
      assert.strictEqual(applyUrlToState(parseParams('?type=video')), true);
      assert.strictEqual(state.typeFilter, 'video');

      resetState();
      assert.strictEqual(applyUrlToState(parseParams('?age=adult')), true);
      assert.strictEqual(state.ageFilter, 'adult');

      resetState();
      assert.strictEqual(applyUrlToState(parseParams('?cat=favorites')), true);
      assert.strictEqual(state.currentCategory, 'favorites');
    });

    it('applies and detects search tags', () => {
      assert.strictEqual(applyUrlToState(parseParams('?tags=cat+girl')), true);
      assert.deepStrictEqual(state.searchTags, ['cat', 'girl']);
      // Same tags again must not re-trigger a search.
      assert.strictEqual(applyUrlToState(parseParams('?tags=cat+girl')), false);
    });

    it('applies the sub-tab only for its own category', () => {
      assert.strictEqual(applyUrlToState(parseParams('?cat=favorites&favtab=authors')), true);
      assert.strictEqual(state.favoritesSubTab, 'authors');

      resetState();
      // favtab/ptab must be ignored outside their categories.
      assert.strictEqual(applyUrlToState(parseParams('?favtab=authors&ptab=authors')), false);
    });
  });
});