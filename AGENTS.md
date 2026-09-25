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
7. Do not add a build step, framework or runtime dependency without an explicit need and a documented reason.
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
node --check path/to/file.js               # every touched JS file
```

`test/run-all.js` discovers `*.test.js` under `test/unit` and `test/integration` at runtime and imports unit suites before integration ones. Never reintroduce a hardcoded suite list: a stale list silently skips new tests, which is how regressions reach `main`.

Runtime requirement: Node.js `22.19.0` or newer, enforced by `engines` in `package.json` and CI.

`package-lock.json` is intentionally ignored by repository policy. Deploys therefore run `npm install --omit=dev`, not `npm ci`; this is a known reproducibility tradeoff and must be mentioned when dependencies change.

Runtime dependencies are kept minimal and must stay `0 vulnerabilities` under `npm audit --omit=dev`. Express is pinned to `^4.22.3` so the patched `body-parser` and `qs` are always installed.

## 4. Runtime And Environment

- `PORT` and `SERVER_PORT` set the port; `--port=N` has priority.
- `BOORU_DATA_DIR` overrides the data root. Tests always create a temporary directory.
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
src/utils/                     network, tag logic, logging, host policy, settings policy
public/index.html              static application shell and SVG sprite
public/js/                     ES modules loaded directly by the browser
public/css/                    theme tokens and component styles
test/unit/                     pure unit and mocked parser suites
test/integration/              Express app tests on an ephemeral port
scratch/                       tracked manual diagnostics, not part of npm test
```

Large files must be split by responsibility when touched. Preferred existing boundaries:

- `jsonFileStore.js`: atomic serialized JSON writes
- `settingsValidation.js`: request auth parsing, settings allowlists, cache key
- `hostPolicy.js`: hostname boundaries, credential hosts, log redaction
- `imageCacheService.js`: image signatures and disk cache
- `mediaJobSupervisor.js`: FFmpeg concurrency and queue limits
- `siteSessionService.js`: session-token normalization for the Kemono-family boards
- `tagAutocomplete.routes.js`: autocomplete endpoint, independent from search routes
- `rateLimit.js`: per-instance fixed-window limiter; every limiter gets its own budget
- `public/js/modules/*`: UI subsystems loaded by `app.js`

## 6. Backend Architecture

### Search Flow

1. `GET /api/posts` in `posts.routes.js` parses and validates the query, resolves effective settings, and builds a cache key.
2. `fetchPosts()` in `parsers/index.js` is the only aggregation entrypoint.
3. Single-site mode runs the parser and a bounded deep-fetch loop.
4. All-sites mode uses `Promise.allSettled`, a per-site deadline, `Promise.allSettled` fan-out, round-robin merge and a final `limit` slice.
5. `isPostMatchingFilters()` in `tagHelpers.js` is the canonical content filter. Danbooru also prefilters inside its parser to avoid expensive cursor paging; routes must never add another filter pass.

Normalized post contract:

```js
{
  id, originalId, site, fileUrl, sampleUrl, previewUrl,
  thumb180, thumb360, thumb720, isVideo, hasSound, tags, rating
}
```

Adding a site requires: parser module, `SITES` entry, `fetchSingleSiteBatch` case, all-sites capability use, frontend site metadata, settings UI metadata if site-specific, parser tests and documentation updates.

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
- Never log board credentials, session tokens or a raw login response body. Log the site and the HTTP status only.
- A gallery page issues many parallel requests. Every login path must stay single-flighted, cached and paced; a login per request trips the upstream anti-flood and gets the deployment blocked.

### Media And FFmpeg

- Media proxy allows raster images, video and audio only. HTML, JavaScript, SVG and unknown content are rejected.
- Image bodies are streamed with a 30 MB byte cap, validated by signature, cached atomically and served with `nosniff` plus a sandbox CSP.
- Disk image cache is LRU-by-access: cache hits update mtime through `touchCacheFile()`.
- FFmpeg never receives a remote URL. Remote media is first downloaded through `fetchSafe()` into a bounded local temp file, then processed and cleaned up.
- FFmpeg concurrency is limited globally by `mediaJobSupervisor.js`; per-hash dedup maps cover the remaining duplicate-request case.
- Thumbnail and transcode outputs are written to unique temp files, validated, then atomically renamed.

### Archives

