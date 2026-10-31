import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getNotifications,
  saveNotifications,
  addNotification,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearNotifications,
  getAuthorFeedState,
  saveAuthorFeedState
} from '../../src/services/storageService.js';
import {
  buildAuthorQuery,
  checkAuthorNewPosts,
  scanFollowedAuthors
} from '../../src/services/notificationService.js';
import { sanitizeStoredPost } from '../../src/services/storedPostSchema.js';
import { createMockAgent, restoreDispatcher } from './parsers/harness.js';
import { formatRelativeTime } from '../../public/js/modules/notificationsUI.js';

describe('Notifications Subsystem Unit Tests', () => {
  const testUserId = 'test_user_notif_' + Date.now();

  beforeEach(() => {
    clearNotifications(testUserId);
    saveAuthorFeedState({}, testUserId);
  });

  describe('Storage & Operations', () => {
    it('returns empty array when no notifications exist', () => {
      const list = getNotifications(testUserId);
      assert.deepStrictEqual(list, []);
    });

    it('adds and retrieves notifications in reverse chronological order', () => {
      const notif1 = {
        id: 'notif_1',
        type: 'author_new_post',
        author: { name: 'artist_alpha' },
        post: { id: 101 },
        read: false,
        createdAt: new Date().toISOString()
      };
      const notif2 = {
        id: 'notif_2',
        type: 'author_new_post',
        author: { name: 'artist_beta' },
        post: { id: 102 },
        read: false,
        createdAt: new Date().toISOString()
      };

      addNotification(notif1, testUserId);
      addNotification(notif2, testUserId);

      const list = getNotifications(testUserId);
      assert.strictEqual(list.length, 2);
      assert.strictEqual(list[0].id, 'notif_2');
      assert.strictEqual(list[1].id, 'notif_1');
    });

    it('deduplicates notifications by id and by post/author', () => {
      const notif = {
        id: 'notif_dup_1',
        type: 'author_new_post',
        author: { name: 'artist_dup' },
        post: { id: 505 },
        read: false
      };

      addNotification(notif, testUserId);
      addNotification(notif, testUserId); // duplicate ID

      const samePost = {
        id: 'notif_dup_2',
        type: 'author_new_post',
        author: { name: 'artist_dup' },
        post: { id: 505 }, // duplicate post for same author
        read: false
      };
      addNotification(samePost, testUserId);

      const list = getNotifications(testUserId);
      assert.strictEqual(list.length, 1);
    });

    it('deduplicates notifications by seriesKey and albumItems for the same author', () => {
      const albumNotif = {
        id: 'notif_album_1',
        type: 'author_new_post',
        author: { name: 'artist_album' },
        post: { 
          id: 'post_100', 
          seriesKey: 'pixiv:99999',
          isAlbum: true,
          albumItems: [{ id: 'post_100' }, { id: 'post_101' }, { id: 'post_102' }]
        },
        read: false
      };
      addNotification(albumNotif, testUserId);

      // Attempt adding child item as separate notification
      const childNotif = {
        id: 'notif_child_1',
        type: 'author_new_post',
        author: { name: 'artist_album' },
        post: { id: 'post_101', seriesKey: 'pixiv:99999' },
        read: false
      };
      addNotification(childNotif, testUserId);

      const list = getNotifications(testUserId);
      assert.strictEqual(list.length, 1); // albumNotif added, childNotif blocked as duplicate
    });

    it('caps notifications to 100 items', () => {
      const batch = [];
      for (let i = 0; i < 120; i++) {
        batch.push({ id: `notif_${i}`, read: false, post: { id: i } });
      }
      saveNotifications(batch, testUserId);

      const list = getNotifications(testUserId);
      assert.strictEqual(list.length, 100);
    });

    it('marks a single notification as read', () => {
      const notif = { id: 'notif_read_1', read: false };
      addNotification(notif, testUserId);

      markNotificationRead('notif_read_1', testUserId);

      const list = getNotifications(testUserId);
      assert.strictEqual(list[0].read, true);
    });

    it('marks all notifications as read', () => {
      addNotification({ id: 'notif_a', read: false }, testUserId);
      addNotification({ id: 'notif_b', read: false }, testUserId);

      markAllNotificationsRead(testUserId);

      const list = getNotifications(testUserId);
      assert.strictEqual(list.every(n => n.read === true), true);
    });

    it('deletes a notification by id and clears all', () => {
      addNotification({ id: 'notif_del_1', read: false }, testUserId);
      addNotification({ id: 'notif_del_2', read: false }, testUserId);

      deleteNotification('notif_del_1', testUserId);
      let list = getNotifications(testUserId);
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, 'notif_del_2');

      clearNotifications(testUserId);
      list = getNotifications(testUserId);
      assert.strictEqual(list.length, 0);
    });
  });

  describe('Author Query Construction', () => {
    it('constructs basic tag for general Booru author', () => {
      const res = buildAuthorQuery({ name: 'vicineko', site: 'danbooru' });
      assert.strictEqual(res.site, 'danbooru');
      assert.strictEqual(res.tags, 'vicineko');
    });

    it('constructs artist: tag for rule34video', () => {
      const res = buildAuthorQuery({ name: 'artist_3d', site: 'rule34video' });
      assert.strictEqual(res.site, 'rule34video');
      assert.strictEqual(res.tags, 'artist:artist_3d');
    });

    it('constructs service: and user: tags for Kemono/Pawchive creators', () => {
      const res = buildAuthorQuery({ 
        name: 'creator_x', 
        site: 'kemono', 
        service: 'fanbox', 
        user: '123456' 
      });
      assert.strictEqual(res.site, 'kemono');
      assert.strictEqual(res.tags, 'service:fanbox user:123456');
    });

    it('normalizes author name spaces and leading @ or pixiv: prefixes', () => {
      const res = buildAuthorQuery({ name: '@pixiv: cool artist ', site: 'danbooru' });
      assert.strictEqual(res.tags, 'cool_artist');
    });

    it('supports explicit targetSite override independent of author.site', () => {
      const author = { name: 'ciloru', site: 'danbooru' };
      const resKemono = buildAuthorQuery(author, 'kemono');
      assert.strictEqual(resKemono.site, 'kemono');
      assert.strictEqual(resKemono.tags, 'artist:ciloru');

      const resR34v = buildAuthorQuery(author, 'rule34video');
      assert.strictEqual(resR34v.site, 'rule34video');
      assert.strictEqual(resR34v.tags, 'artist:ciloru');

      const resGel = buildAuthorQuery(author, 'gelbooru');
      assert.strictEqual(resGel.site, 'gelbooru');
      assert.strictEqual(resGel.tags, 'ciloru');
    });
  });

  describe('Relative Time Formatting', () => {
    it('formats just now, minutes ago, and hours ago correctly', () => {
      const now = new Date();
      assert.strictEqual(formatRelativeTime(now.toISOString()), 'Только что');

      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      assert.strictEqual(formatRelativeTime(fiveMinsAgo.toISOString()), '5 мин назад');

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      assert.strictEqual(formatRelativeTime(twoHoursAgo.toISOString()), '2 ч назад');

      const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
      assert.strictEqual(formatRelativeTime(yesterday.toISOString()), 'Вчера');
    });
  });

  describe('Author Scan Logic', () => {
    it('skips scanning when notifications are disabled in settings', async () => {
      const result = await scanFollowedAuthors(testUserId, {
        authors: [{ name: 'test_author', site: 'danbooru' }],
        settings: { notificationsEnabled: false }
      });
      assert.strictEqual(result.disabled, true);
      assert.strictEqual(result.newCount, 0);
    });

    it('handles empty author subscriptions gracefully', async () => {
      const result = await scanFollowedAuthors(testUserId, {
        authors: [],
        settings: { notificationsEnabled: true }
      });
      assert.strictEqual(result.newCount, 0);
      assert.strictEqual(result.checkedAuthors, 0);
    });

    it('scans author across notificationSites instead of author.site', async () => {
      const mockContext = createMockAgent();
      try {
        const safeClient = mockContext.agent.get('https://safebooru.org');
        safeClient.intercept({
          path: (p) => p.includes('page=dapi') && p.includes('json=1'),
          method: 'GET'
        }).reply(200, [
          {
            id: 3001,
            directory: 'sample_dir',
            image: 'img_3001.jpg',
            tags: 'artist_safe solo',
            rating: 'safe',
            width: 1000,
            height: 1000
          }
        ]);

        const author = {
          name: 'artist_safe',
          site: 'danbooru', // search preference
          notificationSites: ['safebooru'] // individual notification sources
        };
        const seedResult = await checkAuthorNewPosts(author, testUserId);
        assert.strictEqual(seedResult.isInitialSeed, true);

        const feedState = getAuthorFeedState(testUserId);
        assert.ok(feedState['safebooru:artist_safe']);
        assert.strictEqual(feedState['danbooru:artist_safe'], undefined);
      } finally {
        restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
      }
    });

    it('preserves album items in notification post when keepAlbumItems is true', () => {
      const albumPost = {
        id: 'post_100',
        site: 'danbooru',
        isAlbum: true,
        albumCount: 2,
        albumItems: [
          { id: 'item_1', fileUrl: 'https://example.com/1.jpg' },
          { id: 'item_2', fileUrl: 'https://example.com/2.jpg' }
        ]
      };
      const regular = sanitizeStoredPost(albumPost);
      assert.strictEqual(regular.albumItems, undefined);

      const notifPost = sanitizeStoredPost(albumPost, { keepAlbumItems: true });
      assert.ok(Array.isArray(notifPost.albumItems));
      assert.strictEqual(notifPost.albumItems.length, 2);
      assert.strictEqual(notifPost.albumItems[0].id, 'item_1');
    });
  });
});
