import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isHevcSource, browserSupportsHevc, isHevcUnsupported } from '../../public/js/modules/hevcCodec.js';

function fakeVideo(support) {
  return { canPlayType: () => (support ? 'maybe' : '') };
}

describe('isHevcSource', () => {
  it('detects H.265 and HEVC markers in file names', () => {
    assert.equal(isHevcSource('https://file.pawchive.pw/data/ff/a5/TeaPartyVik4K_H.265.mp4?f=x'), true);
    assert.equal(isHevcSource('https://cdn.example.com/Claret(4kHEVC).mp4'), true);
    assert.equal(isHevcSource('https://cdn.example.com/clip_h265.mp4'), true);
    assert.equal(isHevcSource('https://cdn.example.com/encoded_x265.mp4'), true);
    assert.equal(isHevcSource('https://cdn.example.com/movie.H.265.MP4'), true);
  });

  it('does not mistake ordinary media for HEVC', () => {
    assert.equal(isHevcSource('https://cdn.example.com/TeaParty.mp4'), false);
    assert.equal(isHevcSource('https://cdn.example.com/movie_2024.mp4'), false);
    assert.equal(isHevcSource('https://cdn.example.com/episode265.mp4'), false);
    assert.equal(isHevcSource('https://img.pawchive.pw/thumbnail/data/ab/cd/hero.png'), false);
    assert.equal(isHevcSource(''), false);
    assert.equal(isHevcSource(null), false);
    assert.equal(isHevcSource(undefined), false);
  });
});

describe('browserSupportsHevc', () => {
  it('trusts the canPlayType probe', () => {
    assert.equal(browserSupportsHevc(fakeVideo(true)), true);
    assert.equal(browserSupportsHevc(fakeVideo(false)), false);
  });

  it('fails closed without a probeable element', () => {
    assert.equal(browserSupportsHevc(null), false);
    assert.equal(browserSupportsHevc({}), false);
    assert.equal(browserSupportsHevc(undefined), false);
  });
});

describe('isHevcUnsupported', () => {
  it('is true only when the source is HEVC and the browser cannot decode it', () => {
    const hevc = 'https://file.pawchive.pw/data/x/TeaPartyVik4K_H.265.mp4';
    assert.equal(isHevcUnsupported(hevc, fakeVideo(false)), true);
    assert.equal(isHevcUnsupported(hevc, fakeVideo(true)), false);
    assert.equal(isHevcUnsupported('https://cdn.example.com/clip.mp4', fakeVideo(false)), false);
  });
});