- Only ZIP archives are downloaded, inspected, extracted and streamed. RAR and 7z links may be listed as archive attachments, but they are not unpacked.
- Archive hosts are allowlisted by exact suffix boundary.
- Caps cover compressed size, uncompressed total, per-entry size, entry count and zlib output. In-memory document inspection inflates through a separate smaller ceiling (`MAX_INFLATE_BYTES`), so a bomb cannot trade disk for RAM.
- Extracted SVG files are not treated as gallery media and archive responses use `nosniff` plus a sandbox CSP.
- Archive routes are rate-limited and host URLs are checked before download.

### Storage

- All persistence is JSON under `DATA_DIR` through `jsonFileStore.js`.
- Writes are atomic, serialized per file, revision-aware and flushed on shutdown.
- Never call `fs.writeFile` directly for user data.
- Stored posts pass through `sanitizeStoredPost()`; keep heavy fields such as album items and unpacked state out of persisted payloads.
- Secret settings are listed in `SECRET_SETTING_FIELDS`, which now includes proxy URLs and the Kemono and Pawchive session tokens. Do not return those fields to anonymous clients or include them in backups.
- The client keeps a duplicate `SECRET_SETTING_FIELDS` in `public/js/state.js`. Every new credential must be added to both lists, otherwise it survives a client export or is never sent in `x-booru-auth`.

### Auth And Ownership

- Passwords use asynchronous `scrypt`; minimum length is 8 characters.
- Bearer tokens include a per-user version. Logout increments it and revokes existing tokens.
- Account export contains identity only, never `passwordHash` or `salt`. Restore requires the plaintext account password.
- `authMiddleware` is soft auth. `requireAuth` protects user data. `requireOwner` protects cache clear, proxy test, tunnel, Telegram backup and server download.
- `requireOwner` accepts either the owner session (first registered user) or, when `BOORU_ADMIN_TOKEN` is set, a matching `x-booru-admin-token` header with no session at all. The token alone is the credential, so token-only operators are not locked out.
- The client stores the operator token in `localStorage` under `booru_admin_token_v1` and sends it from `getAuthHeaders()`. Logout must delete it, because it grants server-wide rights on a shared machine.
- Self-registration is currently open. Deployments reachable from an untrusted network must use firewall, HTTPS and `BOORU_ADMIN_TOKEN`.

### Backup

- Telegram backup is a JSON document, not a ZIP of `data/`.
- Credentials, proxies, session tokens and archive passwords are stripped before sending.
- The scheduler is single-flight per user and cannot overlap runs.

## 7. Frontend Architecture

- No bundler. `public/` is served statically and the browser imports ES modules directly.
- `state.js` owns mutable state, local persistence and import/export. `api.js` owns HTTP and auth headers. `app.js` coordinates search and routing.
- `router.js` is the only writer of search and viewer URL state. Missing URL parameters restore canonical defaults.
- Omitting a default in `buildQuery()` and normalizing it in `applyUrlToState()` must be symmetric. Compare canonical values, never param presence: `if ((p.site || 'danbooru') !== state.currentSite)`, not `p.site !== state.currentSite`. A false `changed` re-runs `performSearch(true)`, which re-renders the gallery without `preserveScroll` and jumps the feed back to the top, so Back from the viewer silently loses the scroll position. Cover new fields in `test/unit/routerUrlState.test.js`.
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
- After changing CSS or `app.js`, bump the `?v=X.Y` value in `index.html` and update the service-worker cache version.
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

- `.github/workflows/deploy.yml` runs `npm test` on pushes and pull requests. The Alwaysdata deploy job depends on the verify job.
- Push to `main` or `master` deploys immediately after verification.
- Alwaysdata deploy runs `git reset --hard origin/main`, `npm install --omit=dev` and touches `tmp/restart.txt` for Passenger.
- `tmp/restart.txt` is generated at deploy time and must not be tracked.
- Vercel uses `vercel.json`; serverless data is ephemeral and multi-user persistence is not supported there.
- Never add `engines` to `vercel.json`: its schema rejects unknown top-level properties and the whole build fails. Vercel resolves the Node version from `engines` in `package.json`.
- Server logs are categorized through `utils/logger.js`.

## 10. Known Constraints

- JSON storage is single-node and not suitable for concurrent serverless writers.
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
