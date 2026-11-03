// Manual smoke of the SQLite storage adapter: legacy import, roundtrip,
// idempotency. Run: node scratch/sqlite_smoke.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'booru-sqlite-smoke-'));
const { __configureForTests, isActive } = await import('../src/services/sqliteStore.js');

// Build a fake legacy data dir BEFORE first init (init auto-migrates).
const usersDir = path.join(tmp, 'users', 'u_abc123');
fs.mkdirSync(usersDir, { recursive: true });
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ ratingFilter: 'e', rule34ApiKey: 'k' }));
fs.writeFileSync(path.join(tmp, 'likes.json'), JSON.stringify([{ id: 'd_1', site: 'danbooru', fileUrl: 'x', thumbOriginal: 'x', _internal: 1 }]));
fs.writeFileSync(path.join(tmp, 'discovered_aliases.json'), JSON.stringify([{ id: 'a1', aliases: ['x'], sites: {}, enabled: true }]));
fs.writeFileSync(path.join(tmp, 'users.json'), JSON.stringify([{ id: 'u_abc123', username: 'alice', passwordHash: 'h', salt: 's', tokenVersion: 2 }]));
fs.writeFileSync(path.join(usersDir, 'settings.json'), JSON.stringify({ ratingFilter: 'q' }));
fs.writeFileSync(path.join(usersDir, 'favorites.json'), JSON.stringify([{ id: 'k_9', site: 'kemono' }]));
fs.writeFileSync(path.join(usersDir, 'notifications.json'), JSON.stringify([{ id: 'n1', read: false, author: { name: 'bob' }, post: { id: 'p1' } }]));

__configureForTests({ dataDir: tmp });
const storage = await import('../src/services/storageService.js');
const users = await import('../src/services/userService.js');

console.log('sqlite active:', isActive());
console.log('global settings:', JSON.stringify(storage.getSettings().ratingFilter), 'key kept:', storage.getSettings().rule34ApiKey === 'k');
console.log('global likes:', JSON.stringify(storage.getLikes()));
console.log('likes compacted (no thumbOriginal/_internal):', !('thumbOriginal' in storage.getLikes()[0]) && !('_internal' in storage.getLikes()[0]));
console.log('user settings:', storage.getSettings('u_abc123').ratingFilter);
console.log('user favorites:', JSON.stringify(storage.getFavorites('u_abc123')));
console.log('user notifications:', JSON.stringify(storage.getNotifications('u_abc123')));
console.log('users index:', users.getUsersList().length === 1 && users.getUsersList()[0].tokenVersion === 2);

// Idempotent second pass
const { migrateLegacyJson } = await import('../src/services/sqliteStore.js');
console.log('second migrate no-op:', JSON.stringify(migrateLegacyJson()));

// Roundtrip writes
storage.saveLikes([{ id: 'd_2', site: 'danbooru' }], 'u_abc123');
console.log('likes roundtrip:', storage.getLikes('u_abc123')[0].id === 'd_2');
storage.addNotification({ id: 'n2', post: { id: 'p1' }, author: { name: 'bob' } }, 'u_abc123');
console.log('notif dedup (same post p1):', storage.getNotifications('u_abc123').length === 1);
storage.saveAuthorFeedState({ 'danbooru:x': { knownIds: ['1'] } }, 'u_abc123');
console.log('feed state roundtrip:', storage.getAuthorFeedState('u_abc123')['danbooru:x'].knownIds.length === 1);

// users list mutation through userService API
users.revokeUserTokens('u_abc123');
console.log('token version bumped:', users.getUsersList()[0].tokenVersion === 3);

// JSON fallback backend
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'booru-json-smoke-'));
__configureForTests({ dataDir: tmp2, backend: 'json' });
console.log('json fallback active:', !isActive());
storage.getSettings === storage.getSettings;
console.log('json settings roundtrip:', (storage.updateSettings({ ratingFilter: 's' }), storage.getSettings().ratingFilter === 's'));
await storage.flushPendingWrites();
console.log('json settings file exists:', fs.existsSync(path.join(tmp2, 'settings.json')));

__configureForTests({});
console.log('OK');
