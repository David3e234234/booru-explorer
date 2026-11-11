# AGENTS.md

## 1. Project Contract

Booru Explorer is an Express monolith with a no-build vanilla-JS frontend. It searches Booru sites and subscription archives, proxies and caches media, renders a virtualized gallery and full-screen viewer, and stores user data as JSON.

Entrypoints:

- Runtime: `server.js`
- Frontend shell: `public/index.html`
- Frontend bootstrap: `public/js/app.js`
- Test entrypoint: `test/run-all.js` (auto-discovers `test/unit` then `test/integration`)
- Site registry and defaults: `src/config/constants.js`
- CI and deploy: `.github/workflows/deploy.yml`

Tracked directories: `src/`, `public/`, `test/`, `data/settings.example.json`, root docs and config. Ignored directories: `data/` at runtime, `node_modules/`, `downloads/`, `tmp/`.

## 2. Mandatory Rules For Coding Agents

1. Read this file, `README.md` and `DESIGN.md` before changing behavior, public UI or visual style.
2. Do not commit secrets, credentials, `data/`, `node_modules/`, `package-lock.json`, `.agents/`, `.antigravity/` or `anti-slop/`.
3. Never weaken the SSRF guard, media MIME allowlist, ownership checks or auth redaction to make a feature pass.
4. Do not push to `main` or `master` unless the user explicitly requests it. A push deploys to production after the verify job.
5. Preserve public API shapes unless the user asks for a breaking change. Update callers, tests and docs together.
6. Comments are written in English. UI strings and logs are Russian by default; English UI comes from the i18n layer.
7. Do not add a build step, framework or runtime dependency without an explicit need and a documented reason. (Current exception: the esbuild client bundle, documented in §7 Frontend Architecture.)
8. New network-facing routes require input validation, an auth decision, a rate limit where appropriate, bounded resources and tests.

### Documentation Ownership

This is a hard requirement for every change to tracked files. The agent MUST proactively maintain documentation, without waiting for a reminder:

- Perform an explicit documentation-impact check for **both** `README.md` and `AGENTS.md` in the same change.
- If behavior, setup, commands, dependencies, supported sources, formats, storage, security, deployment or user-facing UI changed, update `README.md`.
- If architecture, repository layout, commands, invariants, testing policy, contributor workflow or this contract changed, update `AGENTS.md`.
- If visual direction, palette, typography or motion changed, update `DESIGN.md`.
- When a document is unaffected, the handoff MUST record `README.md: no impact` or `AGENTS.md: no impact` explicitly.
- Do not defer a known documentation fix to a later task. Do not declare completion while either document contradicts the code.
- Any change to this rule MUST update `AGENTS.md` in the same change.

Documentation sources of truth, in order: executable config (`package.json`, workflow, constants), `README.md` for user/operator behavior, `AGENTS.md` for contributor rules, `DESIGN.md` for visual direction.

## 3. Commands

```bash
npm start                                  # node server.js, port 3000, auto-increments if busy
node server.js --no-open                   # no browser launch
node server.js --port=3100                 # explicit port
start_phone.bat                            # Windows LAN access plus QR code
npm test                                   # unit, parser and integration suites
npm run test:unit                          # test/unit
npm run test:integration                   # test/integration/routes.test.js
npm run verify                             # alias for npm test
npm run build:client                       # esbuild: public/js/app.js -> public/dist
npm install                                # also builds the client via the postinstall script
node --check path/to/file.js               # every touched JS file
```

`npm install` runs `postinstall` (`node scripts/buildClient.mjs`), so a fresh checkout and the `--omit=dev` deploys on Alwaysdata/Vercel have `public/dist` even before `server.js` starts. The explicit `npm run build:client` in CI remains the guarantee if lifecycle scripts are ever skipped.

`test/run-all.js` discovers `*.test.js` under `test/unit` and `test/integration` at runtime and imports unit suites before integration ones. Never reintroduce a hardcoded suite list: a stale list silently skips new tests, which is how regressions reach `main`.

Runtime requirement: Node.js `22.19.0` or newer, enforced by `engines` in `package.json` and CI.

`package-lock.json` is intentionally ignored by repository policy. Deploys therefore run `npm install --omit=dev`, not `npm ci`; this is a known reproducibility tradeoff and must be mentioned when dependencies change.

Runtime dependencies are kept minimal and must stay `0 vulnerabilities` under `npm audit --omit=dev`. Express is pinned to `^4.22.3` so the patched `body-parser` and `qs` are always installed.

## 4. Runtime And Environment

- `PORT` and `SERVER_PORT` set the port; `--port=N` has priority.
- `BOORU_DATA_DIR` overrides the data root. Tests always create a temporary directory.
- `BOORU_STORAGE_BACKEND=json` forces the legacy JSON storage path instead of SQLite (`data/booru.db`), for operations and tests.
- `SESSION_SECRET` signs bearer tokens. Set it explicitly in multi-instance deployments.
- `BOORU_ADMIN_TOKEN` enables token-based owner access through `x-booru-admin-token`.
- Without `BOORU_ADMIN_TOKEN`, the first registered user is the owner.
- Board credentials can be supplied through the documented `*_LOGIN`, `*_USER_ID`, `*_API_KEY` environment variables.
- FFmpeg must be on `PATH` for video thumbnails and transcoding. Missing FFmpeg returns an SVG thumbnail placeholder and `503` for transcode.
- Serverless mode redirects `DATA_DIR` to `os.tmpdir()` and skips `app.listen`; storage is ephemeral.

## 5. Repository Map

