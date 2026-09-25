import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSessionToken,
  resolveSiteSession,
  invalidateSiteSession,
  clearSiteSessionCache
} from '../../src/services/siteSessionService.js';

// Board access is token-only: the operator pastes their own `session` cookie.
// There is no login exchange left, so this suite needs no mock dispatcher and
// makes no network calls at all.
describe('Board session service', () => {
  it('normalizes a pasted token, a session= pair and a whole cookie jar', () => {
    assert.strictEqual(extractSessionToken('abc123'), 'abc123');
    assert.strictEqual(extractSessionToken('session=abc123'), 'abc123');
    assert.strictEqual(extractSessionToken('"abc123"'), 'abc123');
    assert.strictEqual(extractSessionToken('theme=dark; session=abc123; Path=/'), 'abc123');
    assert.strictEqual(extractSessionToken('   '), '');
    assert.strictEqual(extractSessionToken(null), '');
  });

  it('resolves the stored session token per site', async () => {
    const kemono = await resolveSiteSession('kemono', { kemonoSession: 'kemono-token' });
    assert.strictEqual(kemono.token, 'kemono-token');
    assert.strictEqual(kemono.username, '');

    // A pasted cookie jar is normalized on the way out, not rejected.
    const pawchive = await resolveSiteSession('pawchive', { pawchiveSession: 'session=pw-token; Path=/' });
    assert.strictEqual(pawchive.token, 'pw-token');
  });

  it('returns an empty token when no session is configured', async () => {
    for (const site of ['kemono', 'pawchive']) {
      const result = await resolveSiteSession(site, {});
      assert.strictEqual(result.token, '');
      assert.strictEqual(result.username, '');
      assert.strictEqual((await resolveSiteSession(site, { [`${site}Session`]: '  ' })).token, '');
    }
  });

  it('does not leak a session across sites', async () => {
    const result = await resolveSiteSession('kemono', { pawchiveSession: 'pw-token' });
    assert.strictEqual(result.token, '');
  });

  it('keeps the invalidation and cache helpers callable', () => {
    // The parsers still call these on a 401 and the parser suites reset between
    // cases; both are no-ops now that no session is cached server-side.
    assert.doesNotThrow(() => invalidateSiteSession('kemono', { kemonoLogin: 'user', kemonoPassword: 'pass' }));
    assert.doesNotThrow(() => clearSiteSessionCache());
  });
});
