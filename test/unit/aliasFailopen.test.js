import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import {
  discoverAuthorAliases,
  getAliasesInfo,
  clearDiscoveredAliases,
  getDiscoveredAliasesList,
  updateDiscoveredAliasEntry,
  getQuerySubstitutions,
  reportAliasOutcome,
  resolveTagForSite,
  learnAliasesFromPostMatches
} from '../../src/services/aliasService.js';

function seedGroup(id, aliases, sites) {
  const res = updateDiscoveredAliasEntry(id, { id, aliases, sites });
  assert.ok(res.success);
  return res.entry;
}

describe('discovered alias empty-result fallback', () => {
  let originalDispatcher;
  let agent;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    clearDiscoveredAliases();
  });

  afterEach(() => {
    try { agent.destroy(); } catch {}
    if (originalDispatcher) setGlobalDispatcher(originalDispatcher);
    clearDiscoveredAliases();
  });

  it('describes a discovered alias substitution', () => {
    seedGroup('artist_x', ['artist_x', 'old_name'], { danbooru: 'artist_x' });

    const subs = getQuerySubstitutions('old_name', ['danbooru'], {});
    assert.equal(subs.length, 1);
    assert.deepEqual(subs[0], {
      token: 'old_name',
      resolved: 'artist_x',
      site: 'danbooru',
      source: 'discovered',
      entryId: 'artist_x'
    });
  });

  it('skips identity rewrites and disabled groups', () => {
    seedGroup('artist_x', ['artist_x', 'alias_x'], { danbooru: 'artist_x' });
    // token equals the resolved tag: nothing to report
    assert.equal(getQuerySubstitutions('artist_x', ['danbooru'], {}).length, 0);

    updateDiscoveredAliasEntry('artist_x', { enabled: false });
    assert.equal(getQuerySubstitutions('alias_x', ['danbooru'], {}).length, 0);
    assert.equal(resolveTagForSite('alias_x', 'danbooru', [], {}), 'alias_x');
  });

  it('skips the discovered map under bypassDiscoveredAliases', () => {
    seedGroup('artist_x', ['artist_x', 'alias_x'], { danbooru: 'artist_x' });

    assert.equal(getQuerySubstitutions('alias_x', ['danbooru'], { bypassDiscoveredAliases: true }).length, 0);
    assert.equal(resolveTagForSite('alias_x', 'danbooru', [], { bypassDiscoveredAliases: true }), 'alias_x');
    // built-in and custom sources still resolve under bypass
    assert.equal(
      getQuerySubstitutions('alias_x', ['danbooru'], { customAliases: 'alias_x = danbooru:custom_x' })[0].source,
      'custom'
    );
  });

  it('resolves a substituted token the same way resolveQueryTagsForSite does', () => {
    seedGroup('artist_x', ['artist_x', 'old_name'], { danbooru: 'artist_x', gelbooru: 'artist_x_g' });

    assert.equal(resolveTagForSite('old_name', 'danbooru', [], {}), 'artist_x');
    assert.equal(resolveTagForSite('old_name', 'gelbooru', [], {}), 'artist_x_g');
    assert.equal(resolveTagForSite('-old_name', 'danbooru', [], {}), '-artist_x');
  });

  it('auto-disables a group after repeated empty results and restores it on success', () => {
    seedGroup('artist_y', ['artist_y', 'alias_y'], { danbooru: 'artist_y' });
    const subs = getQuerySubstitutions('alias_y', ['danbooru'], {});

    reportAliasOutcome(subs, 'empty');
    reportAliasOutcome(subs, 'empty');
    let entry = getDiscoveredAliasesList().find(e => e.id === 'artist_y');
    assert.equal(entry.failCount, 2);
    assert.notEqual(entry.enabled, false);

    reportAliasOutcome(subs, 'empty');
    entry = getDiscoveredAliasesList().find(e => e.id === 'artist_y');
    assert.equal(entry.enabled, false);
    assert.ok(entry.disabledAt);
    assert.equal(resolveTagForSite('alias_y', 'danbooru', [], {}), 'alias_y');

    // A manual re-enable resets the counter and the group works again
    updateDiscoveredAliasEntry('artist_y', { enabled: true });
    entry = getDiscoveredAliasesList().find(e => e.id === 'artist_y');
    assert.equal(entry.enabled, true);
    assert.equal(entry.failCount, 0);
    assert.equal(resolveTagForSite('alias_y', 'danbooru', [], {}), 'artist_y');

    reportAliasOutcome(subs, 'success');
    entry = getDiscoveredAliasesList().find(e => e.id === 'artist_y');
    assert.equal(entry.hitCount, 1);
    assert.equal(entry.failCount, 0);
  });

  it('never quarantines custom rules or built-in aliases', () => {
    const before = getAliasesInfo().discoveredCount;

    const customSubs = getQuerySubstitutions('alias_z', ['danbooru'], { customAliases: 'alias_z = danbooru:custom_z' });
    assert.equal(customSubs[0].source, 'custom');
    reportAliasOutcome(customSubs, 'empty');

    const builtinSubs = [{ token: 'builtin_a', resolved: 'builtin_b', site: 'danbooru', source: 'builtin', entryId: null }];
    reportAliasOutcome(builtinSubs, 'empty');

    assert.equal(getAliasesInfo().discoveredCount, before);
  });

  it('discoverAuthorAliases rejects a fuzzy match where the candidate is not this artist', async () => {
    const client = agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.startsWith('/artists.json'),
      method: 'GET'
    }).reply(200, [{
      name: 'unrelated_artist',
      other_names: ['some_alias'],
      urls: []
    }]);

    const result = await discoverAuthorAliases('artist_q', {});
    assert.equal(result, null);
    assert.equal(getAliasesInfo().discoveredCount, 0);
  });

  it('discoverAuthorAliases refuses a canonical tag with zero posts', async () => {
    const client = agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.startsWith('/artists.json'),
      method: 'GET'
    }).reply(200, [{
      name: 'artist_q',
      other_names: ['artistq'],
      urls: []
    }]);
    client.intercept({
      path: (p) => p.startsWith('/tags.json'),
      method: 'GET'
    }).reply(200, [{ name: 'artist_q', post_count: 0 }]);

    const result = await discoverAuthorAliases('artist_q', {});
    assert.equal(result, null);
    assert.equal(getAliasesInfo().discoveredCount, 0);
  });

  it('discoverAuthorAliases registers a verified group with posts', async () => {
    const client = agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.startsWith('/artists.json'),
      method: 'GET'
    }).reply(200, [{
      name: 'artist_q',
      other_names: ['artistq'],
      urls: []
    }]);
    client.intercept({
      path: (p) => p.startsWith('/tags.json'),
      method: 'GET'
    }).reply(200, [{ name: 'artist_q', post_count: 42 }]);

    const result = await discoverAuthorAliases('artist_q', {});
    assert.ok(result);
    assert.equal(result.id, 'artist_q');
    assert.equal(getAliasesInfo().discoveredCount, 1);
  });

  it('learnAliasesFromPostMatches skips source groups with more authors than the plausibility cap', () => {
    const posts = [];
    for (let i = 0; i < 10; i++) {
      posts.push({
        site: i % 2 === 0 ? 'danbooru' : 'gelbooru',
        author: `author_${i}`,
        source: 'https://x.com/shared_user/status/123'
      });
    }

    learnAliasesFromPostMatches(posts, {});
    assert.equal(getAliasesInfo().discoveredCount, 0);
  });

  it('learnAliasesFromPostMatches still registers a small correlated group', () => {
    const posts = [];
    for (let i = 0; i < 4; i++) {
      posts.push({
        site: i % 2 === 0 ? 'danbooru' : 'gelbooru',
        author: `author_${i}`,
        source: 'https://x.com/shared_user/status/123'
      });
    }

    learnAliasesFromPostMatches(posts, {});
    assert.equal(getAliasesInfo().discoveredCount, 1);
    const entry = getDiscoveredAliasesList()[0];
    // One site key per source group: the last danbooru/gelbooru author in item order wins
    assert.equal(entry.sites.danbooru, 'author_2');
    assert.equal(entry.sites.gelbooru, 'author_3');
  });
});