```text
src/config/constants.js        paths, defaults, site registry, secret field list
src/middleware/                request policies such as rate limiting
src/parsers/                   one module per source plus aggregation in index.js
src/routes/                    HTTP endpoints grouped by domain
src/services/                  storage, cache, media, auth, backup, archives
src/services/sqliteStore.js    SQLite backend (node:sqlite) for all user data,
                               legacy JSON import and JSON fallback
src/utils/                     network, tag logic, logging, host policy, settings policy
src/utils/searchCompat.js      shared rating-tag, preview-tier and pagination helpers
public/index.html              slim application shell: header, sidebar, gallery,
                               sheets and the SVG sprite; modal markup is injected lazily
public/js/                     ES modules loaded by the esbuild bundle entry (app.js)
public/js/search/              feed production per category: searchEngine dispatcher
                               plus following.js / recommendations.js branches
public/js/feed/                phone feed subsystem (vertical snap feed: slides, video, gestures, sheets)
public/js/modules/             UI subsystems loaded by app.js (see boundaries below)
public/js/modules/settingsTabs/  per-tab controllers of the settings modal (each owns
                               its temp state, renderers and DOM wiring)
public/js/modules/*Markup.js   modal markup extracted from index.html (viewer, settings,
                               wiki, auth, alias manager), injected on first use
public/js/modules/scrollLock.js shared reference-counted body scroll lock
public/dist/                   esbuild output (git-ignored, rebuilt by postinstall/server.js)
scripts/buildClient.mjs        esbuild bundle script behind `npm run build:client`
public/css/                    theme tokens and component styles
test/unit/                     pure unit and mocked parser suites
test/integration/              Express app tests on an ephemeral port
scratch/                       tracked manual diagnostics, not part of npm test
```

Large files must be split by responsibility when touched. Preferred existing boundaries:

- `jsonFileStore.js`: atomic serialized JSON writes, compact serialization, gzip for collections
- `storedPostSchema.js`: allowlist of fields persisted with a liked/favorited post
- `settingsValidation.js`: request auth parsing, settings allowlists, cache key
- `hostPolicy.js`: hostname boundaries, credential hosts, log redaction
- `imageCacheService.js`: image signatures and disk cache
- `booruTagTypeService.js`: per-board authoritative tag categories, batched and disk-cached
- `danbooruTagLimitService.js`: Danbooru per-level tag budget, free metatag list and `/profile.json` lookup cached for 7 days
- `mediaJobSupervisor.js`: FFmpeg concurrency and queue limits
- `siteSessionService.js`: session-token normalization for the Kemono-family boards
- `tagAutocomplete.routes.js`: autocomplete endpoint, independent from search routes
- `notificationService.js`: background author scanning, new post detection, and scheduler
- `notifications.routes.js`: in-app notifications endpoints (GET, POST /read, DELETE, POST /check)
- `rateLimit.js`: per-instance fixed-window limiter; every limiter gets its own budget
- `public/js/modules/*`: UI subsystems loaded by `app.js`
- `public/js/search/searchEngine.js`: the only feed producer; category branches live in `search/following.js` and `search/recommendations.js` and receive a `ctx` ({ reset, options, isSuperseded, renderFavoriteAuthors }), never app.js scope
- `public/js/modules/lazyLoader.js`: `importOnce` loaders, the instance registry (get*/set* per component) and the app.js actions injected via `initLazyLoaders(deps)`
- `public/js/modules/navigationUI.js`: the sources panel (desktop list and mobile sheet) plus `syncSourceSelectionUI()`, the only repaint path for the active-source highlight
- `public/js/modules/siteSelectionUI.js`: `applyCurrentSiteUi()` applies `state.currentSite` to every surface at once (panel highlight, header label, capability-gated filter controls, Pawchive/Kemono platform dropdowns). Every site switch must go through it
- `public/js/modules/accountData.js`: account data loaders and the account generation guard
- `public/js/modules/eventBindings.js`: static-shell event wiring; app.js actions arrive via `initEventBindings(deps)`
- `public/js/modules/settingsModal.js`: settings orchestration (open/save/reset/apply); per-tab state and wiring live in `settingsTabs/*`
- `public/js/modules/*Markup.js`: modal markup injected on first use; keep `data-i18n` translated right after injection and bind controls only after `ensure*Markup()` (delegation for init-time bindings)

## 6. Backend Architecture

### Search Flow

1. `GET /api/posts` in `posts.routes.js` parses and validates the query, resolves effective settings, and builds a cache key. Unknown site ids are a `400`, `page` is clamped to 1–1000 and the route is limited to 60 requests/min per IP.
2. `fetchPosts()` in `parsers/index.js` is the only aggregation entrypoint.
3. Single-site mode runs the parser and a bounded deep-fetch loop.
4. All-sites mode uses `Promise.allSettled`, a per-site deadline, `Promise.allSettled` fan-out, round-robin merge and a final `limit` slice.
5. `isPostMatchingFilters()` in `tagHelpers.js` is the canonical content filter. Danbooru also prefilters inside its parser to avoid expensive cursor paging; routes must never add another filter pass.
6. Auto-discovered Danbooru aliases are only registered when the discovered alias group is plausible (at most 8 names). A Danbooru page with dozens of `other_names` is a circle or aggregator page; registering it aliases unrelated artists to each other, so a single-author Pawchive query returns several unrelated feeds. Additionally, the queried candidate must be the artist's own name or one of its listed `other_names` (the `artists.json` fuzzy `data[0]` is not trusted), and the canonical tag must have a nonzero post count per Danbooru's `tags.json` before the group is written. The blind "any alias ending in `sfm`" Rule34 fallback is gone: Rule34 mappings come only from the post-count-verified autocomplete match.
7. Author alias auto-discovery can be globally disabled via `enableAliasDiscovery: false` in user settings. Erroneous or noisy tags can be blacklisted via `ignoredAliases: string[]`, preventing them from being discovered, linked, or resolved.
8. Discovered aliases can be inspected and edited via `/api/aliases/discovered` (`GET`, `PUT /:id` accepts `{ id, aliases, sites, enabled }`, `DELETE /:id`). All writes serialize atomically through `jsonFileStore.js`.
9. **A bad discovered alias must never kill a search.** `fetchPosts()` (danbooru and single-site leaf branches) tracks substitutions via `getQuerySubstitutions()`; when a substituted query returns zero posts, the same fetch is retried once with `bypassDiscoveredAliases: true` so the user's original token reaches the board. The retry rescuing posts proves the alias was harmful: `reportAliasOutcome()` counts `failCount`, and after 3 empty-result failures the group is auto-disabled (`enabled: false`, kept visible in the manager, reset by a manual edit or re-enable). `/api/posts` responses may carry `aliasInfo: { fallbackUsed, substitutions }` for client-side transparency toasts. Custom and built-in aliases are operator-curated: they participate in the fallback retry but are never auto-quarantined.
10. **The Danbooru tag budget is part of the request contract.** Since 2026-11-10 Danbooru charges 2 tags to anonymous callers, 3 to member accounts and nothing from Gold upward (`User.tag_query_limit`). One tag over budget is a `422`, which surfaces as an empty gallery, so the query builder in `src/parsers/danbooru.js` spends slots through `addTag()` and never past `getDanbooruQueryTagCap()`. Metatags in `PostQuery::UNLIMITED_METATAGS` (`rating`, `score`, `id`, `date`, `parent`, ...) are free; **`order:` is not free** — the live API answers `422` for `solo 1girl order:score`. `src/services/danbooruTagLimitService.js` owns the budget table, mirrors that metatag list, reads the real limit from `/profile.json` (`tag_query_limit`, `Infinity` serialized as `null`) and caches it per login for 7 days. Credentials with an unresolved limit fall back to 3, which is safe for every registered level; never restore the old `Infinity`-with-credentials shortcut.

