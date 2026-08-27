import { normalizePawchivePost, getCreatorsDirectory } from '../src/parsers/pawchive.js';

const IMG = /\.(png|jpe?g|webp|gif|avif)$/i;
const VID = /\.(mp4|webm|mov|m4v)$/i;

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, data: await res.json() };
    } catch (e) {
      if (attempt === 2) return { ok: false, status: 'net' };
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

let found = null;
for (let o = 0; o <= 200 && !found; o += 50) {
  const r = await fetchJson(`https://pawchive.pw/api/v1/posts?o=${o}`);
  if (!r.ok) { console.log('feed HTTP', r.status, 'at o=', o); break; }
  const items = r.data;
  for (const it of items) {
    const coverIsImage = it.file && (it.file.path || '') && IMG.test(it.file.name || it.file.path);
    const atts = Array.isArray(it.attachments) ? it.attachments : [];
    const videoAtt = atts.find(a => a && a.path && VID.test(a.name || a.path));
    if (coverIsImage && videoAtt) { found = it; break; }
  }
  await new Promise(r => setTimeout(r, 1200));
}

if (!found) {
  console.log('no image-cover+video post found in first pages');
  process.exit(0);
}

console.log('raw post:', found.id, found.service, JSON.stringify(found.title || '').slice(0, 60));
console.log('raw order:', [found.file?.name, ...(found.attachments || []).map(a => a.name)].join(' | '));

const { map } = await getCreatorsDirectory();
const post = await normalizePawchivePost(found, map, null, []);

console.log('---');
console.log('post.isVideo:', post.isVideo, '| fileExt:', post.fileExt);
console.log('post.fileUrl:', (post.fileUrl || '').slice(0, 80));
console.log('albumItems order:', post.albumItems.map(a => `${a.fileExt}${a.isVideo ? '(video)' : ''}`).join(' | '));
console.log('cover image still present:', post.albumItems.some(a => !a.isVideo));
