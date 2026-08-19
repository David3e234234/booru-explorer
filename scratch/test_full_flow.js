import { fetchRule34 } from '../src/parsers/rule34.js';
import { adaptTagsForSite } from '../src/utils/tagHelpers.js';

async function run() {
  const html = `<!DOCTYPE html>
<html>
<body>
<span id="s18042960" class="thumb" >
  <a id="p18042960" href="/index.php?page=post&s=view&id=18042960&tags=hu_tao">
    <img src="https://wimg.rule34.xxx/thumbnails/3888/thumbnail_2ee3f6b963a819b4a1064fbc2e6c97f4.jpg?18042960" 
      alt="1girl hu_tao hu_tao_(genshin_impact) genshin_impact" 
      title="1girl hu_tao hu_tao_(genshin_impact) genshin_impact score:34 rating:explicit" 
      class="preview "/>
  </a>
</span>
</body>
</html>`;

  // Test fetchRule34 logic
  console.log('Testing adaptTagsForSite:', adaptTagsForSite('rule34', 'hu_tao'));
  console.log('Testing adaptTagsForSite with brackets:', adaptTagsForSite('rule34', 'hu_tao_(genshin_impact)'));
}

run();
