import { fetchDanbooru } from './danbooru.js';
import { fetchMoebooru } from './moebooru.js';
import { fetchSafebooru } from './safebooru.js';
import { fetchRule34 } from './rule34.js';
import { fetchGelbooru } from './gelbooru.js';
import { fetchRule34Video } from './rule34video.js';
import { fetchXbooru, fetchHypnohub } from './dapi.js';

export {
  fetchDanbooru,
  fetchMoebooru,
  fetchSafebooru,
  fetchRule34,
  fetchGelbooru,
  fetchRule34Video,
  fetchXbooru,
  fetchHypnohub
};

export async function fetchPosts(site, params, aiTagsList, settings) {
  switch (site) {
    case 'danbooru':
      return await fetchDanbooru(params, aiTagsList, settings);
    case 'rule34video':
      return await fetchRule34Video(params, aiTagsList);
    case 'yandere':
      return await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', params, aiTagsList);
    case 'safebooru':
      return await fetchSafebooru(params, aiTagsList);
    case 'konachan':
      return await fetchMoebooru('konachan', 'https://konachan.net', 'Konachan', params, aiTagsList);
    case 'rule34':
      return await fetchRule34(params, aiTagsList, settings);
    case 'gelbooru':
      return await fetchGelbooru(params, aiTagsList, settings);
    case 'xbooru':
      return await fetchXbooru(params, aiTagsList);
    case 'hypnohub':
      return await fetchHypnohub(params, aiTagsList);
    case 'all': {
      let mainSites = ['danbooru', 'yandere', 'safebooru', 'konachan', 'rule34', 'gelbooru', 'rule34video', 'xbooru', 'hypnohub'];
      if (params.typeFilter === 'video' || params.typeFilter === 'audio' || params.typeFilter === 'sound') {
        mainSites = ['rule34video', 'danbooru', 'rule34', 'gelbooru', 'xbooru', 'hypnohub'];
      } else if (params.ratingFilter === 'nsfw') {
        mainSites = ['rule34video', 'danbooru', 'yandere', 'rule34', 'gelbooru', 'xbooru', 'hypnohub'];
      }
      if (params.excludeSites) {
        const excluded = params.excludeSites.split(',').map(s => s.trim().toLowerCase());
        mainSites = mainSites.filter(s => !excluded.includes(s));
      }
      const perSiteLimit = Math.max(25, Math.ceil((params.limit || 100) / mainSites.length));
      const results = await Promise.allSettled(
        mainSites.map(s => fetchPosts(s, { ...params, limit: perSiteLimit }, aiTagsList, settings))
      );
      const lists = [];
      results.forEach(res => {
        if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0) {
          lists.push(res.value);
        }
      });
      // Чередование (Round-Robin) постов с разных сайтов для равномерного разнообразия
      const combined = [];
      const maxLength = Math.max(0, ...lists.map(l => l.length));
      for (let i = 0; i < maxLength; i++) {
        for (let j = 0; j < lists.length; j++) {
          if (i < lists[j].length) {
            combined.push(lists[j][i]);
          }
        }
      }
      return combined;
    }
    default:
      return await fetchDanbooru(params, aiTagsList, settings);
  }
}
