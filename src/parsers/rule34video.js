import { fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, classifyTags } from '../utils/tagHelpers.js';
import { logError } from '../utils/logger.js';

export async function fetchRule34Video(params, aiTagsList) {
  const { tags = '', page = 1, limit = 80, category = '', ratingFilter = 'all', ageFilter = 'all' } = params;
  if (ratingFilter === 'sfw') {
    return [];
  }

  let rawTags = tags.trim();
  if (ageFilter === 'young' && !rawTags) {
    rawTags = 'small tits';
  } else if (ageFilter === 'adult' && !rawTags) {
    rawTags = 'big tits';
  }

  const cleanQuery = rawTags.replace(/[_+\s]+/g, '-').replace(/-+/g, '-').toLowerCase();
  
  const pagesPerBatch = 4;
  const startFrom = (page - 1) * pagesPerBatch + 1;
  const pageNumbers = Array.from({ length: pagesPerBatch }, (_, i) => startFrom + i);

  const allPosts = [];
  const seenIds = new Set();

  const fetchPromises = pageNumbers.map(async (p) => {
    let url = '';
    const isPopular = (category === 'popular' || category === 'top' || category === 'recommended');
    if (cleanQuery) {
      const sortByParam = isPopular ? '&sort_by=most_popular' : '';
      url = `https://rule34video.com/search/${encodeURIComponent(cleanQuery)}/?mode=async&function=get_block&block_id=custom_list_videos_videos_list_search&q=${encodeURIComponent(cleanQuery)}${sortByParam}&from_videos=${p}`;
    } else if (isPopular) {
      url = `https://rule34video.com/top-rated/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&from=${p}`;
    } else {
      url = `https://rule34video.com/latest-updates/?mode=async&function=get_block&block_id=custom_list_videos_latest_videos_list&from=${p}`;
    }

    try {
      const res = await fetchSafe(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 10000
      });
      if (!res.ok) return [];
      const html = await res.text();

      const blocks = html.split('<div class="item').slice(1);
      const pageResults = [];

      for (const block of blocks) {
        const linkMatch = block.match(/href="([^"]*video\/(\d+)\/([^"]*))"\s+title="([^"]*)"/);
        const thumbMatch = block.match(/data-original="([^"]*)"/) || block.match(/src="([^"]*)"/);
        const previewMatch = block.match(/data-preview="([^"]*)"/);
        if (!linkMatch) continue;

        const id = linkMatch[2];
        const pageUrl = linkMatch[1];
        const slug = linkMatch[3] || '';
        const rawTitle = linkMatch[4] || 'Rule34 Video';
        const title = rawTitle.replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        const thumb = thumbMatch ? thumbMatch[1] : '';
        const previewMp4 = previewMatch ? previewMatch[1] : '';

        let author = '';
        const authorBracketMatch = title.match(/^\[([^\]]+)\]/);
        const authorPipeMatch = title.match(/\|\s*([a-zA-Z0-9_\- ]+)$/);
        const authorByMatch = title.match(/by\s+([a-zA-Z0-9_\- ]+)/i);

        if (authorPipeMatch) {
          author = authorPipeMatch[1].trim();
        } else if (authorByMatch) {
          author = authorByMatch[1].trim();
        } else if (authorBracketMatch) {
          const bracketTag = authorBracketMatch[1].trim();
          if (!['pmv', 'hmv', 'sfx', '3d', '2d', 'zzz', '4k', '60fps', 'hd'].includes(bracketTag.toLowerCase())) {
            author = bracketTag;
          }
        }

        const rawTagsSet = new Set(['video', 'animated']);
        slug.split(/[-_/]+/).filter(s => s.length > 1).forEach(s => rawTagsSet.add(s.toLowerCase()));
        title.toLowerCase().split(/[\s,()\[\]\-_/|"]+/).filter(s => s.length > 1).forEach(s => rawTagsSet.add(s));

        if (cleanQuery) {
          cleanQuery.split('-').filter(Boolean).forEach(q => rawTagsSet.add(q));
          rawTagsSet.add(cleanQuery.replace(/-/g, '_'));
        }
        if (author) {
          rawTagsSet.add(author.toLowerCase().replace(/\s+/g, '_'));
          rawTagsSet.add(author.toLowerCase());
        }

        const rawTags = Array.from(rawTagsSet);
        const isAi = checkIsAi(rawTags, aiTagsList);
        const tagDetails = classifyTags(rawTags, author);

        let duration = 0;
        let durationText = '';
        const durMatch = block.match(/class="[^"]*duration[^"]*">([^<]+)<\/span>/i) || block.match(/data-duration="([^"]+)"/i) || block.match(/(\d+:\d+(?::\d+)?)/);
        if (durMatch) {
          const rawDur = durMatch[1].trim();
          durationText = rawDur;
          const parts = rawDur.split(':').map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            duration = parts[0] * 60 + parts[1];
          } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
        }

        pageResults.push({
          id: `rule34video_${id}`,
          originalId: String(id),
          site: 'rule34video',
          siteName: 'Rule34Video',
          title,
          author,
          previewUrl: resolvePreviewUrl(thumb, previewMp4, previewMp4, true),
          sampleUrl: previewMp4,
          fileUrl: previewMp4,
          fileExt: 'mp4',
          isVideo: true,
          isGif: false,
          hasSound: true,
          duration,
          durationText,
          tags: rawTags,
          tagDetails,
          score: 100,
          rating: 'e',
          width: 1280,
          height: 720,
          source: pageUrl,
          createdAt: '',
          isAi
        });
      }
      return pageResults;
    } catch (err) {
      logError('Rule34Video', `Ошибка загрузки страницы ${p}`, err);
      return [];
    }
  });

  const batchResults = await Promise.all(fetchPromises);
  for (const pagePosts of batchResults) {
    for (const post of pagePosts) {
      if (!seenIds.has(post.originalId)) {
        seenIds.add(post.originalId);
        allPosts.push(post);
      }
    }
  }

  return allPosts;
}
