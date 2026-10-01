import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import {
  discoverAuthorAliases,
  getAliasesInfo,
  clearDiscoveredAliases,
  learnAliasesFromPostMatches,
  getAllAliasesForName,
  resolveTagForSite,
  updateDiscoveredAliasEntry,
  deleteDiscoveredAliasEntry,
  getDiscoveredAliasesList,
  isAliasIgnored,
  getAllKnownAliasesMap
} from '../../src/services/aliasService.js';

describe('Alias discovery settings and management', () => {
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

  it('isAliasIgnored correctly matches banned tags case-insensitively', () => {
    const ignored = ['TagMe', 'Various_Artists', 'error_tag'];
    assert.strictEqual(isAliasIgnored('tagme', ignored), true);
    assert.strictEqual(isAliasIgnored('TAGME', ignored), true);
    assert.strictEqual(isAliasIgnored('various_artists', ignored), true);
    assert.strictEqual(isAliasIgnored('clean_tag', ignored), false);
    assert.strictEqual(isAliasIgnored('', ignored), false);
    assert.strictEqual(isAliasIgnored('tagme', []), false);
  });

  it('respects enableAliasDiscovery: false and does not query or discover aliases', async () => {
    const client = agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.startsWith('/artists.json'),
      method: 'GET'
    }).reply(200, [{
      name: 'artist_disabled',
      other_names: ['disabled_alt'],
      urls: []
    }]);

    const result = await discoverAuthorAliases('artist_disabled', { enableAliasDiscovery: false });
    assert.strictEqual(result, null);
    assert.strictEqual(getAliasesInfo().discoveredCount, 0);
  });

  it('respects ignoredAliases and does not discover or register banned tags', async () => {
    const client = agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.startsWith('/artists.json'),
      method: 'GET'
    }).reply(200, [{
      name: 'artist_good',
      other_names: ['bad_tag', 'circle_name'],
      urls: []
    }]);

    // If candidate itself is in ignoredAliases, it immediately aborts
    const resCandidateIgnored = await discoverAuthorAliases('banned_author', {
      ignoredAliases: ['banned_author']
    });
    assert.strictEqual(resCandidateIgnored, null);
    assert.strictEqual(getAliasesInfo().discoveredCount, 0);

    // If other_names are ignored, they are filtered out
    const resFilter = await discoverAuthorAliases('artist_good', {
      ignoredAliases: ['bad_tag', 'circle_name']
    });
    // Since only artist_good remains, size is 1 (< 2), so it is not registered
    assert.strictEqual(resFilter, null);
    assert.strictEqual(getAliasesInfo().discoveredCount, 0);
  });

  it('learnAliasesFromPostMatches respects enableAliasDiscovery: false and ignoredAliases', () => {
    const posts = [
      { site: 'danbooru', author: 'artist_one', source: 'https://twitter.com/test_art/status/12345' },
      { site: 'rule34', author: 'artist_two', source: 'https://twitter.com/test_art/status/12345' }
    ];

    // Disabled setting
    learnAliasesFromPostMatches(posts, { enableAliasDiscovery: false });
    assert.strictEqual(getAliasesInfo().discoveredCount, 0);

    // With ignoredAliases on one of the authors
    learnAliasesFromPostMatches(posts, { enableAliasDiscovery: true, ignoredAliases: ['artist_two'] });
    assert.strictEqual(getAliasesInfo().discoveredCount, 0);

    // Enabled setting without ignored
    learnAliasesFromPostMatches(posts, { enableAliasDiscovery: true });
    assert.strictEqual(getAliasesInfo().discoveredCount, 1);
  });

  it('getAllAliasesForName and resolveTagForSite filter out ignoredAliases', () => {
    // Manually register an alias entry
    updateDiscoveredAliasEntry('doradew', {
      id: 'doradew',
      aliases: ['doradew', 'ddd', 'badalias'],
      sites: { rule34: 'doradew_sfm' }
    });
    assert.strictEqual(getDiscoveredAliasesList().length, 1);

    // Without ignoredAliases
    const all1 = getAllAliasesForName('doradew', []);
    assert.ok(all1.includes('ddd'));
    assert.ok(all1.includes('badalias'));

    // With ignoredAliases: 'badalias' is filtered out
    const all2 = getAllAliasesForName('doradew', [], ['badalias']);
    assert.ok(all2.includes('ddd'));
    assert.ok(!all2.includes('badalias'));

    // If queried name itself is ignored, returns empty
    const all3 = getAllAliasesForName('badalias', [], ['badalias']);
    assert.deepStrictEqual(all3, []);

    // resolveTagForSite returns unchanged token if lookupKey is ignored
    const resolvedIgnored = resolveTagForSite('badalias', 'danbooru', [], { ignoredAliases: ['badalias'] });
    assert.strictEqual(resolvedIgnored, 'badalias');
  });

  it('supports updating and deleting discovered alias entries', () => {
    // 1. Initial entry creation via updateDiscoveredAliasEntry
    const addRes = updateDiscoveredAliasEntry('test_artist', {
      id: 'test_artist',
      aliases: ['test_artist', 'test_sfm', 'old_name'],
      sites: { danbooru: 'test_artist', rule34: 'test_sfm' }
    });
    assert.strictEqual(addRes.success, true);
    assert.strictEqual(getAliasesInfo().discoveredCount, 1);

    // 2. Update entry (e.g. remove old_name)
    const updateRes = updateDiscoveredAliasEntry('test_artist', {
      id: 'test_artist',
      aliases: ['test_artist', 'test_sfm'],
      sites: { danbooru: 'test_artist', rule34: 'test_sfm' }
    });
    assert.strictEqual(updateRes.success, true);
    assert.deepStrictEqual(updateRes.entry.aliases, ['test_artist', 'test_sfm']);

    // 3. Delete entry
    const delRes = deleteDiscoveredAliasEntry('test_artist');
    assert.strictEqual(delRes.success, true);
    assert.strictEqual(getAliasesInfo().discoveredCount, 0);

    // 4. Deleting non-existent returns error
    const delNonExistent = deleteDiscoveredAliasEntry('non_existent');
    assert.strictEqual(delNonExistent.success, false);
  });

  it('getAllKnownAliasesMap filters out ignoredAliases', () => {
    updateDiscoveredAliasEntry('artist_a', {
      id: 'artist_a',
      aliases: ['artist_a', 'artist_b', 'banned_variant']
    });

    const mapClean = getAllKnownAliasesMap(['banned_variant']);
    assert.ok(mapClean.artist_a);
    assert.ok(mapClean.artist_a.includes('artist_b'));
    assert.ok(!mapClean.artist_a.includes('banned_variant'));
    assert.strictEqual(mapClean.banned_variant, undefined);
  });
});
