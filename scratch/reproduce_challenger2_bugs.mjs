import assert from 'node:assert/strict';
import { adaptTagsForSite, isPostMatchingFilters } from '../src/utils/tagHelpers.js';

console.log('--- REPRODUCING CHALLENGER 2 DEFECTS ---');

// Bug 1: adaptTagsForSite crashes on Object.create(null)
try {
  adaptTagsForSite('danbooru', Object.create(null));
  console.log('Bug 1 NOT reproduced');
} catch (err) {
  console.log('Bug 1 REPRODUCED: adaptTagsForSite(site, Object.create(null)) throws:', err.message);
  assert.strictEqual(err.name, 'TypeError');
}

// Bug 1b: adaptTagsForSite stringifies plain object into "[object Object]"
const objTagsResult = adaptTagsForSite('danbooru', {});
console.log('Bug 1b REPRODUCED: adaptTagsForSite(site, {}) results in:', JSON.stringify(objTagsResult));
assert.strictEqual(objTagsResult.includes('[object Object]'), true);

// Bug 2: isPostMatchingFilters crashes on non-iterable object with length property
try {
  isPostMatchingFilters(
    { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['1girl'] },
    { negativeTokens: { length: 5 } }
  );
  console.log('Bug 2 NOT reproduced');
} catch (err) {
  console.log('Bug 2 REPRODUCED: isPostMatchingFilters with { negativeTokens: { length: 5 } } throws:', err.message);
  assert.strictEqual(err.name, 'TypeError');
}

// Bug 2b: isPostMatchingFilters treats string negativeTokens as character array, falsely blocking posts
const postWithSingleLetter = {
  previewUrl: 'https://cdn.example.com/p.jpg',
  tags: ['l', 'innocent_tag']
};
const filterResult = isPostMatchingFilters(postWithSingleLetter, { negativeTokens: '-loli' });
console.log('Bug 2b REPRODUCED: isPostMatchingFilters with string negativeTokens: "-loli" hidden =', !filterResult);
assert.strictEqual(filterResult, false); // False negative!

console.log('--- ALL DEFECTS EMPIRICALLY REPRODUCED ---');
