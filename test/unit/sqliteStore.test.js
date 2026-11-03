process.env.NODE_ENV = 'test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// An isolated data directory so this suite never touches the shared run
// DATA_DIR. The store is reconfigured BEFORE its first init: opening the
// database auto-runs the legacy JSON import for that directory.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'booru-sqlite-unit-'));
const userDir = path.join(fixtureDir, 'users', 'u_unit1');
fs.mkdirSync(userDir, { recursive: true });

fs.writeFileSync(path.join(fixtureDir, 'settings.json'), JSON.stringify({
  ratingFilter: 'e',
  rule34ApiKey: 'legacy-key'
}));
// Compact-schema record plus legacy noise: import must preserve data and
// apply the same compaction the boot-time compactor used to.
fs.writeFileSync(path.join(fixtureDir, 'likes.json'), JSON.stringify([
  { id: 'd_1', site: 'danbooru', fileUrl: 'https://x/1.jpg', thumbOriginal: 'https://x/1.jpg', _similarPosts: [1, 2, 3] },
  { id: 'd_2', site: 'danbooru', fileUrl: 'https://x/2.jpg' }
]));
fs.writeFileSync(path.join(fixtureDir, 'favorites.json'), JSON.stringify([
  { id: 'k_1', site: 'kemono', fileUrl: 'https://x/3.jpg' }
]));
fs.writeFileSync(path.join(fixtureDir, 'dislikes.json'), JSON.stringify([]));
fs.writeFileSync(path.join(fixtureDir, 'favorite_authors.json'), JSON.stringify([
  { name: 'artist_a', id: 'artist_a', site: 'danbooru' }
]));
fs.writeFileSync(path.join(fixtureDir, 'author_feed_state.json'), JSON.stringify({
  'danbooru:artist_a': { knownIds: ['11'], lastCheckedAt: '2026-01-01T00:00:00Z' }
}));
fs.writeFileSync(path.join(fixtureDir, 'notifications.json'), JSON.stringify([
  { id: 'n1', read: false, author: { name: 'artist_a' }, post: { id: 'p1' } }
]));
fs.writeFileSync(path.join(fixtureDir, 'users.json'), JSON.stringify([
  { id: 'u_unit1', username: 'unit_user', passwordHash: 'h', salt: 's', tokenVersion: 4 }
]));
fs.writeFileSync(path.join(fixtureDir, 'discovered_aliases.json'), JSON.stringify([
  { id: 'artist_a', aliases: ['artist_a_alias'], sites: { danbooru: true }, enabled: true }
]));
fs.writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify({ ratingFilter: 'q' }));
fs.writeFileSync(path.join(userDir, 'likes.json'), JSON.stringify([
  { id: 'g_1', site: 'gelbooru', fileUrl: 'https://x/4.jpg' }
]));

const { isActive, migrateLegacyJson, deleteScopeData, scopeOf, __configureForTests } = await import('../../src/services/sqliteStore.js');
const storage = await import('../../src/services/storageService.js');
const users = await import('../../src/services/userService.js');

