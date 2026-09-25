import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDanbooruCredentialHost, hostnameMatches, sanitizeLogUrl, siteFromHostname } from '../../src/utils/hostPolicy.js';
import { resolveSiteFromUrl, normalizeProxyUrl } from '../../src/utils/network.js';

describe('Host and credential policy', () => {
  it('matches subdomains without accepting lookalike hosts', () => {
    assert.strictEqual(hostnameMatches('danbooru.donmai.us', 'donmai.us'), true);
    assert.strictEqual(hostnameMatches('danmi.us.attacker.example', 'donmai.us'), false);
    assert.strictEqual(hostnameMatches('notdonmai.us', 'donmai.us'), false);
  });

  it('sends Danbooru credentials only to the exact API host', () => {
    assert.strictEqual(isDanbooruCredentialHost('danbooru.donmai.us'), true);
    assert.strictEqual(isDanbooruCredentialHost('cdn.donmai.us'), false);
    assert.strictEqual(isDanbooruCredentialHost('danbooru.donmai.us.attacker.example'), false);
  });

  it('resolves sites by hostname boundary', () => {
    assert.strictEqual(siteFromHostname('api.rule34.xxx'), 'rule34');
    assert.strictEqual(siteFromHostname('rule34.xxx.attacker.example'), null);
    assert.strictEqual(resolveSiteFromUrl('https://danbooru.donmai.us/posts.json'), 'danbooru');
    assert.strictEqual(resolveSiteFromUrl('https://danbooru.donmai.us.attacker.example/x'), null);
  });

  it('redacts userinfo and query strings from logged URLs', () => {
    assert.strictEqual(
      sanitizeLogUrl('https://user:pass@example.com/path?token=secret#x'),
      'https://example.com/path'
    );
  });

  it('normalizes proxy credentials without logging them', () => {
    assert.strictEqual(normalizeProxyUrl('host:8080:user:pass'), 'http://user:pass@host:8080');
  });
});
