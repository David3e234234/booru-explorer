import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import {
  extractSessionToken,
  resolveSiteSession,
  invalidateSiteSession,
  clearSiteSessionCache
} from '../../src/services/siteSessionService.js';

const LOGIN_PATH = '/api/v1/authentication/login';

function mockKemono() {
  const original = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return { agent, original };
}

function restore(original, agent) {
  try { agent.destroy(); } catch {}
  if (original) setGlobalDispatcher(original);
}

describe('Board session service', () => {
  let ctx = null;

  beforeEach(() => {
    ctx = mockKemono();
    clearSiteSessionCache();
  });

  afterEach(() => {
    restore(ctx.original, ctx.agent);
  });

  it('normalizes a pasted token, a session= pair and a whole cookie jar', () => {
    assert.strictEqual(extractSessionToken('abc123'), 'abc123');
    assert.strictEqual(extractSessionToken('session=abc123'), 'abc123');
    assert.strictEqual(extractSessionToken('"abc123"'), 'abc123');
    assert.strictEqual(extractSessionToken('theme=dark; session=abc123; Path=/'), 'abc123');
    assert.strictEqual(extractSessionToken('   '), '');
    assert.strictEqual(extractSessionToken(null), '');
  });

  it('prefers an explicit session token over stored credentials', async () => {
    // No login interceptor is registered: any outbound request would throw.
    const result = await resolveSiteSession('kemono', {
      kemonoSession: 'pinned-token',
      kemonoLogin: 'user',
      kemonoPassword: 'pass'
    });
    assert.strictEqual(result.token, 'pinned-token');
  });

  it('exchanges credentials for a session on the JSON API', async () => {
    ctx.agent.get('https://kemono.cr')
      .intercept({ path: LOGIN_PATH, method: 'POST' })
      .reply(200, { id: 1, username: 'tester', role: 'user' }, {
        headers: { 'set-cookie': 'session=issued-token; Path=/; HttpOnly' }
      });

    const result = await resolveSiteSession('kemono', { kemonoLogin: 'tester', kemonoPassword: 'secret' });
    assert.strictEqual(result.token, 'issued-token');
    assert.strictEqual(result.username, 'tester');
  });

  it('reports a rejected login without leaking the password', async () => {
    ctx.agent.get('https://kemono.cr')
      .intercept({ path: LOGIN_PATH, method: 'POST' })
      .reply(400, { error: 'Username or password is incorrect.' });

    const result = await resolveSiteSession('kemono', { kemonoLogin: 'tester', kemonoPassword: 'hunter2' });
    assert.strictEqual(result.token, '');
    assert.strictEqual(result.reason, 'credentials');
    assert.ok(!JSON.stringify(result).includes('hunter2'));
  });

  it('collapses concurrent logins into a single upstream request', async () => {
    // No persist(): the interceptor answers exactly once. A second login would
    // find no matching mock and fail, so one shared token across three callers
    // can only come from single-flight.
    ctx.agent.get('https://kemono.cr')
      .intercept({ path: LOGIN_PATH, method: 'POST' })
      .reply(200, { username: 'tester' }, { headers: { 'set-cookie': 'session=shared-token' } });

    const settings = { kemonoLogin: 'tester', kemonoPassword: 'secret' };
    const results = await Promise.all([
      resolveSiteSession('kemono', settings),
      resolveSiteSession('kemono', settings),
      resolveSiteSession('kemono', settings)
    ]);

    assert.deepStrictEqual(results.map(r => r.token), ['shared-token', 'shared-token', 'shared-token']);
  });

  it('caches a failure so a wrong password does not re-login on every request', async () => {
    ctx.agent.get('https://kemono.cr')
      .intercept({ path: LOGIN_PATH, method: 'POST' })
      .reply(400, { error: 'bad' });

    const settings = { kemonoLogin: 'tester', kemonoPassword: 'wrong' };
    const first = await resolveSiteSession('kemono', settings);
    const second = await resolveSiteSession('kemono', settings);

    // Without the negative cache the second call would have no interceptor left
    // and would report a network error instead of the credential rejection.
    assert.strictEqual(first.reason, 'credentials');
    assert.strictEqual(second.reason, 'credentials');
    assert.strictEqual(second.token, '');
  });

  it('re-authenticates after invalidateSiteSession', async () => {
    ctx.agent.get('https://kemono.cr')
      .intercept({ path: LOGIN_PATH, method: 'POST' })
      .reply(200, { username: 'tester' }, { headers: { 'set-cookie': 'session=first-token' } });
    ctx.agent.get('https://kemono.cr')
      .intercept({ path: LOGIN_PATH, method: 'POST' })
      .reply(200, { username: 'tester' }, { headers: { 'set-cookie': 'session=second-token' } });

    const settings = { kemonoLogin: 'tester', kemonoPassword: 'secret' };
    const first = await resolveSiteSession('kemono', settings);
    assert.strictEqual(first.token, 'first-token');

    invalidateSiteSession('kemono', settings);
    const second = await resolveSiteSession('kemono', settings);
    assert.strictEqual(second.token, 'second-token');
  });

  it('returns an empty token when no credentials are configured', async () => {
    const result = await resolveSiteSession('kemono', {});
    assert.strictEqual(result.token, '');
    assert.strictEqual(result.username, '');
  });
});
