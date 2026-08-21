import { fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, classifyTags } from '../utils/tagHelpers.js';
import { logError } from '../utils/logger.js';

const resolvedAuthorCache = new Map();

/**
 * Разрешает имя автора/художника/модели в Rule34Video ID (model_ids, channels, members)
 */
export async function resolveRule34VideoAuthor(authorQuery) {
  if (!authorQuery) return null;
  const clean = authorQuery
    .replace(/^(?:channel|user|account|artist|author|uploader|creator|member|model):\s*/i, '')
    .replace(/[_+]+/g, ' ')
    .trim();
  
  if (!clean) return null;

  // Если это уже числовой ID с типом
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
    // 1. Официальный JSON API поиска моделей/авторов Rule34Video
    const modelJsonUrl = `https://rule34video.com/models_json.php?advanced_search=true&q=${encodeURIComponent(clean)}`;
    const resModelJson = await fetchSafe(modelJsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000
    });

    if (resModelJson.ok) {
      const data = await resModelJson.json();
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        // Ищем точное или наиболее подходящее совпадение
        const cleanNoSpace = clean.toLowerCase().replace(/[\s_]+/g, '');
        const exact = data.items.find(i => (i.title || '').toLowerCase().replace(/[\s_]+/g, '') === cleanNoSpace) || data.items[0];
        if (exact && exact.id) {
          const result = {
            type: 'model',
            id: String(exact.id),
            name: exact.title || clean,
            total: parseInt(exact.total, 10) || 0
          };
          resolvedAuthorCache.set(cacheKey, result);
          return result;
        }
      }
    }

    // 2. Поиск по Каналам (Channels)
    const channelUrl = `https://rule34video.com/channels/?mode=async&function=get_block&block_id=custom_list_channels_common_channels_list&q=${encodeURIComponent(clean)}&from=1`;
    const resChannel = await fetchSafe(channelUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000
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
        resolvedAuthorCache.set(cacheKey, result);
        return result;
      }
    }

    // 3. Поиск по Участникам/Загрузчикам (Members)
    const memberUrl = `https://rule34video.com/members/?mode=async&function=get_block&block_id=custom_list_members_common_members_list&q=${encodeURIComponent(clean)}&from=1`;
    const resMember = await fetchSafe(memberUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 5000
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
        resolvedAuthorCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (err) {
    logError('Rule34Video Author Resolve', `Ошибка разрешения автора ${clean}`, err);
  }

  return null;
}