### Author Resolution

Author detection is ground-truth first, heuristics second. The previous order was inverted and that was the source of most wrong authors.

- `booruTagTypeService.js` reads the tag category from the board that owns the tag (`s=tag` DAPI for Gelbooru, Rule34 and Paheal). Gelbooru and Rule34 are different booru genealogies from the Konachan `tags/summary.json` in `tagClassifier.js`, so that dictionary reports "unknown" for most real artists of these boards. It stays as a fallback, never as the primary answer.
- Upstream tag category lookups are performed ONLY on single post views (gated by `allowDynamicLookup === true`, such as `fetch...PostById` or when opening a post via `/api/resolve-post`), NEVER across batch search feeds (`fetchPosts`), preventing massive DAPI request storms and network timeouts during search queries.
- `classifyPostTags()` takes a trailing `site` argument and respects `allowDynamicLookup`. When present and enabled, the board's answer is consulted first and outranks every heuristic, including `globalTagMap`. Raw codes are per-board: Gelbooru uses 5 for metatags, Rule34 uses 5 for "invalid" and 6 for metatags. `normalizeBooruTagType()` owns that mapping; unknown codes resolve to `null` so the caller's own heuristic stays in charge instead of being actively misled.
- Lookups are batched, deduped, capped at 4 parallel, and persisted to `data/cache/booru_tag_types_<site>.json` with a 7-day TTL.
- `extractAuthorFromSourceUrl()` in `tagHelpers.js` resolves a source handle from URL **structure** (host plus path segment). A substring search over the whole URL is forbidden: it promoted `eula_(genshin_impact)` to a Genshin artist because a DeviantArt artwork slug contained the word "Eula". Tag-to-handle matching is a whole-token comparison only.
- `pixiv.net/artworks/<id>` names an artwork, not an account, and yields no handle. Account routes are `/users/<id>`, `/en/users/<id>`, `member.php?id=` and `pixiv.me/<name>`. `extractPixivArtworkId()` pulls the artwork id out of the artwork route and out of the `i.pximg.net` CDN filename.
- `isNoiseHandle()` blocks site chrome from becoming an author. Without it, `www.fanbox.cc` produced the author `www` and `patreon.com/user` produced `patreon:user`. `tagme` and the other request tags are never authors.
- **When no visual author survives, return `""`.** The viewer renders that as "автор не указан". Empty is honest; a wrong author pollutes favourite authors and the Kemono/Pawchive resolver. Do not add a fallback that invents a name. Assistant tags (`no_sound`, audio, music tracks `*_(music)`, `*_(sound)`) and general material/weather words (`nylon`, `fog`, `wool`, `cotton`, `silk`) must never be promoted to author when no visual artist is present.
- `isAuthorResolutionConfident()` is the gate for skipping extra upstream work. It is exported for callers that want to batch or warm resolutions; the parsers currently always resolve.

Normalized post contract:

```js
{
  id, originalId, site, fileUrl, sampleUrl, previewUrl,
  thumb180, thumb360, thumb720, isVideo, hasSound, tags, rating
}
```

Preview tiers are native board URLs, shared by every site (the gallery reads `thumb*` for all boards, not just Danbooru): `thumb180` is the small thumbnail (low), `thumb360` is the sample or the preview when the board returned no distinct sample (medium), `thumb720` is the sample (high), `thumbOriginal` is the full file (original). The medium tier must never alias the full file while a smaller preview exists — that aliasing made medium/high feel identical to original and forced the gallery to download multi-MB files per card. A definitive empty DAPI page means "no posts" and must return `[]` without firing the slow HTML fallback; bare-tag author confirmation must not `await` the global tag dictionary before the DAPI request.

Animated GIFs: Booru sites (Gelbooru, Rule34, Safebooru, etc.) often generate static single-frame JPEG samples (`sample_...jpg`) for animated GIF uploads. Parsers must ensure `sampleUrl` for verified GIFs points to the animated `fileUrl` (`.gif`) rather than a static JPEG sample, and frontend image loaders (viewer, slides) must prefer `fileUrl` for GIFs so animations play smoothly instead of freezing on a static frame.

Boards that only publish a short teaser in their feed add two optional fields:

