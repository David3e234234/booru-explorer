// Ad-hoc check: run parsers both with and without the configured proxy, so a
// "site returns 0 posts" report can be attributed to the proxy or to the code
import fs from 'fs';
import { fetchGelbooru } from '../src/parsers/gelbooru.js';
import { fetchRule34 } from '../src/parsers/rule34.js';
import { fetchMoebooru } from '../src/parsers/moebooru.js';
import { fetchSafebooru } from '../src/parsers/safebooru.js';
import { fetchDanbooru } from '../src/parsers/danbooru.js';

const real = JSON.parse(fs.readFileSync(new URL('../data/settings.json', import.meta.url), 'utf-8'));

const params = { tags: '', page: 1, limit: 5, category: 'new' };

async function run(label, fn) {
  const started = Date.now();
  try {
    const posts = await fn();
    console.log(`${label}: ${Array.isArray(posts) ? posts.length : 'N/A'} posts, ${Date.now() - started} ms`);
  } catch (err) {
    console.log(`${label}: THREW ${err.name}: ${err.message} (${Date.now() - started} ms)`);
  }
}

for (const [mode, settings] of [['direct  ', {}], ['proxied ', real]]) {
  console.log(`--- ${mode} (globalProxy=${settings.globalProxy ? 'set' : 'none'}) ---`);
  await run('danbooru  ', () => fetchDanbooru(params, [], settings));
  await run('gelbooru  ', () => fetchGelbooru(params, [], settings));
  await run('rule34    ', () => fetchRule34(params, [], settings));
  await run('safebooru ', () => fetchSafebooru(params, [], settings));
  await run('yandere   ', () => fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', params, [], settings));
}
