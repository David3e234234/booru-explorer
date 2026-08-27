import { fetchPawchive } from '../src/parsers/pawchive.js';

const svc = process.argv[2] || '';
const t0 = Date.now();
const posts = await fetchPawchive({ tags: 'artist:hideakiaki', page: 1, limit: 10, pawchiveService: svc }, [], {});
console.log('service filter:', svc || '(none)', '=> posts:', posts.length, 'in', Date.now() - t0, 'ms');
const users = new Set(posts.map(p => (p.source || '').match(/user\/(\d+)/)?.[1]));
console.log('users:', [...users], 'author:', posts[0]?.author, 'site services:', [...new Set(posts.map(p => (p.source || '').match(/pawchive\.pw\/([^/]+)\//)?.[1]))]);