```js
{
  teaserUrl,          // the short clip, used for card previews only
  hasFullMediaPending // fileUrl is not final yet, the full stream must be resolved
}
```

- Rule34Video is the only current user. Its feed markup carries `data-preview`, a ~20s silent teaser, and nothing else, so `fileUrl` holds the teaser and the real stream has to be resolved on demand.
- The teaser must never be played as the video. `videoPlayer.js` attaches no source while `isFullMediaPending()` holds and shows a retry overlay instead of silently looping the teaser.
- Cards legitimately use the teaser. `getCardPreviewVideoUrl()` keeps them on it after the viewer replaced `fileUrl` with the 1080p link.
- `isFullMediaPending()` also matches teaser URLs, so posts stored in favourites and likes before the flag existed reopen correctly.
- The board only serves `/video/<id>/<slug>/`; the bare id form answers 404. `resolveRule34VideoFullMedia()` reuses the post page link when it has one and otherwise makes a single manual redirect hop, which must stay on the board host.
- Rule34Video feed thumbnails use lazy loading with `data-rd-src` / `data-rd-jpg` and place a 1x1 transparent GIF in `src`. The parser prioritizes `data-rd-src` and `data-rd-jpg`, explicitly ignoring `data:` placeholder URIs to prevent media proxy 403 errors and broken card previews.
- Rule34Video author resolution queries the fast official `models_json.php` API first (resolving in ~50-100ms) and checks the persistent disk cache (`r34v_authors.json`), falling back to member and channel scraping only when needed. When an author is resolved from a single search token, the token is consumed as the author target and excluded from general title-filtering tokens. Pagination requests are capped by the author's known total count, and HTTP 404 on subpages past the end indicates normal end-of-feed on KVS CMS.

- Rule34 operates with an explicit provider setting (`rule34Provider`: `'rule34xxx'` or `'paheal'`). Automatic fallback from Rule34.xxx to Paheal is disabled; switching between the two databases is strictly manual via settings.
- Rule34.xxx public scraping is protected by Cloudflare bot management: outbound requests are serialized and paced via `executePacedRule34Fetch` (minimum 500ms spacing between outbound request starts). Transient rate limits (HTTP 429, 403, Cloudflare CAPTCHA) trigger exponential backoff retries and throw rate-limit errors (HTTP 429) rather than returning a false empty list (`[]`), preserving infinite scroll state (`state.page--`, `state.hasMore: true`). Deep-fetch for scraping Rule34 without API keys is capped to at most 2 iterations, and client-side speculative prefetch is disabled for Rule34 without API keys to conserve upstream rate-limit budget.

Adding a site requires: parser module, `SITES` entry, `fetchSingleSiteBatch` case, all-sites capability use, frontend site metadata, settings UI metadata if site-specific, parser tests and documentation updates.

### Album and Series Grouping

- Posts are grouped into albums and series on search ingestion (`groupPostsIntoAlbums`) and on single post view (`/api/posts/album`).
- A shared upstream key (`pixiv:<id>`, `twitter:<id>`, `fanbox:<id>`, `parent:<site>:<id>`) alone is insufficient to group posts: artists often publish monthly sketch dumps, Twitter logs, or miscellaneous collections (`いろいろ`) containing completely disparate characters and franchises under one external post ID.
- `arePostsAlbumCompatible()` enforces content compatibility:
  - **Author**: Both posts must belong to the same visual artist or assistant (`arePostsAuthorCompatible`).
  - **Franchise / Copyright**: If both posts specify copyright tags (excluding `original` and `crossover`), their franchises must overlap unless tagged `crossover`.
  - **Characters**: If both posts specify character tags, their base character names (`extractBaseCharacterName`, e.g. `hibiki_(cheerleader)_(blue_archive)` normalized to `hibiki`) must overlap, unless the work is tagged as sequential art (`comic`, `manga`, `4koma`, etc.). Disjoint character sets without comic tags (e.g. Hibiki vs Shigure) are strictly prohibited from merging.
  - **Subject / Gender**: Solo girl vs solo boy posts without named characters are not merged into single-character albums unless tagged `genderbend` or `comic`.
  - **Original Art**: For solo original characters with no character tags, disjoint solid hair colors (e.g. blonde vs black) prevent unrelated character illustrations from merging into false albums.
- When compatibility fails, `/api/posts/album` returns `success: false, albumCount: 0` to preserve the post as a single item, and `groupPostsIntoAlbums` retains distinct card entries.

### Settings And Cache Keys

- Incoming client settings use `x-booru-auth`; parse them only through `parseRequestAuth()`.
- Merge with server settings through `resolveRequestSettings()`.
- Persist settings through `sanitizeSettingsPatch()`. Anonymous callers cannot write credentials, proxies, `maxServerCacheMb`, deep-fetch depth or other server budgets.
- `buildAuthCacheKey()` hashes the effective merged values of `AUTH_CACHE_FIELDS`. Add any setting that changes filtering or parser behavior to that list, or users receive stale or mixed cached pages.
- Client and server defaults are currently duplicated in `constants.js`, `state.js` and `settingsConstants.js`. Change all affected copies together.

### Network And SSRF

