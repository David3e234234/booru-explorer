import { fetchSafe } from '../src/utils/network.js';

async function main() {
  const r = await fetchSafe('https://pawchive.pw/fanbox/user/97869630/post/12154911');
  const html = await r.text();
  console.log('HTML length:', html.length);
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  const links = [];
  while ((m = re.exec(html)) !== null) {
    if (m[1].includes('pawchive.pw') || m[1].includes('/data/')) {
      links.push(m[1]);
    }
  }
  console.log('Pawchive media links:', links);
}

main().catch(console.error);
