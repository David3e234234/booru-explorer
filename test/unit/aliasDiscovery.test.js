import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { discoverAuthorAliases, getAliasesInfo, clearDiscoveredAliases } from '../../src/services/aliasService.js';

describe('discoverAuthorAliases group size cap', () => {
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

  it('rejects a Danbooru page whose other_names list is a circle, not an alias group', async () => {
    const huge = ['name_a', 'name_b', 'name_c', 'name_d', 'name_e', 'name_f', 'name_g', 'name_h', 'name_i'];
    const client = agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.startsWith('/artists.json'),
      method: 'GET'
    }).reply(200, [{
      name: 'some_aggregator_page',
      other_names: huge,
      urls: []
    }]);

    const result = await discoverAuthorAliases('name_a', {});
    assert.equal(result, null);
    assert.equal(getAliasesInfo().discoveredCount, 0);
  });

  it('still registers a plausible alias group', async () => {
    const client = agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.startsWith('/artists.json'),
      method: 'GET'
    }).reply(200, [{
      name: 'artist_x',
      other_names: ['artistx', 'old_name'],
      urls: []
    }]);

    const result = await discoverAuthorAliases('artist_x', {});
    assert.ok(result);
    assert.equal(result.id, 'artist_x');
    assert.equal(getAliasesInfo().discoveredCount, 1);
  });
});
