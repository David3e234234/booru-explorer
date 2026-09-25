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

  it('separates cached pages by the Kemono and Pawchive credentials', () => {
    // A cached page fetched with one account must never be served to another,
    // so every credential that changes the parser result has to be in the key.
    const withoutLogin = buildAuthCacheKey({}, {});
    assert.notStrictEqual(buildAuthCacheKey({ kemonoLogin: 'alice' }, {}), withoutLogin);
    assert.notStrictEqual(buildAuthCacheKey({ kemonoPassword: 'one' }, {}), withoutLogin);
    assert.notStrictEqual(buildAuthCacheKey({ pawchiveLogin: 'alice' }, {}), withoutLogin);
    assert.notStrictEqual(buildAuthCacheKey({ pawchivePassword: 'one' }, {}), withoutLogin);
    assert.notStrictEqual(
      buildAuthCacheKey({ kemonoLogin: 'alice' }, { kemonoLogin: 'bob' }),
      withoutLogin
    );
  });

  it('treats board passwords as secrets in both the cache key and the field list', () => {
    for (const field of ['kemonoLogin', 'kemonoPassword', 'pawchiveLogin', 'pawchivePassword']) {
      assert.ok(AUTH_CACHE_FIELDS.includes(field), `${field} must be in AUTH_CACHE_FIELDS`);
      assert.ok(SECRET_SETTING_FIELDS.includes(field), `${field} must be in SECRET_SETTING_FIELDS`);
    }

    const anonymous = sanitizeSettingsPatch({
      kemonoLogin: 'alice',
      kemonoPassword: 'secret',
      pawchiveLogin: 'bob',
      pawchivePassword: 'secret'
    }, { anonymous: true });

    assert.deepStrictEqual(anonymous, {});
  });
});