- All outbound HTTP goes through `fetchSafe()` in `utils/network.js`.
- `fetchSafe()` only performs the deterministic literal check so unit tests stay offline. Every handler that accepts a user-supplied URL must call `isSafeExternalUrlResolved()` first, and `fetchSafe()` re-checks resolved DNS on every redirect hop.
- Literal and DNS-resolved checks fail closed. Never move a DNS lookup into the hot path of a fixed-host call: that made the parser suites depend on live DNS and fail intermittently.
- Host matching uses label boundaries from `hostPolicy.js`; never use `hostname.includes(domain)` for auth or security decisions.
- Danbooru Basic credentials are sent only to `danbooru.donmai.us`.
- A configured proxy that cannot be created is an error, never a silent direct connection.
- Never log proxy userinfo, signed query strings or full CDN URLs; use `sanitizeLogUrl()`.
- Board access is token-only. `siteSessionService.js` no longer exchanges credentials: it normalizes the operator's pasted `session` cookie and nothing else. Do not reintroduce a login/password exchange, an upstream login request, or a server-side session cache. Kemono's JSON login API and the Pawchive HTML form are intentionally unused; a gallery page issues many parallel requests, so any per-request credential exchange would trip the upstream anti-flood.
- `fetchSafe()` must keep `redirect: 'manual'` for every hop. Leaving it unset lets undici follow redirects on its own, which hides the `Location` and `Set-Cookie` headers a caller needs to inspect. A caller asking not to follow has to receive the 3xx itself.
- A caller that needs the redirect target must follow the `Location` itself and re-check the host. Rule34Video answers any `/video/<id>/<slug>/` with a 301 to its canonical page, and that `Location` is untrusted input.
- Never log board credentials, session tokens or a raw login response body. Log the site and the HTTP status only.
- A gallery page issues many parallel requests. Every login path must stay single-flighted, cached and paced; a login per request trips the upstream anti-flood and gets the deployment blocked.

### Media And FFmpeg

- Media proxy allows raster images, video and audio only. HTML, JavaScript, SVG and unknown content are rejected.
- Per-source media proxying (`siteMediaProxy: { [site]: 'default' | 'server' | 'direct' }`) lets users configure direct CDN loading or server-proxied caching per board. `shouldProxyMedia({ site, url, type, settings })` in `public/js/api.js` is the single source of truth for routing client media requests.
- Image bodies are streamed with a 30 MB byte cap, validated by signature, cached atomically and served with `nosniff` plus a sandbox CSP.
- Disk image cache is LRU-by-access: cache hits update mtime through `touchCacheFile()`.
- FFmpeg never receives a remote URL. Remote media is first downloaded through `fetchSafe()` into a bounded local temp file, then processed and cleaned up.
- FFmpeg concurrency is split per kind by `mediaJobSupervisor.js`: transcodes are CPU-bound (2 parallel, queue 32), thumbnails are I/O-bound (6 parallel, queue 48). A saturated transcode pool must never stall gallery thumbnails; never merge the budgets back into one global counter.
- Each thumbnail request carries a shorter remote-input budget (45s vs 120s for transcode): a slow upstream must fail fast to the SVG placeholder instead of pinning a slot. Per-hash dedup maps cover the remaining duplicate-request case.
- Boards that serve large video clips (Pawchive) must emit ONE thumbnail URL (`quality=medium`) for `thumb180`/`thumb360`/`thumb720`; three quality variants mean three full-file downloads per video card.
- Thumbnail and transcode outputs are written to unique temp files, validated, then atomically renamed.
- HEVC sources (name markers `h.265`/`265`/`hevc`/`h265`/`x265`) must not be handed to the media element when the browser lacks a HEVC decoder: `public/js/modules/hevcCodec.js` detects this and `videoPlayer.js` routes them through `/api/transcode-video` automatically. Never let the JS remux path claim an HEVC source — demuxing cannot make an undecodable codec playable.

### Archives

- Only ZIP archives are downloaded, inspected, extracted and streamed. RAR and 7z links may be listed as archive attachments, but they are not unpacked.
- Archive hosts are allowlisted by exact suffix boundary.
- Caps cover compressed size, uncompressed total, per-entry size, entry count and zlib output. In-memory document inspection inflates through a separate smaller ceiling (`MAX_INFLATE_BYTES`), so a bomb cannot trade disk for RAM.
- Extracted SVG files are not treated as gallery media and archive responses use `nosniff` plus a sandbox CSP.
- Archive routes are rate-limited and host URLs are checked before download.
- Archive downloads and inspections use `BOORU_USER_AGENT` to comply with Pawchive's anti-bot policy (`file.pawchive.pw` DDoS-Guard blocks browser User-Agents and generic `Mozilla/5.0` with 403), and segmented download concurrency for Pawchive is capped at 4 threads to stay within upstream limits.

### Storage

