import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRule34VideoTeaserUrl,
  isFullMediaPending,
  getCardPreviewVideoUrl
} from '../../public/js/modules/uiUtils.js';

const TEASER = 'https://rule34video.com/get_file/58/3ed0eca/4627000/4627795/4627795_preview.mp4/';
const FULL = 'https://rule34video.com/get_file/58/8567fea/4627000/4627795/4627795_1080p.mp4/?v-acctoken=TESTTOKEN&download=true';

describe('Rule34Video teaser policy', () => {
  it('detects the teaser clip the feed exposes', () => {
    assert.equal(isRule34VideoTeaserUrl(TEASER), true);
  });

  // The board appends a trailing slash and a one-shot token, so a plain
  // endsWith('.mp4') check misses both the teaser and the full stream.
  it('sees through the trailing slash and the one-shot token', () => {
    assert.equal(isRule34VideoTeaserUrl(`${TEASER}?v-acctoken=abc`), true);
    assert.equal(isRule34VideoTeaserUrl(FULL), false);
    assert.equal(isRule34VideoTeaserUrl('https://cdn.example.com/clip_preview.webm'), true);
  });

  it('does not mistake other media or paths for a teaser', () => {
    assert.equal(isRule34VideoTeaserUrl(''), false);
    assert.equal(isRule34VideoTeaserUrl(null), false);
    assert.equal(isRule34VideoTeaserUrl('https://rule34video.com/contents/videos_screenshots/4627000/4627795/320x180/3.jpg'), false);
    assert.equal(isRule34VideoTeaserUrl('https://cdn.example.com/videos/4627795.mp4'), false);
  });

  it('treats a feed post as pending and a resolved post as final', () => {
    const feedPost = { site: 'rule34video', isVideo: true, fileUrl: TEASER, sampleUrl: TEASER, hasFullMediaPending: true };
    assert.equal(isFullMediaPending(feedPost), true);

    const resolvedPost = { site: 'rule34video', isVideo: true, fileUrl: FULL, hasFullMediaPending: false };
    assert.equal(isFullMediaPending(resolvedPost), false);
  });

  // Favourites and likes stored before the parser flagged this still hold the
  // teaser, and they must not replay it on reopen.
  it('detects pending media on posts stored without the flag', () => {
    const stored = { site: 'rule34video', isVideo: true, fileUrl: TEASER, sampleUrl: TEASER };
    assert.equal(isFullMediaPending(stored), true);
  });

  it('ignores image posts and other boards', () => {
    assert.equal(isFullMediaPending({ site: 'danbooru', isVideo: false, fileUrl: 'https://x/y.jpg' }), false);
    assert.equal(isFullMediaPending({ site: 'danbooru', isVideo: true, fileUrl: 'https://x/y_preview.mp4' }), false);
    assert.equal(isFullMediaPending(null), false);
  });

  // Once the viewer swapped in the 1080p link, the card must go back to the
  // teaser instead of streaming the full file on hover.
  it('keeps cards on the teaser after the post was resolved', () => {
    const post = { fileUrl: FULL, teaserUrl: TEASER, sampleUrl: FULL };
    assert.equal(getCardPreviewVideoUrl(post), TEASER);
    assert.equal(getCardPreviewVideoUrl({ fileUrl: 'https://x/y.mp4' }), 'https://x/y.mp4');
    assert.equal(getCardPreviewVideoUrl(null), '');
  });
});
