# DESIGN.md — BooruExp design direction

Authored by the product owner (answers transcribed verbatim from the direction interview; agent only formats).

## Identity

**Collector's cabinet.** The app is a private archive over a lamp-lit table: dark warm browns,
amber light pooling on surfaces, everything arranged like a curated collection rather than a feed.
The artwork is the collectible; the chrome is the cabinet that holds it.

- Personality: warm, deliberate, archival, quietly confident. Not flashy, not sterile.
- What it is NOT: neon cyberpunk, minimal white gallery, terminal utility.

## Palette (R-29 compliant)

Core: warm dark browns (`#0e0d0c` base, `#171513`/`#211e1a` surfaces).
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

Keep all three, restyled to the same cabinet logic:

1. `kotobox` (default): warm dark brown + amber (the canonical identity above).
2. `tokyo-night`: violet-black night variant, rose accent.
3. `warm-paper`: daylight variant — paper surface + ink, amber becomes ochre.

Every theme must be fully functional (R-34); the toggle stays.

## Focal point rule

One focal element per screen: search bar on the browse screen, the open artwork in the viewer,
the section heading in panels. Everything else defers to it via hierarchy, not decoration.

## Motif

The "collection label plate": serif heading + thin amber rule + mono count, repeated across
sections as the identity motif (e.g., `Коллекция ─── 128 постов`).