- User data (settings, likes/favorites/dislikes, favorite authors, notifications, author-check state, the users index, discovered aliases) lives in **SQLite** at `DATA_DIR/booru.db` through `sqliteStore.js`, using the built-in `node:sqlite` (zero dependencies). Scopes are `'global'` and `'user:<id>'`. Tables: `kv(key, value)` for JSON documents, `posts(scope, kind, idx, data)` for ordered collections, `notifications(scope, idx, notif_id, read, data)`. WAL is on, with `busy_timeout=3000` and `synchronous=NORMAL`. Writes are synchronous and immediate: no debounce, no shutdown flush.
- `BOORU_STORAGE_BACKEND=json` forces the legacy JSON path. If `node:sqlite` is unavailable or the database cannot open, `isActive()` reports false and every caller transparently falls back to the legacy files — the process always boots.
- Legacy JSON files are imported once per scope at first database open (`migrateLegacyJson`): a `migrated:v1:<scope>` marker in `kv` plus per-target emptiness checks make it idempotent and unable to overwrite newer database rows. The legacy files are **kept on disk as a rollback path**, not deleted. `server.js` runs it in `runStartupMaintenance()` before the artifact cleanup, so a rewritten users index can never shadow the import source.
- Under the legacy backend everything below still applies: `jsonFileStore.js` writes are atomic, serialized per file, revision-aware and flushed on shutdown. Never call `fs.writeFile` directly for user data.
- Serialization is compact (no indentation) everywhere. Under the legacy backend, collections (`likes`, `favorites`, `dislikes`, `favorite_authors`) are additionally gzip-compressed, chosen by basename; settings and `users.json` stay readable JSON because they get hand-edited. Under the default SQLite backend, data is not hand-editable — edit via the UI/API or force the JSON backend.
- `readJsonFile` detects gzip by magic bytes, not by file name. A collection written before compression must keep reading, so never gate decompression on the extension or an existing `.gz` sibling.
- Storage-level in-memory caches (`inMemorySettings`, `usersIndexCache` in `storageService.js`) are keyed by `backendFingerprint()`. A backend or data-directory switch (tests, forced JSON mode) must never serve stale cached values.
- Stored posts pass through `sanitizeStoredPost()` in `storedPostSchema.js`. It is an **allowlist**, not a denylist: any field added to a post later stays out of storage by default. When a renderer starts reading a new post field, add it to `STORED_POST_FIELDS` explicitly or it will be missing from every stored collection. By default, `albumItems` is stripped from persistent collections (likes, favorites, dislikes) to preserve bounded storage; callers needing full album hierarchy (such as `notificationService.js`) explicitly pass `{ keepAlbumItems: true }`.
- `cleanPostPayload()` in `public/js/api.js` strips the same internal fields client-side. Keep it aligned with the server allowlist: a payload carrying a similar-posts pool (up to ~120 posts) counts against the `express.json` body limit.
- **Collections are never trimmed.** Every like, favorite and disliked post the user made stays forever; likes feed recommendations through `likedAt`. Growth is bounded per record instead: measured 3496 B/like before, 372 B after. Do not add a cap, a TTL or oldest-first eviction to `saveLikes`/`saveFavorites`/`saveDislikes` — that would silently delete user data.
- **Exception, client-only:** the browser view history (`booru_view_history_v1` in `public/js/state.js`) is a recency list, not a user collection: it lives only in localStorage, is capped at 500 compact entries, is never synced to the server and never enters the Telegram backup. It is cleared on logout next to `booru_viewed_v1`. Do not start syncing it per user without revisiting the backup-size contract.
- Redundant URL tiers are elided only when provably identical: `thumbOriginal` is dropped when byte-equal to `fileUrl`, `thumbSample` only when equal to `sampleUrl` *and* `thumb720` exists. Never elide a tier that differs, and never drop `thumbSample` when it is the only card preview available.
- `compactStoredCollections()` in `storageService.js` rewrites pre-existing collections on boot under the legacy backend and is idempotent (a file already compact and gzipped is skipped); under SQLite it only makes sure the import has run and reports nothing to do. `cleanupStaleUserArtifacts()` in `userService.js` removes throwaway `test_user_*` accounts from the index (their scope rows from the database too) and `.corrupt-<stamp>` quarantine copies that nothing else prunes. Both run from `runStartupMaintenance()` in `server.js` and must never block startup.
- Secret settings are listed in `SECRET_SETTING_FIELDS`, which now includes proxy URLs and the Kemono and Pawchive session tokens. Do not return those fields to anonymous clients or include them in backups.
- The client keeps a duplicate `SECRET_SETTING_FIELDS` in `public/js/state.js`. Every new credential must be added to both lists, otherwise it survives a client export or is never sent in `x-booru-auth`.

### Auth And Ownership

- Passwords use asynchronous `scrypt`; minimum length is 8 characters.
- Bearer tokens include a per-user version. Logout increments it and revokes existing tokens.
- Account export contains identity only, never `passwordHash` or `salt`. Restore requires the plaintext account password.
- `authMiddleware` is soft auth. `requireAuth` protects user data. `requireOwner` protects cache clear, proxy test, tunnel, Telegram backup and server download.
- Anonymous GET requests for user collections (`/api/favorite-authors`, `/api/favorites`, `/api/likes`, `/api/dislikes`) return empty arrays so logged-out clients manage their own state purely in `localStorage` without leaking or inheriting server-level files.
- `requireOwner` accepts either the owner session (first registered user) or, when `BOORU_ADMIN_TOKEN` is set, a matching `x-booru-admin-token` header with no session at all. The token alone is the credential, so token-only operators are not locked out.
- The client stores the operator token in `localStorage` under `booru_admin_token_v1` and sends it from `getAuthHeaders()`. Logout must delete it, because it grants server-wide rights on a shared machine.
- Self-registration is currently open. Deployments reachable from an untrusted network must use firewall, HTTPS and `BOORU_ADMIN_TOKEN`.

### Backup

- Telegram backup is a JSON document, not a ZIP of `data/`.
- The document is serialized compactly, never pretty-printed: it is machine-restored, and indentation costs roughly a quarter of the payload for nothing.
- Credentials, proxies, session tokens and archive passwords are stripped before sending.
- Backups call `sanitizeStoredPost(post, { rawCompact: true })`: internal viewer state never leaves the server, but every stored field is kept so a restore is complete. `rawCompact` also disables the redundant URL tier elision, which would otherwise make an exported record depend on a reconstruction step.
- A document above 45 MB is rejected with a named cause before the Telegram call. Telegram's own 50 MB cap answers with an opaque error, and the scheduled backup would otherwise fail silently every run.
- The scheduler is single-flight per user and cannot overlap runs.

### In-App Notifications & Author Feed Scanner