export async function fetchRule34Video(params, aiTagsList) {
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
    authorTarget = await resolveRule34VideoAuthor(extractedAuthor);
  }

  // Поисковый запрос для KVS search
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
  } else if (category === 'popular' || category === 'recommended') {
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
    'honkai star rail', 'christmas', 'sex', 'r18', 'uncensored', 'decensored', 'mmd', 'compilation'
  ]);

  const fetchPromises = pageNumbers.map(async (p) => {
    let url = '';
    if (authorTarget) {
      // Поиск видео автора по его Rule34Video ID (model_ids, channel или member)
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
    } else if (category === 'popular' || category === 'recommended') {
      url = `https://rule34video.com/most-popular/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&from=${p}`;
    } else if (category === 'random') {
      url = `https://rule34video.com/most-popular/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&sort_by=random&from=${p}`;
    } else if (rawTags) {
      // Если запрос был передан пользователем, но не сформировал URL, НЕ возвращаем случайные видео!
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

        // 1. Извлечение автора из аккаунта / канала / загрузчика в HTML блока
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

        // 2. Если в блоке нет ссылки на аккаунт, глубокий поиск автора в названии
        if (!author) {
          const authorPipeMatch = title.match(/\|\s*([a-zA-Z0-9_\- ]+)$/);
          const authorByMatch = title.match(/\bby\s+@?([a-zA-Z0-9_\- ]+)/i);
          const authorDashMatch = title.match(/\s+-\s+([a-zA-Z0-9_\- ]+)$/);
          
          if (authorPipeMatch && !nonAuthorTags.has(authorPipeMatch[1].trim().toLowerCase())) {
            author = authorPipeMatch[1].trim();
          } else if (authorByMatch && !nonAuthorTags.has(authorByMatch[1].trim().toLowerCase())) {
            author = authorByMatch[1].trim();
          } else if (authorDashMatch && !nonAuthorTags.has(authorDashMatch[1].trim().toLowerCase())) {
            author = authorDashMatch[1].trim();
          } else {
            // Ищем автора в любых квадратных скобках [Author] с конца заголовка
            const brackets = [...title.matchAll(/\[([^\]]+)\]/g)];
            for (let bIdx = brackets.length - 1; bIdx >= 0; bIdx--) {
              const bTag = brackets[bIdx][1].trim();
              if (!nonAuthorTags.has(bTag.toLowerCase()) && bTag.length >= 2 && bTag.length <= 40) {
                author = bTag;
                break;
              }
            }
            // И в круглых скобках (Author)
            if (!author) {
              const parens = [...title.matchAll(/\(([^)]+)\)/g)];
              for (let pIdx = parens.length - 1; pIdx >= 0; pIdx--) {
                const pTag = parens[pIdx][1].trim();
                if (!nonAuthorTags.has(pTag.toLowerCase()) && pTag.length >= 2 && pTag.length <= 40) {
                  author = pTag;
                  break;
                }
              }
            }
          }
        }

        // 3. Fallback на найденного автора / канал из запроса
        if (authorTarget) {
          author = authorTarget.name || author;
        } else if (!author && extractedAuthor) {
          author = extractedAuthor;
        }

        // Фильтрация по автору только если автор НЕ был разрешен в точный ID модели/канала (текстовый поиск)
        if (!authorTarget && extractedAuthor && authorTokens.length > 0) {
          const cleanRequestedAuthor = extractedAuthor.toLowerCase().replace(/[\s_]+/g, '');
          const postAuthorClean = (author || '').toLowerCase().replace(/[\s_]+/g, '');
          const titleClean = title.toLowerCase().replace(/[\s_]+/g, '');
          const slugClean = slug.toLowerCase().replace(/[\s_]+/g, '');
          
          const matchesAuthor = postAuthorClean.includes(cleanRequestedAuthor) ||
                                titleClean.includes(cleanRequestedAuthor) ||
                                slugClean.includes(cleanRequestedAuthor);
          if (!matchesAuthor) {
            continue; // Пропускаем ролики других авторов
          }
        }

        // Фильтрация по общим тегам, если заданы (например zenless_zone_zero)
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

  // Параллельно пред-разрешаем полные оригинальные HD-видео со звуком для первой партии постов (по 8 за раз)
  const resolveQueue = allPosts.slice(0, 30);
  const concurrency = 8;
  for (let i = 0; i < resolveQueue.length; i += concurrency) {
    const chunk = resolveQueue.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map(async (post) => {
      try {
        const resolved = await resolveRule34VideoFullMedia(post.source, post.originalId);
        if (resolved && resolved.fullVideoUrl) {
          post.fileUrl = resolved.fullVideoUrl;
          post.hasSound = true;
        }
        // Всегда обновляем автора из аккаунта загрузчика, если получили его со страницы видео
        if (resolved && resolved.uploaderName) {
          post.author = resolved.uploaderName;
        }
      } catch {}
    }));
  }

  return allPosts;
}

const resolvedVideoCache = new Map();

export async function resolveRule34VideoFullMedia(sourceUrl, id) {
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
      timeout: 10000
    });
    if (!res.ok) return null;
    const html = await res.text();

    const candidateUrls = [];
    
    // 1. Поиск ссылок в flashvars и js-объектах плеера KVS
    const jsMatches = html.matchAll(/(?:video_url|video_alt_url\d*|flashvars\.video_\w+)\s*[:=]\s*['"]([^'"]+)['"]/gi);
    for (const m of jsMatches) {
      if (m[1] && !m[1].includes('preview') && (m[1].includes('/get_file/') || m[1].includes('.mp4'))) {
        candidateUrls.push(m[1]);
      }
    }

    // 2. Поиск ссылок в <source> и <a href="..."> тегах скачивания
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

    // Парсим аккаунт загрузчика (ссылка вида /members/ID/ или /channels/SLUG/)
    let uploaderName = '';
    const memberMatch = html.match(/href="\/members\/([^"/?#]+)\/?"[^>]*>([^<]+)<\/a>/i);
    const channelMatch = html.match(/href="\/channels\/([^"/?#]+)\/?"[^>]*>([^<]+)<\/a>/i);
    if (memberMatch) {
      uploaderName = memberMatch[2].trim();
    } else if (channelMatch) {
      uploaderName = channelMatch[2].trim();
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
        uploaderName
      };
      resolvedVideoCache.set(cacheKey, result);
      return result;
    }
    // Если видео не нашли, но есть аккаунт — вернуть хотя бы его
    if (uploaderName) {
      const result = { success: false, uploaderName };
      resolvedVideoCache.set(cacheKey, result);
      return result;
    }
    return null;
  } catch (err) {
    logError('Rule34Video Resolve', 'Ошибка получения полного видео с Rule34Video', err);
    return null;
  }
}


