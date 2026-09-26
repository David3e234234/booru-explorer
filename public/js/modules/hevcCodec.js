// HEVC/H.266 codec detection. Pawchive and similar boards serve H.265 MP4 files
// whose names carry the codec marker ("TeaPartyVik4K_H.265.mp4",
// "Claret(4kHEVC).mp4"). Browsers without an OS HEVC decoder (Firefox on
// Windows without the HEVC extension) cannot play those even through the
// proxy, so the viewer must route such sources through the FFmpeg transcode
// instead of the media element.

// Marker test runs against the lower-cased file name part of a URL (query
// stripped). Substring matching catches "4kHEVC" and "x265" (the HEVC
// encoder tag) without needing a separator before the token.
const HEVC_NAME_MARKER = /h\.265|\.265|hevc|h265|x265/i;

export function isHevcSource(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.split('?')[0].split('#')[0].split('/').pop() || '';
  return HEVC_NAME_MARKER.test(clean);
}

export function browserSupportsHevc(videoEl = safeCreateVideo()) {
  if (!videoEl || typeof videoEl.canPlayType !== 'function') return false;
  try {
    return Boolean(
      videoEl.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') ||
      videoEl.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')
    );
  } catch {
    return false;
  }
}

function safeCreateVideo() {
  try {
    if (typeof document === 'undefined' || !document.createElement) return null;
    return document.createElement('video');
  } catch {
    return null;
  }
}

export function isHevcUnsupported(url, videoEl) {
  return isHevcSource(url) && !browserSupportsHevc(videoEl);
}
