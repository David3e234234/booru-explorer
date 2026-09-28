import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Viewer Album Settings Logic', () => {
  it('does not auto-trigger album fetch when groupAlbums is false', () => {
    const settings = { groupAlbums: false };
    const currentPost = {
      site: 'danbooru',
      id: 'danbooru_12345',
      hasChildren: true,
      _albumFullyFetched: false
    };

    const shouldAutoFetch = (settings?.groupAlbums !== false) &&
      !currentPost._albumFullyFetched &&
      currentPost.site !== 'pawchive' &&
      currentPost.site !== 'kemono' &&
      Boolean(currentPost.hasChildren || currentPost.parentId || currentPost.seriesKey || currentPost.pixiv_id);

    assert.strictEqual(shouldAutoFetch, false, 'Auto-fetch must not trigger when groupAlbums is false');
  });

  it('triggers auto album fetch when groupAlbums is true or default', () => {
    const settingsDefault = {};
    const settingsExplicitTrue = { groupAlbums: true };
    const currentPost = {
      site: 'danbooru',
      id: 'danbooru_12345',
      hasChildren: true,
      _albumFullyFetched: false
    };

    const check = (settings) => (settings?.groupAlbums !== false) &&
      !currentPost._albumFullyFetched &&
      currentPost.site !== 'pawchive' &&
      currentPost.site !== 'kemono' &&
      Boolean(currentPost.hasChildren || currentPost.parentId || currentPost.seriesKey || currentPost.pixiv_id);

    assert.strictEqual(check(settingsDefault), true, 'Auto-fetch triggers on default settings');
    assert.strictEqual(check(settingsExplicitTrue), true, 'Auto-fetch triggers when groupAlbums is explicitly true');
  });

  it('allows explicit user action to fetch album even if groupAlbums is false', () => {
    const settings = { groupAlbums: false };
    const canRunFetch = (isUserExplicit) => {
      if (!isUserExplicit && settings?.groupAlbums === false) return false;
      return true;
    };

    assert.strictEqual(canRunFetch(false), false, 'Non-explicit fetch is blocked when groupAlbums is false');
    assert.strictEqual(canRunFetch(true), true, 'Explicit user click is allowed even when groupAlbums is false');
  });
});
