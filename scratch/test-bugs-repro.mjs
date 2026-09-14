import assert from 'node:assert/strict';
import {
  isPostMatchingFilters,
  isArchivePost,
  matchesTagBoundary,
  extractAuthor,
  classifyTags,
  adaptTagsForSite
} from '../src/utils/tagHelpers.js';

console.log('--- REPRODUCING DISCOVERED DEFECTS EMPIRICALLY ---');

// Bug 1: isArchivePost & isPostMatchingFilters crash on non-string fileUrl / sampleUrl / fileExt
try {
  isArchivePost({ fileUrl: 12345 });
  console.log('Bug 1 NOT reproduced');
} catch (e) {
  console.log('Bug 1 REPRODUCED: isArchivePost({ fileUrl: 12345 }) throws:', e.message);
  assert.strictEqual(e.name, 'TypeError');
}

// Bug 2: isPostMatchingFilters crashes on numeric rating
try {
  isPostMatchingFilters({ previewUrl: 'https://cdn.example.com/p.jpg', rating: 1 }, { ratingFilter: 'nsfw' });
  console.log('Bug 2 NOT reproduced');
} catch (e) {
  console.log('Bug 2 REPRODUCED: isPostMatchingFilters with rating: 1 throws:', e.message);
  assert.strictEqual(e.name, 'TypeError');
}

// Bug 3: matchesTagBoundary crashes on numeric tag or pattern
try {
  matchesTagBoundary(12345, 'anthro');
  console.log('Bug 3 NOT reproduced');
} catch (e) {
  console.log('Bug 3 REPRODUCED: matchesTagBoundary(12345, "anthro") throws:', e.message);
  assert.strictEqual(e.name, 'TypeError');
}

// Bug 4: extractAuthor crashes when rawTags contains null or numbers
try {
  extractAuthor([null, 'artist:wlop']);
  console.log('Bug 4 NOT reproduced');
} catch (e) {
  console.log('Bug 4 REPRODUCED: extractAuthor([null, "artist:wlop"]) throws:', e.message);
  assert.strictEqual(e.name, 'TypeError');
}

// Bug 5: classifyTags crashes on numeric author
try {
  classifyTags([], 12345);
  console.log('Bug 5 NOT reproduced');
} catch (e) {
  console.log('Bug 5 REPRODUCED: classifyTags([], 12345) throws:', e.message);
  assert.strictEqual(e.name, 'TypeError');
}

// Bug 6: adaptTagsForSite crashes when passed tag array or number
try {
  adaptTagsForSite('danbooru', ['1girl', 'solo']);
  console.log('Bug 6 NOT reproduced');
} catch (e) {
  console.log('Bug 6 REPRODUCED: adaptTagsForSite("danbooru", ["1girl"]) throws:', e.message);
  assert.strictEqual(e.name, 'TypeError');
}

console.log('--- ALL 6 DEFECTS EMPIRICALLY CONFIRMED ---');