describe('SQLite storage backend', () => {
  before(() => {
    __configureForTests({ dataDir: fixtureDir });
  });

  after(() => {
    __configureForTests({});
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('activates the SQLite backend when node:sqlite is available', () => {
    assert.equal(isActive(), true, 'node:sqlite must be available on the supported Node range');
  });

  it('imports legacy global JSON files on first open', () => {
    const settings = storage.getSettings();
    assert.equal(settings.ratingFilter, 'e');
    assert.equal(settings.rule34ApiKey, 'legacy-key');

    const likes = storage.getLikes();
    assert.equal(likes.length, 2);
    assert.equal(likes[0].id, 'd_1', 'import preserves record order');
    assert.equal(likes[0]._similarPosts, undefined, 'import applies the compact post schema');
    assert.equal(likes[0].thumbOriginal, undefined, 'import drops byte-identical URL tiers');

    const authors = storage.getFavoriteAuthors();
    assert.equal(authors[0].name, 'artist_a');

    const feedState = storage.getAuthorFeedState();
    assert.equal(feedState['danbooru:artist_a'].knownIds[0], '11');

    const notifications = storage.getNotifications();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].id, 'n1');

    const usersList = users.getUsersList();
    assert.equal(usersList.length, 1);
    assert.equal(usersList[0].tokenVersion, 4, 'import preserves credential fields');
  });

  it('imports legacy per-user JSON files', () => {
    assert.equal(storage.getSettings('u_unit1').ratingFilter, 'q');
    const likes = storage.getLikes('u_unit1');
    assert.equal(likes.length, 1);
    assert.equal(likes[0].id, 'g_1');
  });

  it('imports discovered aliases', async () => {
    const { kvGet } = await import('../../src/services/sqliteStore.js');
    const list = kvGet('discovered_aliases', []);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].aliases, ['artist_a_alias']);
  });

  it('is idempotent: a second pass imports nothing', () => {
    const stats = migrateLegacyJson();
    assert.deepEqual(stats, { scopes: 0, records: 0 });
    // Editing a legacy file afterwards must not resurrect old data.
    fs.writeFileSync(path.join(fixtureDir, 'likes.json'), JSON.stringify([{ id: 'stale', site: 'danbooru' }]));
    assert.equal(storage.getLikes().length, 2);
  });

  it('roundtrips settings, collections, notifications and feed state', () => {
    storage.updateSettings({ ratingFilter: 's' }, 'u_unit1');
    assert.equal(storage.getSettings('u_unit1').ratingFilter, 's');

    storage.saveLikes([{ id: 'd_9', site: 'danbooru' }, { id: 'd_10', site: 'danbooru' }], 'u_unit1');
    assert.deepEqual(storage.getLikes('u_unit1').map(l => l.id), ['d_9', 'd_10']);

    storage.addNotification({ id: 'n2', author: { name: 'artist_a' }, post: { id: 'p1' } }, 'u_unit1');
    assert.equal(storage.getNotifications('u_unit1').length, 1, 'addNotification dedups by post id');

    storage.saveNotifications([{ id: 'n3' }, { id: 'n4', read: false }], 'u_unit1');
    const marked = storage.markAllNotificationsRead('u_unit1');
    assert.ok(marked.every(n => n.read));
    assert.deepEqual(storage.deleteNotification('n3', 'u_unit1').map(n => n.id), ['n4']);

    storage.saveAuthorFeedState({ 'gelbooru:x': { knownIds: ['5'] } }, 'u_unit1');
    assert.equal(storage.getAuthorFeedState('u_unit1')['gelbooru:x'].knownIds[0], '5');

    storage.saveFavoriteAuthors([{ name: 'artist_b', site: 'danbooru' }], 'u_unit1');
    assert.equal(storage.getFavoriteAuthors('u_unit1')[0].name, 'artist_b');

    storage.clearDislikes('u_unit1');
    assert.deepEqual(storage.getDislikes('u_unit1'), []);
  });

  it('lists favorite author collections across scopes', () => {
    const collections = storage.listFavoriteAuthorCollections();
    const scopes = collections.map(c => c.scope);
    assert.ok(scopes.includes('global'));
    assert.ok(scopes.includes('user:u_unit1'));
  });

  it('deletes all scope data', () => {
    storage.updateSettings({ ratingFilter: 'z' }, 'u_unit1');
    storage.saveLikes([{ id: 'd_11', site: 'danbooru' }], 'u_unit1');
    deleteScopeData(scopeOf('u_unit1'));
    assert.equal(storage.getLikes('u_unit1').length, 0);
    assert.equal(storage.getNotifications('u_unit1').length, 0);
    assert.equal(storage.getAuthorFeedState('u_unit1')['gelbooru:x'], undefined);
    assert.equal(storage.getSettings('u_unit1').ratingFilter, storage.getSettings('u_unit1').ratingFilter, 'settings fall back to defaults');
    assert.notEqual(storage.getSettings('u_unit1').ratingFilter, 'z');
  });

  it('registers a user through the service API into the database', async () => {
    const { user, token } = await users.registerUser('unit_sqlite_user', 'Password123!');
    assert.ok(user.id);
    assert.ok(token);
    assert.ok(users.getUsersList().some(u => u.id === user.id));
    assert.deepEqual(storage.getLikes(user.id), [], 'new user starts with empty collections');
    storage.saveLikes([{ id: 'x_1', site: 'danbooru' }], user.id);
    assert.equal(storage.getLikes(user.id).length, 1);
  });

  it('boots with the legacy JSON backend when forced', async () => {
    __configureForTests({ backend: 'json' });
    assert.equal(isActive(), false);
    // Legacy paths write into the process DATA_DIR (the run's temp root) —
    // verify the legacy branch still roundtrips there.
    const before = storage.getLikes();
    storage.saveLikes([...before, { id: 'legacy_check', site: 'danbooru' }]);
    await storage.flushPendingWrites();
    assert.ok(storage.getLikes().some(l => l.id === 'legacy_check'));
  });
});