- `notificationService.js` manages periodic background scanning of followed authors for users (`scanFollowedAuthors`).
- Authors can have custom notification sources (`author.notificationSites: string[]`), completely independent from their gallery search preference (`author.site`). If unspecified or empty, scanning defaults to `[author.site || 'danbooru']`. Sources can be managed via `POST /api/favorite-authors/notification-sites` (`{ name, sites }`) and modal UI.
- State is tracked in `author_feed_state.json` (`knownPostIds`, `latestPostId`, `lastCheckedAt`) partitioned per author and source site (`${site}:${author.name}`).
- On the first scan of an author on a site, existing post IDs are seeded without creating notifications to prevent notification spam for historical works. On subsequent scans, any post ID not present in `knownPostIds` is recognized as a new post.
- Multi-photo and video posts are grouped into albums via `groupPostsIntoAlbums(rawPosts, { enabled: true })` before notification checks. When an author posts a multi-image album or series, exactly one notification is created for the entire post with `{ keepAlbumItems: true }` embedded in `post`. All child IDs from `albumItems` and `seriesKey` are recorded in `knownPostIds` and deduplicated in `storageService.js` (`addNotification`) to prevent separate child notifications.
- Notifications are stored in `notifications.json` (per user or root data dir) capped at 100 items. Each notification embeds a sanitized post (`sanitizeStoredPost(post, { keepAlbumItems: true })`), allowing instant viewer or vertical feed launch without requiring a secondary network roundtrip.
- Outbound requests are sequentially paced (350ms delay between authors and sources) to respect upstream rate limits.
- Background scheduler (`initNotificationScheduler`) executes checks based on `notificationsInterval` (default 15 minutes) and can be triggered on-demand via `POST /api/notifications/check` (rate-limited via `createRateLimiter`).
- Frontend notifications module `public/js/modules/notificationsUI.js` mounts the bell in `.header-right`, renders Civitai-style unread counter badge, popover dropdown with tabs ("Все" / "Непрочитанные"), multi-media album badges with count, click-to-open viewer routing via `openPostOverlay(-1, { directPost: post, initialAlbumIndex: 0 })` ensuring albums open from slide 0, live in-app toasts for new arrivals, and periodic 60s/visibility polling.

## 7. Frontend Architecture

- No framework. `public/` is served statically and bundled by esbuild (`public/js/app.js` → `public/dist`, code-splitting keeps dynamic `import()` boundaries). Heavy subsystems (viewer stack, settings modal, profile, downloads, wiki, aliases) stay lazy; do not add static imports of them from `app.js`, or they rejoin the critical path. Variable-specifier dynamic imports do not bundle — always use literal specifiers in `importOnce` loaders.
- `public/dist/` is git-ignored and rebuilt by `postinstall` on `npm install` and by `server.js` when sources change (mtime check); `npm run build:client` rebuilds manually. esbuild is a runtime dependency so `npm install --omit=dev` deploys still build.
- `state.js` owns mutable state, local persistence and import/export. `api.js` owns HTTP and auth headers. `app.js` coordinates search and routing.
- `index.html` is a slim shell. Modal markup (viewer, settings, wiki, auth, alias manager) lives in `modules/*Markup.js` and is injected into `document.body` on first use of the owning module; `applyStaticTranslations` runs right after injection, and `i18n.setLang` re-translates the whole document on language change. Controls inside injected markup must be bound after `ensure*Markup()` — for wiring that runs at app init (quality selects, PWA install), use event delegation or move the binding into the markup owner.
- `router.js` is the only writer of search and viewer URL state. Missing URL parameters restore canonical defaults.
- The phone feed (`public/js/feed/`) is a fullscreen vertical snap feed for viewports up to 800 px. `openPostOverlay()` in `app.js` routes every "open post" action: phones get the feed, desktops keep the viewer; archive posts (`isArchive`, `zip`, `archiveUrls`) always open the viewer. `view=feed` mirrors a feed session in the URL; `notifyFeedOpened/Moved/Closed` in `router.js` own those history entries. The track keeps a shell for every index (scroll geometry is always listLength screens); the content of a small window is populated lazily. A tap toggles video playback (or the chrome on still slides), a long press opens the "more" sheet with the Clean screen mode, the sound toggle sits in the rail on video posts, and the bottom bar scrubs. Player rules (HEVC, teasers, scrubbing) live in `public/js/feed/video.js`. Long-press on a phone grid card opens the quick actions sheet; per-card action buttons stay hidden below 800 px.
- Album carousel pages mount lazily around the visible page; only the current page plays, far video players are destroyed and an album lookup is aborted when its slide leaves the window. `syncList()` may rebuild a shorter list and must keep the current post by id, because removing a disliked post shifts every index.
- Viewer, feed and settings share `modules/scrollLock.js`; never write `body.style.overflow` directly. The reference count keeps a lower surface from unlocking the page when a higher one is still open, and the settings/feed `*-open` body classes hide the floating download dock.
- Omitting a default in `buildQuery()` and normalizing it in `applyUrlToState()` must be symmetric. Compare canonical values, never param presence: `if ((p.site || 'danbooru') !== state.currentSite)`, not `p.site !== state.currentSite`. A false `changed` re-runs `performSearch(true)`, which re-renders the gallery without `preserveScroll` and jumps the feed back to the top, so Back from the viewer silently loses the scroll position. Cover new fields in `test/unit/routerUrlState.test.js`.
- **Every site switch goes through `applyCurrentSiteUi()`** (`modules/siteSelectionUI.js`). It repaints the sources panel highlight, the header label, the capability-gated filter controls and the Pawchive/Kemono platform dropdowns in one call. Never assign `state.currentSite` and then re-render only some of those: a partial update leaves the old source highlighted while the gallery shows another one, and the highlighted source then looks selected but its click is a no-op (`selectSite` short-circuits on an unchanged site). `searchAuthorPosts()` in `app.js` used to hit exactly that, because `handleExploreAuthor()` assigned the site first, so the inner "did the site change?" check saw no change and skipped the panel. Keep the assignment in one place. `syncSourceSelectionUI()` is the only repaint path; it compares a signature and skips identical repaints, so it can be called unconditionally. Pass `{ force: true }` after a language change or once the site registry arrives.
- `selectSite()` treats "already selected" as a statement about the feed on screen (`state.currentSite === id && state.loadedSite === id`), not about the preference alone. `performSearch()` records `state.loadedSite`, so a settings write or restore that rewrites `currentSite` without a new fetch stays recoverable with one click. Cover the panel highlight and handler retention in `test/unit/sourcePanelSelection.test.js`.
- Gallery cards are delegated on `#galleryGrid`; per-card listeners are allowed only for media error and metadata events.
- Cards open with click, Enter or Space and expose an accessible name.
- Untrusted text is escaped. Untrusted URLs pass through `toSafeHttpUrl()` or `toSafeImageUrl()`. Never interpolate raw upstream fields into `innerHTML`.
- Every modal has dialog semantics, focus containment, Escape behavior and focus restoration through `modalAccessibility.js` where applicable.
- Primary touch targets are at least 44 by 44 px. Zoom must not be disabled in the viewport meta tag.
- The search sidebar collapses on desktop only (`min-width: 801px`, see `modules/sidebarCollapse.js`). Below that breakpoint the same element is the mobile drawer driven by the `open` class, and the collapse class must stay inert.
- The collapse animates `margin-left`, not `width`: a width transition re-wraps the panel's blocks mid-slide. The collapsed panel is `visibility: hidden` so it leaves the tab order and the accessibility tree, and the toggle moves focus to itself when the panel it lived in is hidden.
- Preset names wrap to two lines (`-webkit-line-clamp: 2`) instead of being ellipsized. The sidebar is 280px, and a single line left roughly 70px for a typical tag; the full text stays in the `title` attribute. Source and filter badges get their own row and only render when present.
- Pointer-only affordances stay 28px and grow to 44px under `@media (hover: none)`. Anything that reveals on hover needs a touch equivalent, and its opacity must not change the reserved layout space.
- Client-side mutations send `desiredState` so retries and double clicks are idempotent. Failed mutations roll back optimistic state.
- Reads must not convert HTTP failures into successful empty lists. Preserve last-known-good state on 5xx or network errors.
- Account loaders use a generation guard so responses from a previous session cannot commit into the next account.
- UI strings use `t('key', 'Русский текст')`. Static markup uses `data-i18n*`; do not put translatable text with child markup directly on a `data-i18n` parent.
- Gallery icons come from the SVG sprite in `index.html`. Do not set `fill` on card SVG elements; swap `<use href>`.
- CSS tokens live in `variables.css`. Legacy aliases are temporary; do not add new references to undefined custom properties.
- After changing CSS or `app.js`, bump the `?v=X.Y` value on every versioned asset in `index.html` (CSS, manifest, icons, `dist/app.js`) and sync `CACHE_NAME` in `public/sw.js`. Server serves those as `immutable`; a forgotten bump strands old assets in the browser cache.
- `mp4box.all.min.js` loads lazily only when client-side demuxing is used.

