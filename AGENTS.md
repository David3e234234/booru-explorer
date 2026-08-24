# AGENTS.md

## Commands

```bash
npm start                    # = node server.js (port 3000; auto-increments if busy)
node server.js --no-open     # same without auto-opening the browser
start_phone.bat              # LAN access + QR code
```

`--port=N` overrides the port (also reads `PORT`/`SERVER_PORT` env). `package-lock.json` is gitignored by choice - do not commit it. `scratch/` holds tracked ad-hoc node scripts (manual parser checks), not dead code.

- **No test suite, no linter.** Verification = `node --check <file>` for every touched file (works for ESM backend and `public/js` alike), then boot with `--no-open` and smoke-test endpoints via curl (`/api/posts?site=danbooru&limit=5`, `/api/version`, `/api/cache-info`). Server stdout logs are categorized (`[Search]`, `[Proxy]`, `[FFmpeg]`, ...) via `src/utils/logger.js`.
- **ffmpeg must be on PATH** for video thumbnails/transcoding. Without it endpoints return an SVG placeholder by design - do not "fix" that fallback.
- Node 18+ required (native fetch). Project is fully ESM (`"type": "module"`).

## Deploy happens on push to main

`.github/workflows/deploy.yml` SSHes to Alwaysdata on every push to `main`/`master`: `git reset --hard origin/main`, `npm install --omit=dev`, restart via `touch tmp/restart.txt` (Passenger). **Pushing main ships to production immediately - CI runs no tests/build - verify before pushing.** A Vercel deployment also exists (`vercel.json`, live demo linked in README); when `VERCEL` env is set, `isServerless` in `src/config/constants.js` redirects data writes to `os.tmpdir()` and skips `app.listen`.

## Architecture

Express monolith + vanilla-JS frontend with **no build step**: `public/` is served statically and the browser imports ES modules directly. Cache-busting is manual via `?v=X.Y` query strings in `index.html` - bump them when changing CSS/JS assets.

Search request flow:
1. `GET /api/posts` (`src/routes/posts.routes.js`) - parses query, builds cache key, delegates.
2. `fetchPosts()` in `src/parsers/index.js` is the single aggregation entrypoint: per-site deep-fetch loop; all-sites mode uses `Promise.allSettled` with a per-site deadline (`withDeadline`) and round-robin merge.
3. Each parser in `src/parsers/*.js` normalizes its site API into one post shape: `{ id: "site_<origId>", originalId, fileUrl, sampleUrl, previewUrl, thumb180/360/720, isVideo, hasSound, tags[], rating }`. New site = new parser + case in `fetchSingleSiteBatch`.
4. **Content filtering runs exactly once**, inside step 2 via `isPostMatchingFilters` (`src/utils/tagHelpers.js`). Do not re-filter results in routes - that duplicate pass was a real perf bug here.

Caching layers:
- API responses: LRU `MemoryCache` (`src/services/cacheService.js`). Key = query params + md5 of auth-affecting settings (`AUTH_CACHE_FIELDS` in posts.routes.js). If you change anything that influences filter results, update that list or users get stale/mixed cached pages.
- Media proxy: disk cache under `data/cache/thumbnails|videos`, filename = md5(url), with an in-flight dedup map (`inflightImages`) and 30MB buffer cap (`proxyService.js`). Disk cleanup is LRU-by-mtime, triggered every 30 min or when `maxServerCacheMb` setting changes.
- Video thumbnails/transcodes dedupe concurrent requests through `activeThumbnails` / `activeTranscodes` maps (`videoService.js`) - keep that pattern for any new ffmpeg work or you will spawn process storms from gallery pages.

Auth model: the client sends its settings/API keys on every request via the `x-booru-auth` header (see `getAuthHeaders` in `public/js/api.js`); the server merges it over its own `data/settings.json`. Multi-user sessions live in `data/users/`.

Storage: all persistence is JSON files in `data/` (gitignored) with debounced async writes (`writeJsonFileAsync`, 150ms debounce). Posts saved to favorites/likes/dislikes must go through `sanitizeStoredPost` (`src/routes/user.routes.js`) which strips heavy nested fields (`albumItems`, `allSeriesKeys`) - keep new bulky fields out of stored payloads.

Backups: outside serverless, `initBackupScheduler` (`src/services/backupService.js`) zips `data/` and sends it to a user-configured Telegram bot every 30 min.

## Conventions

- **Code comments are in English.** UI text and log messages are in **Russian** by default; English UI comes from the i18n layer (`public/js/i18n.js`): static HTML carries `data-i18n*` attributes, JS strings go through `t('key', 'Русский текст')`. New UI strings must follow that pattern. Match the surrounding language.
- Gallery cards use an SVG sprite: icons are `<symbol id="ic-*">` defs in `index.html` referenced with `<use href="#ic-*">`. Like/fav state toggles swap the `use` href between outline (`#ic-heart`) and filled (`#ic-heart-filled`) symbols - do not set `fill` attributes on card SVGs.
- Card click/hover handlers are delegated on `#galleryGrid` (single listener), not attached per-card. Per-card listeners exist only for img/video error and metadata events.
- `uncaughtException`/`unhandledRejection` handlers swallow network teardown errors (`ECONNRESET`, aborts) intentionally - server must never crash from client disconnects.
- `.agents/`, `.antigravity/` and `anti-slop/` are local agent tooling: gitignored, never commit them.

<!-- antislop:start -->
## antislop
For UI, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:
- UI / visual: `skills/antislop-ui/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`
Before starting, ask the user when antislop applies: during the work, or after it is done.
<!-- antislop:end -->
