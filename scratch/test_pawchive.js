async function test() {
  const posts = await fetch('https://pawchive.pw/api/v1/posts?o=0').then(r => r.json());
  console.log(`Fetched ${posts.length} posts`);
  let hasCover = 0;
  let hasAttachments = 0;
  let isVideoCount = 0;
  let extensions = new Set();

  posts.forEach(p => {
    if (p.file && p.file.name) {
      hasCover++;
      const ext = p.file.name.split('.').pop().toLowerCase();
      extensions.add(ext);
      if (['mp4', 'webm', 'mov'].includes(ext)) isVideoCount++;
    }
    if (p.attachments && p.attachments.length > 0) {
      hasAttachments++;
      p.attachments.forEach(a => {
        if (a.name) extensions.add(a.name.split('.').pop().toLowerCase());
      });
    }
  });

  console.log({ hasCover, hasAttachments, isVideoCount, extensions: Array.from(extensions) });
  
  // Test fetching one image thumbnail and one file
  const sampleWithFile = posts.find(p => p.file && p.file.path && (p.file.name.endsWith('.jpg') || p.file.name.endsWith('.png') || p.file.name.endsWith('.jpeg')));
  if (sampleWithFile) {
    const thumbUrl = `https://img.pawchive.pw/thumbnail/data${sampleWithFile.file.path}`;
    const fileUrl = `https://file.pawchive.pw/data${sampleWithFile.file.path}?f=${sampleWithFile.file.name}`;
    console.log('Testing thumbUrl:', thumbUrl);
    const resThumb = await fetch(thumbUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('Thumb status:', resThumb.status, resThumb.headers.get('content-type'), resThumb.headers.get('content-length'));
    console.log('Testing fileUrl:', fileUrl);
    const resFile = await fetch(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('File status:', resFile.status, resFile.headers.get('content-type'), resFile.headers.get('content-length'));
  }
}
test().catch(console.error);
