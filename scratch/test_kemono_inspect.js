
async function test() {
  const path = '/a9/9e/a99e7600fd0f5050aa5465cf7d45617d92f935fa2aa30ba1b0c41b1cc0c13273.png';
  const name = 'MitsuruFATSample.png';
  const urls = [
    `https://img.kemono.cr/thumbnail/data${path}`,
    `https://img.kemono.cr/data${path}?f=${encodeURIComponent(name)}`,
    `https://img.kemono.su/thumbnail/data${path}`,
    `https://img.kemono.su/data${path}?f=${encodeURIComponent(name)}`,
    `https://n1.kemono.su/data${path}?f=${encodeURIComponent(name)}`,
    `https://kemono.su/data${path}?f=${encodeURIComponent(name)}`
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000)
      });
      console.log(u.slice(0, 30), 'status:', r.status, 'size:', r.headers.get('content-length'));
    } catch (e) {
      console.log(u.slice(0, 30), 'error:', e.message);
    }
  }
}
test();