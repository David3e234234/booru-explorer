// Manual check: negative-tag filtering semantics after the substring-match fix
import { isPostMatchingFilters } from '../src/utils/tagHelpers.js';

let failed = 0;
const check = (name, actual, expected) => {
  if (actual !== expected) {
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`);
    failed++;
  } else {
    console.log(`ok   ${name}`);
  }
};

const criteria = (negativeTokens) => ({
  typeFilter: 'all', ageFilter: 'all', aiFilter: 'all', ratingFilter: 'all',
  dateFilter: 'all', negativeTokens
});
const post = (tags) => ({
  previewUrl: 'http://x/a.jpg', fileUrl: 'http://x/a.jpg',
  tags, site: 'danbooru'
});

// Exact match still hides
check('exact tag hidden', isPostMatchingFilters(post(['blonde_hair', 'smile']), criteria(['blonde hair'])), false);
// Underscore spelling of the negative token
check('underscored token hidden', isPostMatchingFilters(post(['blonde_hair']), criteria(['blonde_hair'])), false);
// Substring false positive must be gone
check('substring NOT hidden anymore', isPostMatchingFilters(post(['long_blonde_haired_girl']), criteria(['blonde hair'])), true);
// Phrase tag stored with literal spaces still matches
check('space-phrase tag hidden', isPostMatchingFilters(post(['big tits', 'smile']), criteria(['big tits'])), false);
check('underscored token vs space phrase', isPostMatchingFilters(post(['big_tits']), criteria(['big tits'])), false);
// No negative tokens -> unaffected
check('no negatives passes', isPostMatchingFilters(post(['long_blonde_haired_girl']), criteria([])), true);

process.exit(failed > 0 ? 1 : 0);
