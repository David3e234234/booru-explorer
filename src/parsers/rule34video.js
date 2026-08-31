import { fetchSafe, resolvePreviewUrl, discardResponse } from '../utils/network.js';
import { checkIsAi, classifyTags } from '../utils/tagHelpers.js';
import { logError } from '../utils/logger.js';

// Insertion-ordered eviction: these caches previously grew without bound
// (one entry per resolved author/video for the whole uptime)
const RESOLVED_CACHE_MAX = 500;
const resolvedAuthorCache = new Map();

function cacheResolved(map, key, value) {
  if (map.size >= RESOLVED_CACHE_MAX && !map.has(key)) {
    map.delete(map.keys().next().value);
  }
  map.set(key, value);
}

/**
 * Resolves an author/artist/model name to Rule34Video IDs (model_ids, channels, members)
 */
export async function resolveRule34VideoAuthor(authorQuery, settings = {}) {
  if (!authorQuery) return null;
  const clean = authorQuery
    .replace(/^(?:channel|user|account|artist|author|uploader|creator|member|model):\s*/i, '')
    .replace(/[_+]+/g, ' ')
    .trim();
  
  if (!clean) return null;

  // Already a numeric ID with a type
  const directModelIdMatch = authorQuery.match(/^(?:model|artist|author):(\d+)$/i);
  if (directModelIdMatch) {
    return { type: 'model', id: directModelIdMatch[1], slug: '', name: directModelIdMatch[1] };
  }
  const directChannelIdMatch = authorQuery.match(/^channel:(\d+)$/i);
  if (directChannelIdMatch) {
    return { type: 'channel', id: directChannelIdMatch[1], slug: '', name: directChannelIdMatch[1] };
  }
  const directMemberIdMatch = authorQuery.match(/^(?:member|user|uploader):(\d+)$/i);
  if (directMemberIdMatch) {
    return { type: 'member', id: directMemberIdMatch[1], slug: '', name: directMemberIdMatch[1] };
  }

  const cacheKey = clean.toLowerCase();
  if (resolvedAuthorCache.has(cacheKey)) {
    return resolvedAuthorCache.get(cacheKey);
  }

  try {
    // 1. Official Rule34Video JSON API for model/author search
    const modelJsonUrl = `https://rule34video.com/models_json.php?advanced_search=true&q=${encodeURIComponent(clean)}`;
    const resModelJson = await fetchSafe(modelJsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000,
      settings,
      site: 'rule34video'
    });

    if (resModelJson.ok) {
      const data = await resModelJson.json();
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        // Look for an exact or the closest match
        const cleanNoSpace = clean.toLowerCase().replace(/[\s_]+/g, '');
        const exact = data.items.find(i => (i.title || '').toLowerCase().replace(/[\s_]+/g, '') === cleanNoSpace) || data.items[0];
        if (exact && exact.id) {
          const result = {
            type: 'model',
            id: String(exact.id),
            name: exact.title || clean,
            total: parseInt(exact.total, 10) || 0
          };
          cacheResolved(resolvedAuthorCache, cacheKey, result);
          return result;
        }
      }
    }

    // 2. Search channels
    const channelUrl = `https://rule34video.com/channels/?mode=async&function=get_block&block_id=custom_list_channels_common_channels_list&q=${encodeURIComponent(clean)}&from=1`;
    const resChannel = await fetchSafe(channelUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000,
      settings,
      site: 'rule34video'
    });

    if (resChannel.ok) {
      const html = await resChannel.text();
      const channelMatch = html.match(/href="[^"]*\/channels\/(\d+)(?:\/([^"/?#]+))?\/?(?:\?|")[^>]*>([^<]*)<\/a>/i) ||
                           html.match(/href="[^"]*\/channels\/(\d+)(?:\/([^"/?#]+))?\/?/i);
      if (channelMatch && channelMatch[1]) {
        const id = channelMatch[1];
        const slug = channelMatch[2] || '';
        const name = (channelMatch[3] || slug || clean).replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        const result = { type: 'channel', id, slug, name: name || clean };
        cacheResolved(resolvedAuthorCache, cacheKey, result);
        return result;
      }
    }

    // 3. Search members/uploaders
    const memberUrl = `https://rule34video.com/members/?mode=async&function=get_block&block_id=custom_list_members_common_members_list&q=${encodeURIComponent(clean)}&from=1`;
    const resMember = await fetchSafe(memberUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000,
      settings,
      site: 'rule34video'
    });

    if (resMember.ok) {
      const html = await resMember.text();
      const memberMatch = html.match(/href="[^"]*\/members\/(\d+)(?:\/([^"/?#]+))?\/?(?:\?|")[^>]*>([^<]*)<\/a>/i) ||
                          html.match(/href="[^"]*\/members\/(\d+)(?:\/([^"/?#]+))?\/?/i);
      if (memberMatch && memberMatch[1]) {
        const id = memberMatch[1];
        const slug = memberMatch[2] || '';
        const name = (memberMatch[3] || slug || clean).replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        const result = { type: 'member', id, slug, name: name || clean };
        cacheResolved(resolvedAuthorCache, cacheKey, result);
        return result;
      }
    }
  } catch (err) {
    logError('Rule34Video Author Resolve', `Ошибка разрешения автора ${clean}`, err);
  }

  return null;
}

export async function fetchRule34Video(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 80, category = '', ratingFilter = 'all', ageFilter = 'all' } = params;
  if (ratingFilter === 'sfw') {
    return [];
  }

  let rawTags = (tags || '').trim();
  if (ageFilter === 'young' && !rawTags) {
    rawTags = 'small tits';
  } else if (ageFilter === 'adult' && !rawTags) {
    rawTags = 'big tits';
  }

  const tokens = rawTags.split(/\s+/).filter(Boolean);
  const authorTokens = tokens.filter(t => /^(?:channel|user|account|artist|author|uploader|creator|member|model):/i.test(t));
  const generalTokens = tokens.filter(t => !/^(?:channel|user|account|artist|author|uploader|creator|member|model):/i.test(t) && !t.startsWith('-'));

  let extractedAuthor = '';
  if (authorTokens.length > 0) {
    extractedAuthor = authorTokens[0]
      .replace(/^(?:channel|user|account|artist|author|uploader|creator|member|model):\s*/i, '')
      .replace(/[_+]+/g, ' ')
      .trim();
  } else if (tokens.length === 1 && !tokens[0].startsWith('-')) {
    extractedAuthor = tokens[0].replace(/[_+]+/g, ' ').trim();
  }

  const cleanGeneralQuery = generalTokens.map(t => t.replace(/[_+]+/g, ' ')).join(' ').trim();

  let authorTarget = null;
  if (extractedAuthor) {
    authorTarget = await resolveRule34VideoAuthor(extractedAuthor, settings);
  }

  // Search query for KVS search
  let cleanQuery = '';
  if (authorTarget && cleanGeneralQuery) {
    cleanQuery = cleanGeneralQuery;
  } else if (cleanGeneralQuery && extractedAuthor && !authorTarget) {
    cleanQuery = `${extractedAuthor} ${cleanGeneralQuery}`.trim();
  } else if (cleanGeneralQuery) {
    cleanQuery = cleanGeneralQuery;
  } else if (extractedAuthor && !authorTarget) {
    cleanQuery = extractedAuthor;
  }
  
  const pagesPerBatch = 4;
  const startFrom = (page - 1) * pagesPerBatch + 1;
  const pageNumbers = Array.from({ length: pagesPerBatch }, (_, i) => startFrom + i);

  const allPosts = [];
  const seenIds = new Set();

  let sortByParam = '';
  if (category === 'top') {
    sortByParam = '&sort_by=rating';
  } else if (category === 'views') {
    sortByParam = '&sort_by=video_viewed';
  } else if (category === 'hot' || category === 'popular' || category === 'recommended') {
    sortByParam = '&sort_by=most_popular';
  } else if (category === 'random') {
    sortByParam = '&sort_by=random';
  } else {
    sortByParam = '&sort_by=post_date';
  }

  const nonAuthorTags = new Set([
    'pmv', 'hmv', 'sfx', '3d', '2d', 'zzz', '4k', '60fps', 'hd', 'animated', 'loop', 
    'audio', 'voiced', 'preview', 'commission', 'no ai', 'rus sub', 'eng sub', 
    'full video', 'wuthering waves', 'genshin impact', 'zenless zone zero', 
    'honkai star rail', 'christmas', 'sex', 'r18', 'uncensored', 'decensored', 'mmd', 'compilation',
    'sfm', 'animation', 'sound', 'leak', 'patreon', 'remastered', 'fan animation', 'ai', 'vr',
    'trailer', 'gameplay', 'hentai', 'full', 'oc', 'blender', '720p', '1080p', '480p', '2160p',
    'part 1', 'part 2', 'part 3', 'part 4', 'part 5', 'short', 'redub', 'with sound'
  ]);

  const fetchPromises = pageNumbers.map(async (p) => {
    let url = '';
    if (authorTarget) {
      // Find an author's videos by their Rule34Video ID (model_ids, channel, or member)
      if (authorTarget.type === 'model') {
        url = `https://rule34video.com/search/?mode=async&function=get_block&block_id=custom_list_videos_videos_list_search&model_ids=${authorTarget.id}${sortByParam}&from_videos=${p}`;
      } else if (authorTarget.type === 'channel') {
        const slugPart = authorTarget.slug ? `${authorTarget.slug}/` : '';
        url = `https://rule34video.com/channels/${authorTarget.id}/${slugPart}?mode=async&function=get_block&block_id=custom_list_videos_channel_videos${sortByParam}&from=${p}`;
      } else if (authorTarget.type === 'member') {
        url = `https://rule34video.com/members/${authorTarget.id}/videos/?mode=async&function=get_block&block_id=custom_list_videos_member_videos${sortByParam}&from=${p}`;
      }
    } else if (cleanQuery) {
      const urlSlug = cleanQuery.replace(/[\s_]+/g, '-');
      url = `https://rule34video.com/search/${encodeURIComponent(urlSlug)}/?mode=async&function=get_block&block_id=custom_list_videos_videos_list_search&q=${encodeURIComponent(cleanQuery)}${sortByParam}&from_videos=${p}`;
    } else if (category === 'top') {
      url = `https://rule34video.com/top-rated/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&from=${p}`;
    } else if (category === 'views') {
      url = `https://rule34video.com/most-popular/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&sort_by=video_viewed&from=${p}`;
    } else if (category === 'hot' || category === 'popular' || category === 'recommended') {
      url = `https://rule34video.com/most-popular/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&from=${p}`;
    } else if (category === 'random') {
      url = `https://rule34video.com/most-popular/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&sort_by=random&from=${p}`;
    } else if (rawTags) {
      // If the user supplied a query but it produced no URL, do NOT return random videos!
      return [];
    } else {
      url = `https://rule34video.com/latest-updates/?mode=async&function=get_block&block_id=custom_list_videos_latest_videos_list&from=${p}`;
    }

    try {
      const res = await fetchSafe(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 10000,
        settings,
        site: 'rule34video'
      });
      if (!res.ok) {
        await discardResponse(res);
        return [];
      }
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

        // 1. Extract the author from the account/channel/uploader link in the block HTML
        let author = '';
        const channelMatch = block.match(/href="[^"]*\/channels\/([^"/?#]+)\/?"[^>]*>([^<]+)<\/a>/i);
        const memberMatch = block.match(/href="[^"]*\/members\/([^"/?#]+)\/?"[^>]*>([^<]+)<\/a>/i);
        const uploaderMatch = block.match(/class="[^"]*(?:uploader|author|user|channel-name|item-user)[^"]*"[^>]*>([^<]+)<\/[^>]+>/i);

        if (channelMatch && channelMatch[2]) {
          author = channelMatch[2].trim();
        } else if (memberMatch && memberMatch[2]) {
          author = memberMatch[2].trim();
        } else if (uploaderMatch && uploaderMatch[1]) {
          author = uploaderMatch[1].trim();
        }

        // 2. No account link in the block - deep-search the title for the author
        if (!author) {
          // a) 'by Author' pattern
          const authorByMatch = title.match(/\bby\s+@?([a-zA-Z0-9_\- ]+?)(?:\s*\[|\s*\(|\s*\||\s*-\s*|$)/i);
          if (authorByMatch) {
            const candidate = authorByMatch[1].trim();
            if (!nonAuthorTags.has(candidate.toLowerCase()) && !/^\d+p$/i.test(candidate) && candidate.length >= 2 && candidate.length <= 40) {
              author = candidate;
            }
          }

          // b) Leading square brackets [Author]: e.g. [Misfitbite] Depraved Diva
          if (!author) {
            const startBracketMatch = title.match(/^\[([^\]]+)\]/);
            if (startBracketMatch) {
              const candidate = startBracketMatch[1].trim();
              const parts = candidate.split(/[,/]+/).map(p => p.trim()).filter(Boolean);
              for (const part of parts) {
                if (!nonAuthorTags.has(part.toLowerCase()) && !/^\d+p$/i.test(part) && part.length >= 2 && part.length <= 40) {
                  author = part;
                  break;
                }
              }
            }
          }

          // c) Pipe separator: 'Title | Author'
          if (!author) {
            const authorPipeMatch = title.match(/\|\s*([a-zA-Z0-9_\- ]+)$/);
            if (authorPipeMatch) {
              const candidate = authorPipeMatch[1].trim();
              if (!nonAuthorTags.has(candidate.toLowerCase()) && !/^\d+p$/i.test(candidate) && candidate.length >= 2 && candidate.length <= 40) {
                author = candidate;
              }
            }
          }

          // d) Search the remaining square brackets for [Author]
          if (!author) {
            const brackets = [...title.matchAll(/\[([^\]]+)\]/g)];
            for (const b of brackets) {
              const candidate = b[1].trim();
              const parts = candidate.split(/[,/]+/).map(p => p.trim()).filter(Boolean);
              for (const part of parts) {
                if (!nonAuthorTags.has(part.toLowerCase()) && !/^\d+p$/i.test(part) && part.length >= 2 && part.length <= 40) {
                  author = part;
                  break;
                }
              }
              if (author) break;
            }
          }
        }

        // 3. Fall back to the author/channel found in the query
        if (authorTarget) {
          author = authorTarget.name || author;
        } else if (!author && extractedAuthor) {
          author = extractedAuthor;
        }

        // Filter by author only when it was NOT resolved to an exact model/channel ID (text search)
        if (!authorTarget && extractedAuthor && authorTokens.length > 0) {
          const cleanRequestedAuthor = extractedAuthor.toLowerCase().replace(/[\s_]+/g, '');
          const postAuthorClean = (author || '').toLowerCase().replace(/[\s_]+/g, '');
          const titleClean = title.toLowerCase().replace(/[\s_]+/g, '');
          const slugClean = slug.toLowerCase().replace(/[\s_]+/g, '');
          
          const matchesAuthor = postAuthorClean.includes(cleanRequestedAuthor) ||
                                titleClean.includes(cleanRequestedAuthor) ||
                                slugClean.includes(cleanRequestedAuthor);
          if (!matchesAuthor) {
            continue; // Skip clips by other authors
          }
        }

        // Filter by shared tags when set (e.g. zenless_zone_zero)
        if (generalTokens.length > 0) {
          const titleAndSlug = `${title.toLowerCase()} ${slug.toLowerCase()}`;
          const allGeneralMatch = generalTokens.every(gt => {
            const cleanGt = gt.toLowerCase().replace(/_/g, ' ');
            const parts = cleanGt.split(/\s+/).filter(p => p.length > 2);
            return titleAndSlug.includes(cleanGt) || 
                   (parts.length > 0 && parts.some(p => titleAndSlug.includes(p)));
          });
          if (!allGeneralMatch) {
            continue;
          }
        }

        const rawTagsSet = new Set(['video', 'animated']);
        slug.split(/[-_/]+/).filter(s => s.length > 1).forEach(s => rawTagsSet.add(s.toLowerCase()));
        title.toLowerCase().split(/[\s,()\[\]\-_/|"]+/).filter(s => s.length > 1).forEach(s => rawTagsSet.add(s));

        if (cleanQuery) {
          cleanQuery.split(/[\s-]+/).filter(Boolean).forEach(q => rawTagsSet.add(q.toLowerCase()));
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
        const durMatch = block.match(/class="[^"]*duration[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                         block.match(/data-duration="([^"]+)"/i) ||
                         block.match(/class="[^"]*(?:time|length)[^"]*"[^>]*>([^<]+)<\/span>/i);
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

        // Parse the view count
        let views = 0;
        let viewsText = '';
        const viewsMatch = block.match(/class="[^"]*views[^"]*"[^>]*>[\s\S]*?<\/svg>\s*([^<]+)<\/div>/i) ||
                           block.match(/class="[^"]*views[^"]*"[^>]*>([^<]+)<\/div>/i);
        if (viewsMatch) {
          viewsText = viewsMatch[1].trim();
          const numMatch = viewsText.match(/^([\d.,]+)\s*([KkMmBb])?$/);
          if (numMatch) {
            let val = parseFloat(numMatch[1].replace(',', '.'));
            const mult = (numMatch[2] || '').toUpperCase();
            if (mult === 'K') val *= 1000;
            else if (mult === 'M') val *= 1000000;
            else if (mult === 'B') val *= 1000000000;
            views = Math.round(val);
          }
        }

        // Parse the rating / score
        let score = 0;
        const ratingMatch = block.match(/class="[^"]*rating[^"]*"[^>]*>[\s\S]*?<\/svg>\s*([^<]+)<\/div>/i) ||
                            block.match(/class="[^"]*rating[^"]*"[^>]*>([^<]+)<\/div>/i);
        if (ratingMatch) {
          const rawRating = ratingMatch[1].trim();
          const countMatch = rawRating.match(/\((\d+)\)/);
          if (countMatch) {
            score = parseInt(countMatch[1], 10) || 0;
          } else {
            const pctMatch = rawRating.match(/(\d+)/);
            if (pctMatch) score = parseInt(pctMatch[1], 10) || 0;
          }
        }

        // Parse the relative upload date
        let createdAt = '';
        const addedMatch = block.match(/class="[^"]*added[^"]*"[^>]*>[\s\S]*?<\/svg>\s*([^<]+)<\/div>/i) ||
                           block.match(/class="[^"]*added[^"]*"[^>]*>([^<]+)<\/div>/i);
        if (addedMatch) {
          const addedText = addedMatch[1].trim().toLowerCase();
          const num = parseInt(addedText, 10) || 1;
          const now = Date.now();
          if (addedText.includes('minute') || addedText.includes('min')) {
            createdAt = new Date(now - num * 60 * 1000).toISOString();
          } else if (addedText.includes('hour')) {
            createdAt = new Date(now - num * 3600 * 1000).toISOString();
          } else if (addedText.includes('day')) {
            createdAt = new Date(now - num * 24 * 3600 * 1000).toISOString();
          } else if (addedText.includes('week')) {
            createdAt = new Date(now - num * 7 * 24 * 3600 * 1000).toISOString();
          } else if (addedText.includes('month')) {
            createdAt = new Date(now - num * 30 * 24 * 3600 * 1000).toISOString();
          } else if (addedText.includes('year')) {
            createdAt = new Date(now - num * 365 * 24 * 3600 * 1000).toISOString();
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
          views,
          viewsText,
          tags: rawTags,
          tagDetails,
          score,
          rating: 'e',
          width: 1280,
          height: 720,
          source: pageUrl,
          postUrl: pageUrl,
          createdAt,
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

  // Pre-resolve full original HD videos with sound and exact metadata for the first batch of posts in parallel (8 at a time)
  const resolveQueue = allPosts.slice(0, 30);
  const concurrency = 8;
  for (let i = 0; i < resolveQueue.length; i += concurrency) {
    const chunk = resolveQueue.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map(async (post) => {
      try {
        const resolved = await resolveRule34VideoFullMedia(post.source, post.originalId, settings);
        if (resolved) {
          if (resolved.fullVideoUrl) {
            post.fileUrl = resolved.fullVideoUrl;
            post.hasSound = true;
          }
          if (resolved.author) {
            post.author = resolved.author;
          }
          if (resolved.tags && resolved.tags.length > 0) {
            post.tags = resolved.tags;
            post.tagDetails = resolved.tagDetails || classifyTags(resolved.tags, post.author);
          }
        }
      } catch {}
    }));
  }

  return allPosts;
}

const resolvedVideoCache = new Map();

export async function resolveRule34VideoFullMedia(sourceUrl, id, settings = {}) {
  const cacheKey = String(id || sourceUrl);
  if (resolvedVideoCache.has(cacheKey)) {
    return resolvedVideoCache.get(cacheKey);
  }

  const targetUrl = sourceUrl 
    ? (sourceUrl.startsWith('http') ? sourceUrl : `https://rule34video.com${sourceUrl.startsWith('/') ? '' : '/'}${sourceUrl}`) 
    : `https://rule34video.com/video/${id}/`;

  try {
    const res = await fetchSafe(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://rule34video.com/'
      },
      timeout: 10000,
      settings,
      site: 'rule34video'
    });
    if (!res.ok) {
      await discardResponse(res);
      return null;
    }
    const html = await res.text();

    const candidateUrls = [];
    
    // 1. Find links in flashvars and the KVS player JS objects
    const jsMatches = html.matchAll(/(?:video_url|video_alt_url\d*|flashvars\.video_\w+)\s*[:=]\s*['"]([^'"]+)['"]/gi);
    for (const m of jsMatches) {
      if (m[1] && !m[1].includes('preview') && (m[1].includes('/get_file/') || m[1].includes('.mp4'))) {
        candidateUrls.push(m[1]);
      }
    }

    // 2. Find links in <source> and download <a href="..."> tags
    const tagMatches = html.matchAll(/(?:src|href)=['"]([^'"]*\/get_file\/[^'"]+|\bhttps?:\/\/[^'"]+\.mp4[^'"]*)['"]/gi);
    for (const m of tagMatches) {
      if (m[1] && !m[1].includes('preview')) {
        candidateUrls.push(m[1]);
      }
    }

    let fullVideoUrl = '';
    let quality = '720p HD';

    if (candidateUrls.length > 0) {
      const p1080 = candidateUrls.find(u => u.includes('1080p') || u.includes('4k') || u.includes('2160p'));
      const p720 = candidateUrls.find(u => u.includes('720p') || u.includes('hd'));
      const p480 = candidateUrls.find(u => u.includes('480p') || u.includes('hq'));
      
      if (p1080) {
        fullVideoUrl = p1080;
        quality = '1080p Full HD';
      } else if (p720) {
        fullVideoUrl = p720;
        quality = '720p HD';
      } else if (p480) {
        fullVideoUrl = p480;
        quality = '480p HQ';
      } else {
        fullVideoUrl = candidateUrls[0];
        quality = 'HD';
      }
    }

    // 3. Extract the artist (Artist / Models)
    let artist = '';
    const flashModelMatch = html.match(/video_models\s*:\s*'([^']*)'/i);
    if (flashModelMatch && flashModelMatch[1].trim()) {
      artist = flashModelMatch[1].trim();
    }

    if (!artist) {
      const artistSectionMatch = html.match(/<div class="label">Artist<\/div>[\s\S]*?<a[^>]*href="[^"]*\/models\/[^"]*"[^>]*>[\s\S]*?<span class="name">([^<]+)<\/span>/i);
      if (artistSectionMatch) {
        artist = artistSectionMatch[1].trim();
      }
    }

    // 4. Extract the uploader (Uploader / Member)
    let uploaderName = '';
    const uploaderSectionMatch = html.match(/<div class="label">Uploaded by<\/div>[\s\S]*?<a[^>]*href="[^"]*\/members\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/i);
    if (uploaderSectionMatch) {
      uploaderName = uploaderSectionMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!uploaderName) {
      const memberMatch = html.match(/href="https?:\/\/rule34video\.com\/members\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/i) ||
                          html.match(/href="\/members\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/i);
      if (memberMatch) {
        uploaderName = memberMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    // 5. Extract the channel (Channel)
    let channelName = '';
    const channelMatch = html.match(/href="https?:\/\/rule34video\.com\/channels\/(\d+)(?:\/([^"/?#]+))?\/?(?:\?|")[^>]*>([\s\S]*?)<\/a>/i) ||
                         html.match(/href="\/channels\/(\d+)(?:\/([^"/?#]+))?\/?(?:\?|")[^>]*>([\s\S]*?)<\/a>/i);
    if (channelMatch) {
      channelName = (channelMatch[3] || channelMatch[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // 6. Extract from description links (Patreon, Twitter/X, Newgrounds, etc.)
    let sourceAuthor = '';
    const patreonMatch = html.match(/patreon\.com\/([a-zA-Z0-9_\-]+)/i);
    const twitterMatch = html.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_\-]+)/i);
    const ngMatch = html.match(/([a-zA-Z0-9_\-]+)\.newgrounds\.com/i);
    if (patreonMatch && !['posts', 'join'].includes(patreonMatch[1].toLowerCase())) {
      sourceAuthor = patreonMatch[1];
    } else if (twitterMatch && !['intent', 'i', 'home', 'search', 'post', 'status'].includes(twitterMatch[1].toLowerCase())) {
      sourceAuthor = `@${twitterMatch[1]}`;
    } else if (ngMatch && !['www', 'art', 'portal'].includes(ngMatch[1].toLowerCase())) {
      sourceAuthor = ngMatch[1];
    }

    const finalAuthor = artist || channelName || uploaderName || sourceAuthor || '';

    // 7. Tags and categories from the video page
    const flashTagsMatch = html.match(/video_tags\s*:\s*'([^']*)'/i);
    const flashCatMatch = html.match(/video_categories\s*:\s*'([^']*)'/i);

    const rawTagsList = [];
    if (flashCatMatch && flashCatMatch[1]) {
      flashCatMatch[1].split(',').map(s => s.trim()).filter(Boolean).forEach(t => rawTagsList.push(t));
    }
    if (flashTagsMatch && flashTagsMatch[1]) {
      flashTagsMatch[1].split(',').map(s => s.trim()).filter(Boolean).forEach(t => rawTagsList.push(t));
    }

    if (fullVideoUrl) {
      if (fullVideoUrl.startsWith('//')) {
        fullVideoUrl = 'https:' + fullVideoUrl;
      } else if (fullVideoUrl.startsWith('/')) {
        fullVideoUrl = 'https://rule34video.com' + fullVideoUrl;
      }

      const result = {
        success: true,
        fullVideoUrl,
        quality,
        hasSound: true,
        author: finalAuthor,
        artist,
        uploaderName,
        channelName,
        tags: rawTagsList,
        tagDetails: classifyTags(rawTagsList, finalAuthor)
      };
      cacheResolved(resolvedVideoCache, cacheKey, result);
      return result;
    }

    // No video found but author/account known - return a result with metadata
    if (finalAuthor) {
      const result = {
        success: false,
        author: finalAuthor,
        artist,
        uploaderName,
        channelName,
        tags: rawTagsList,
        tagDetails: classifyTags(rawTagsList, finalAuthor)
      };
      cacheResolved(resolvedVideoCache, cacheKey, result);
      return result;
    }
    return null;
  } catch (err) {
    logError('Rule34Video Resolve', 'Ошибка получения полного видео с Rule34Video', err);
    return null;
  }
}