Visual changes follow `DESIGN.md`: collector's-cabinet identity, amber `#e5a968` accent, Fraunces / Plus Jakarta Sans / JetBrains Mono, dials ENERGY 2 / RHYTHM 2 / MOTION 2.

## 8. Verification Policy

1. Run `node --check` for every touched JavaScript file, including `public/js`.
2. Run `npm test` before delivery.
3. Tests must stay isolated from the real `data/` directory. `test/run-all.js` creates a temp root through `BOORU_DATA_DIR`; integration tests must never point at the working installation.
4. Parser tests use Undici `MockAgent` and `disableNetConnect`. New parser tests must not depend on live sites.
5. A new `*.test.js` file needs no registration; it is discovered automatically. Never edit the runner to whitelist suites.
6. Integration tests boot the app on port `0` with `NODE_ENV=test`.
7. For runtime changes, boot with `node server.js --no-open` and smoke-test `/api/version`, `/api/cache-info`, `/api/posts?site=danbooru&limit=5` and affected endpoints.
8. For UI changes, verify keyboard navigation, empty/loading/error states, all three themes and a narrow mobile viewport.
9. Review `git diff` for secrets, generated data and unintended deletions before handoff.

There is no linter. Do not claim verification for a check that was not executed.

## 9. Deployment And Operations

- `.github/workflows/deploy.yml` runs `npm test` on pushes and pull requests. The Alwaysdata deploy job depends on the verify job. Verify installs dependencies, builds the client bundle explicitly, then runs the tests; the deploy repeats the install and build on the host.
- Push to `main` or `master` deploys immediately after verification.
- Alwaysdata deploy runs `git reset --hard origin/<branch>`, `npm install --omit=dev` (which builds the client via `postinstall`), an explicit `npm run build:client`, and touches `tmp/restart.txt` for Passenger. The branch is `github.ref_name`, so a push to `master` deploys `master` instead of resetting the host to `main`.
- `tmp/restart.txt` is generated at deploy time and must not be tracked.
- Vercel uses `vercel.json`; serverless data is ephemeral and multi-user persistence is not supported there.
- Never add `engines` to `vercel.json`: its schema rejects unknown top-level properties and the whole build fails. Vercel resolves the Node version from `engines` in `package.json`.
- Server logs are categorized through `utils/logger.js`.

## 10. Known Constraints

- Storage is single-node: SQLite (WAL, in-process) or the legacy JSON files are not suitable for concurrent serverless writers. On Vercel, `DATA_DIR` points into an ephemeral tmpdir, so the database exists but per-user persistence is not supported there.
- Anonymous callers share the default global data namespace. Do not treat LAN access as a trust boundary.
- Archive unpacking supports ZIP only.
- DNS pre-checks reduce rebinding risk but do not pin the connection IP; keep user-controlled media behind the allowlists and ownership checks.
- Media element requests cannot send the custom `x-booru-auth` header, so per-user proxy settings are only guaranteed for API requests.
- `scratch/` is not part of automated verification. Promote valuable cases into `test/` before deleting a scratch script.

## 11. Local Agent Tooling

`.agents/`, `.antigravity/`, `anti-slop/` and the antislop block below are local tooling, not tracked project contract. Never commit them.

<!-- antislop:start -->
## antislop
For UI, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:
- UI / visual: `skills/antislop-ui/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`
Before starting, ask the user when antislop applies: during the work, or after it is done.
<!-- antislop:end -->
