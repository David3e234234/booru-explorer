# DESIGN.md — BooruExp design direction

Authored by the product owner (answers transcribed verbatim from the direction interview; agent only formats).

## Identity

**Collector's cabinet.** The app is a private archive over a lamp-lit table: dark warm browns,
amber light pooling on surfaces, everything arranged like a curated collection rather than a feed.
The artwork is the collectible; the chrome is the cabinet that holds it.

- Personality: warm, deliberate, archival, quietly confident. Not flashy, not sterile.
- What it is NOT: neon cyberpunk, minimal white gallery, terminal utility.

## Palette

Core kotobox values: warm dark browns (`#14110d` base, `#1c1813` surface, `#262019` elevated surface).
Accent: **amber `#e5a968`** — the single accent, the color of lamp light over the collection.
Amber is used sparingly at key moments: active states, focus, primary actions, favorites.
Semantic colors (danger/warning/success) exist only for real statuses, never decoration.

Reason: amber-on-warm-dark IS the collector's-cabinet identity; it already has recognition value
and separates chrome from artwork without competing with it.

## Typography

- Headings / brand: **Fraunces** (soft vintage serif — collector label plates, section titles).
- Body / UI: **Plus Jakarta Sans** (dense-but-friendly tool readability).
- Counts, tag counts, metadata numbers: **JetBrains Mono** (catalog numbering feel).

Reason: the serif gives the cabinet its "printed label" voice; the sans keeps a data-heavy tool
legible; mono numerals read like catalog entries.

## Motion & rhythm dials

**Dial: ENERGY 2 / RHYTHM 2 / MOTION 2**

- ENERGY 2: balanced greeting — confident header, no shouting.
- RHYTHM 2: sections share one language but visibly vary in composition (search bar vs gallery vs
  profile are not clones of one layout).
- MOTION 2: subtle transitions and reveals (hover lifts, drawer slides, gentle fades on new page
  content). No parallax, no bounce, no choreography. Motion serves wayfinding: it tells you where
  a card or panel came from.

## Themes

All three shipped themes follow the same cabinet logic:

1. `kotobox` (default): warm dark brown + amber (the canonical identity above).
2. `tokyo-night`: violet-black night variant, rose accent.
3. `warm-paper`: daylight variant — paper surface + ink, amber becomes ochre.

Every theme must be fully functional. The toggle stays and all three must render every component without missing tokens or broken layout.

## Accessibility

- Text meets WCAG AA contrast in every theme: 4.5:1 for normal text and 3:1 for large text.
- Interactive targets are at least 44 by 44 px on touch layouts.
- Keyboard focus is always visible.
- `prefers-reduced-motion` disables non-essential motion.
- Semantic colors are reserved for real status and never become decoration.

## Focal point rule

One focal element per screen: search bar on the browse screen, the open artwork in the viewer,
the section heading in panels. Everything else defers to it via hierarchy, not decoration.

## Motif

The "collection label plate": serif heading + thin amber rule + mono count, repeated across
sections as the identity motif (e.g., `Коллекция ─── 128 постов`).

## Phone / mobile (vertical feed)

The phone experience (viewport up to 800 px) is a fullscreen vertical snap feed: one post per screen, swipe up or down to move between posts, tap to pause or resume a video (or toggle the interface on still slides), double tap to like, and a long press for the action sheet that also hosts the "Clean screen" mode. The sound toggle lives in the right rail on video posts; the bar at the bottom scrubs. Posts with albums swipe horizontally inside the slide. The feed is consumption-first; the grid stays for focused browsing, and the desktop viewer remains the deep-inspection tool (archives, similar posts, Kemono / Pawchive lookup).

- Dials on the phone: **ENERGY 2 / RHYTHM 2 / MOTION 3**. MOTION rises to 3 because in a feed the motion is the navigation itself (snap scrolling, drag-dismiss, the like burst), not decoration.
- Overlays over media (scrims, action rail, info block) stay dark in every theme: they sit over arbitrary artwork, and light-on-dark is what keeps text readable there. The accent stays a single amber (or the theme accent) for active states and the like burst.
- The phone bottom navigation is the one glass surface (translucent plus backdrop blur). Reason: the bar floats over feed media while the user scrolls.
- Phone grid cards drop the like / bookmark row and the score: actions live in the feed rail and in the long-press quick actions sheet. Reason: the grid is for choosing a post, the feed is for acting on it.
