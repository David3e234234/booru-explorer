import { checkIsAi, checkMediaTypes, extractAuthor, classifyTags, normalizeDate } from '../src/utils/tagHelpers.js';

const html = `<span id="s18042960" class="thumb" >
            <a id="p18042960" href="/index.php?page=post&s=view&id=18042960&tags=hu_tao">
                                <img src="https://wimg.rule34.xxx/thumbnails/3888/thumbnail_2ee3f6b963a819b4a1064fbc2e6c97f4.jpg?18042960" 
                style=""
                alt="1girl after_sex after_vaginal ahegao ahegao_face ai ai_art ai_generated armpits beach beach_towel beach_umbrella big_butt brown_hair creampie cum_in_pussy exposed_pussy female_ejaculation female_orgasm genshin_impact hu_tao hu_tao_(genshin_impact) long_hair nipples nude nymia ocean pussy red_eyes sand shadow small_breasts solo squirting squirting_orgasm sweat thick_thighs tongue_out wide_hips" 
                border="0" 
                title="1girl after_sex after_vaginal ahegao ahegao_face ai ai_art ai_generated armpits beach beach_towel beach_umbrella big_butt brown_hair creampie cum_in_pussy exposed_pussy female_ejaculation female_orgasm genshin_impact hu_tao hu_tao_(genshin_impact) long_hair nipples nude nymia ocean pussy red_eyes sand shadow small_breasts solo squirting squirting_orgasm sweat thick_thighs tongue_out wide_hips score:34 rating:explicit" 
                class="preview "/>
            </a>
       </span>`;

const spanRegex = /<span\b[^>]*?(?:class="[^"]*\bthumb\b[^"]*"[^>]*?id="s?(\d+)"|id="s?(\d+)"[^>]*?class="[^"]*\bthumb\b[^"]*")[^>]*>([\s\S]*?)<\/span>/gi;
let match;
while ((match = spanRegex.exec(html)) !== null) {
  const id = match[1] || match[2];
  const block = match[3];

  const imgMatch = block.match(/<img[^>]+(?:src|data-src)="([^"]+)"/i);
  const thumbUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

  const titleMatch = block.match(/title="([^"]*)"/i);
  const altMatch = block.match(/alt="([^"]*)"/i);
  const titleAttr = (titleMatch ? titleMatch[1] : (altMatch ? altMatch[1] : '')).replace(/&amp;/g, '&');

  const cleanTitleTags = titleAttr.replace(/score:-?\d+/gi, '').replace(/rating:\w+/gi, '').trim();
  const rawTags = cleanTitleTags.split(/\s+/).filter(Boolean);

  console.log('ID:', id, 'Thumb:', thumbUrl, 'Tags count:', rawTags.length);
}
