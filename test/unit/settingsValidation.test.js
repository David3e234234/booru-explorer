import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthCacheKey,
  parseClientAuthValue,
  sanitizeSettingsPatch,
  AUTH_CACHE_FIELDS
} from '../../src/utils/settingsValidation.js';
import { SECRET_SETTING_FIELDS } from '../../src/config/constants.js';

describe('Settings validation', () => {
  it('parses only plain objects from the auth header', () => {
    assert.deepStrictEqual(parseClientAuthValue(encodeURIComponent(JSON.stringify({ deepFetchPages: 3 }))), { deepFetchPages: 3 });
    assert.deepStrictEqual(parseClientAuthValue('null'), {});
    assert.deepStrictEqual(parseClientAuthValue('[1,2]'), {});
    assert.deepStrictEqual(parseClientAuthValue('not-json'), {});
  });

  it('removes server-wide and credential fields from anonymous writes', () => {
    const clean = sanitizeSettingsPatch({
      theme: 'warm-paper',
      maxServerCacheMb: 0,
      globalProxy: 'http://user:pass@proxy.example:8080',
      danbooruApiKey: 'secret',
      telegramBotToken: 'token',
      deepFetchPages: 99
    }, { anonymous: true });

    assert.strictEqual(clean.theme, 'warm-paper');
    assert.strictEqual(clean.maxServerCacheMb, undefined);
    assert.strictEqual(clean.globalProxy, undefined);
    assert.strictEqual(clean.danbooruApiKey, undefined);
    assert.strictEqual(clean.telegramBotToken, undefined);
    assert.strictEqual(clean.deepFetchPages, undefined);
  });

  it('clamps resource budgets for authenticated writes', () => {
    assert.strictEqual(sanitizeSettingsPatch({ deepFetchPages: 6 }).deepFetchPages, 6);
    assert.strictEqual(sanitizeSettingsPatch({ deepFetchPages: 1000 }).deepFetchPages, undefined);
    assert.strictEqual(sanitizeSettingsPatch({ archiveDownloadThreads: 8 }).archiveDownloadThreads, 8);
    assert.strictEqual(sanitizeSettingsPatch({ archiveDownloadThreads: 99 }).archiveDownloadThreads, undefined);
  });

  it('rejects invalid enum and boolean values', () => {
    assert.deepStrictEqual(sanitizeSettingsPatch({ theme: 'dark', hideFurry: 'yes' }), {});
  });

  it('builds a stable cache key for the effective merged settings', () => {
    const explicitServerValue = buildAuthCacheKey({ deepFetchPages: 5 }, { deepFetchPages: 5 });
    const inheritedServerValue = buildAuthCacheKey({}, { deepFetchPages: 5 });
    assert.strictEqual(explicitServerValue, inheritedServerValue);
    assert.notStrictEqual(buildAuthCacheKey({ deepFetchPages: 2 }, { deepFetchPages: 5 }), inheritedServerValue);
  });

  it('separates cached pages by the Kemono and Pawchive session tokens', () => {
    // A cached page fetched with one account must never be served to another,
    // so every credential that changes the parser result has to be in the key.
    const withoutSession = buildAuthCacheKey({}, {});
    assert.notStrictEqual(buildAuthCacheKey({ kemonoSession: 'alice-token' }, {}), withoutSession);
    assert.notStrictEqual(buildAuthCacheKey({ pawchiveSession: 'alice-token' }, {}), withoutSession);
    assert.notStrictEqual(
      buildAuthCacheKey({ kemonoSession: 'alice' }, { kemonoSession: 'bob' }),
      withoutSession
    );
  });

  it('treats board session tokens as secrets in both the cache key and the field list', () => {
    for (const field of ['kemonoSession', 'pawchiveSession']) {
      assert.ok(AUTH_CACHE_FIELDS.includes(field), `${field} must be in AUTH_CACHE_FIELDS`);
      assert.ok(SECRET_SETTING_FIELDS.includes(field), `${field} must be in SECRET_SETTING_FIELDS`);
    }

    // The removed login/password fields must not linger in either list: a stale
    // entry would keep a dead field in the cache key for no behavioural reason.
    for (const field of ['kemonoLogin', 'kemonoPassword', 'pawchiveLogin', 'pawchivePassword']) {
      assert.ok(!AUTH_CACHE_FIELDS.includes(field), `${field} must not be in AUTH_CACHE_FIELDS`);
      assert.ok(!SECRET_SETTING_FIELDS.includes(field), `${field} must not be in SECRET_SETTING_FIELDS`);
    }

    const anonymous = sanitizeSettingsPatch({
      kemonoSession: 'alice-token',
      pawchiveSession: 'bob-token'
    }, { anonymous: true });

    assert.deepStrictEqual(anonymous, {});
  });
});
