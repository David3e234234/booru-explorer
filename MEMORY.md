# 2026-08-30

## Полный аудит багов проекта

Провёл read-only аудит всего проекта (бэкенд, фронтенд, инфраструктура). Отчёт:
`C:\Users\Lifutik\.workbuddy-ai\plans\toasty-cascade-darwin-Jo1rrIcu.md`

Итог: 7 критических дыр, ~19 существенных багов, ~11 мелочей.

### Что важно помнить
- **Авторизация декоративная**: `authMiddleware` (`src/services/userService.js:334-344`)
  никогда не отдаёт 401, только присоединяет `req.user`. Все `/api/user/*` публичны,
  включая `GET /api/settings` с ключами и паролями.
- **`/api/git-pull`** (`user.routes.js:52-69`) — RCE + DoS без авторизации, `process.exit(0)`.
- **`/api/download`** (`posts.routes.js:633-669`) — path traversal через `site`/`id`/`ext`,
  SSRF через `url`, плюс `open()` открывает проводник на сервере. Роутер без auth.
- **`/api/proxy`** (`proxyService.js:288`) — открытый прокси. В `archiveService.js:42-52`
  уже есть `ALLOWED_HOSTS`-проверка — её надо вынести в общий хелпер и переиспользовать.
- **Секреты в Telegram-бэкап**: `backupService.js:153-159` кладёт `settings` целиком.
  Плюс `storageService.js:109/114` сохраняет ENV-секреты на диск.
- `fetchSafe` (`src/utils/network.js:131-139`) **перезаписывает `signal` вызывающего** —
  все `controller.abort()` в.proxyService не работают.
- Пагинация `parsers/index.js:186-231`: `startRemotePage = (page-1)*pageMultiplier + 1`
  рассинхронизирован с реальным числом съеденных страниц → infinite scroll стынет на 2-й странице.
- `storageService.js:35-38` — битый JSON молча превращается в `defaultData` (потеря избранного).

## Этап 1: закрытие критических дыр (реализовано)

Давид выбрал «Этап 1: только дыры». Сделано и проверено curl-тестами:

1. **`userService.js`**: `authMiddleware` остался мягким (приложение local-first,
   разлогиненный юзер хранит данные в браузере), добавлен жёсткий `requireAuth` (401).
   `requireAuth` повешен на `cache-clear`, `tunnel`, `backup/telegram/{test,send}`,
   `sync-external`, `download`.
2. **`/api/settings`**: анониму отдаются и принимаются только не-секретные поля
   (`stripSecretSettings` + `SECRET_SETTING_FIELDS` в `constants.js`). С токеном — всё.
   Это закрыло «подсунуть свой telegramBotToken и получить бэкап себе».
3. **`/api/git-pull` удалён** (никто его не дёргал).
4. **`/api/download`**: allowlist расширений, регекспы на `site`/`id`, `path.resolve`
   + проверка родителя, `isSafeExternalUrl(url)`, `open()` выпилен.
5. **`isSafeExternalUrl`** (`src/utils/network.js`) подключён в `proxyService`,
   `videoService.resolveFfmpegInput` (заодно запрещены относительные URL кроме
   `/api/archive/file`) и `ai.routes.js` (плюс лимит 64 на батч).
6. **ffmpeg-таймаут** 30 с + `settled`-флаг: без него подвисший источник навсегда
   подвешивал промис и запись в `activeThumbnails`.
7. **Бэкап**: секреты вырезаны, `passwordHash`/`salt` из `exportAccountRecord` не уезжают.
8. **`storageService`**: `updateSettings` больше не пишет ENV-секреты в `settings.json`.

### Грабли на будущее
- **Нельзя требовать токен на всём `/api/user/*`** — сломается local-first режим.
  Делить на мягкий/жёсткий middleware, как выше.
- **curl в этой песочнице идёт через `HTTP_PROXY=127.0.0.1:58915`** → без `--noproxy '*'`
  локальные запросы отдают 502. И `curl -o /dev/null` здесь глючит (exit 23, size=0) —
  писать в файл.
- **`&` в Bash-туле убивает процесс** по выходу команды — сервер только через
  `run_in_background: true`.
- **git в воркспейсе**: «dubious ownership», работать через
  `git -c safe.directory='*'` (не трогать глобальный конфиг).
- ffmpeg в PATH этой среды нет → `/api/video-thumbnail` отдаёт SVG-заглушку. Это
  by design, не чинить.

## Этап 2: сеть, ресурсы, потери данных (реализовано)

Давид: «1) [antislop] потом 2) приступай».

1. **`fetchSafe`** (`network.js`): сигналы мерджатся (`combineAbortSignals` → `AbortSignal.any`
   с фолбэком на Node 18), тело накрыто таймаутом (`withBodyTimeout` + `BODYLESS_STATUS`
   101/103/204/205/304, иначе `new Response(body,{status:204})` бросает). Опция
   `streamBody: true` для трёх мест, где тело льётся напрямую клиенту/на диск
   (прокси, `archiveService`, `/api/download`) — там дедлайн держит свой AbortController.
2. **`discardResponse(res)`** добавлен во все парсеры, `storageService` (лайки/избранное —
   тела POST вообще никто не читал), `tagClassifier` и все три цикла 404-fallback,
   сведённые в `fetchWith404Fallback` в `proxyService`.
3. **`withDeadline`** (`parsers/index.js`) теперь отменяет работу, а не только резолвит `[]`.
   Механизм: `AsyncLocalStorage` в `network.js` (`runWithDeadlineSignal`) — сигнал дедлайна
   подхватывается `fetchSafe` из асинхронного контекста, не протаскивая его через все
   сигнатуры парсеров. **Вложенные дедлайны мерджатся** — иначе внутренний `run` затирал бы
   внешний. `withDeadline` принимает фабрику `() => promise` (контекст должен существовать
   до старта запроса) и терпимо относится к голому промису.
4. **`storageService`**: запись через tmp+rename, `writeJsonFile` отменяет висящий
   дебаунс-таймер (иначе он затирал свежие данные старыми), битый JSON не молча
   заменяется дефолтом, а откладывается в `<file>.corrupt-<ISO>` с громким логом.
   Добавлен `flushPendingWrites()` + обработчики SIGINT/SIGTERM/exit в `server.js`
   (отложенная запись за 150 мс терялась при рестарте).
5. **Кеш**: `imageCachePath(url)` — один ключ на чтение и запись (раньше запись
   кешировала по effectiveUrl из 404-fallback, чтение искало по исходному → мимо).
   `hasValidCacheFile` проверяет магию перед `sendFile`, иначе кешированная HTML-ошибка
   отдавалась вечно. `enablePaheal` добавлен в `AUTH_CACHE_FIELDS`, `limit` зажат
   до `MAX_POSTS_LIMIT = 200`.

### Верификация этапа 2
- `/api/posts?site=<каждый>`: danbooru 5, gelbooru 5, rule34 4, yandere 5, safebooru 5.
- `site=all&limit=20` → 20 постов ровно по 2 с 10 сайтов; rule34video оборван на 15 с
  («This operation was aborted», страницы 9–12) — раньше он догружался в фоне.
- Прокси: холодный 200/10137 b/568 мс, повторный с диска 7 мс, байты идентичны, `ffd8ffdb`.
  Range `bytes=0-999` → 206/1000 b (путь `streamBody` + `pipeUpstream` жив).
- `scratch/check-storage.mjs` — 9/9 PASS (включая « sync-запись побеждает висящий
  дебаунс » и карантин битого файла). `scratch/check-fetchsafe.mjs` — 7/7 PASS.
- Регресс этапа 1 не поехал: 75 полей и 0 секретов анониму, SSRF → 403,
  защищённые ручки → 401.

### Грабли (дополнение)
- **`withDeadline` вызывался в двух местах** — второй вызов (`launchPage` в глубоком
  поиске) передавал уже запущенный промис. После смены сигнатуры на фабрику это дало
  `TypeError` → `.catch(() => [])` → **все поиски по одному сайту (кроме danbooru)
  молча отдавали 0 постов за 27 мс**. Поймано только живым curl-тестом: `node --check`
  тут не помощник. Проверять `site=all` И каждый сайт по отдельности.
- **Диагностика «сайт отдаёт 0»**: у Давида в `data/settings.json` стоит
  `globalProxy = user335792:...@89.106.202.82:1744`. Прогон парсеров напрямую
  (`scratch/check-parsers.mjs`) с `{}` и с реальными settings сразу показывает,
  виноват прокси или код. Danbooru через прокси ходит, так что «прокси жив».
- **Сервер в фоне: НЕ `| tail`** — буферизует весь вывод до выхода процесса, логов не видно.
  Писать в файл: `node server.js --no-open > tmp/smoke.log 2>&1`.
- **Префикс ручек**: `userRoutes` монтируется как `app.use('/api', userRoutes)`,
  т.е. `/api/cache-clear`, а не `/api/user/cache-clear`.

### Проект
- Деплой на Alwaysdata по пушу в `main` (`.github/workflows/deploy.yml`), CI без тестов.
- Тестов и линтера нет. Верификация: `node --check` + запуск с `--no-open` + curl.
- `data/` весит ~1.2 ГБ при лимите 1500 МБ; `data/cache/images` и `temp` не чистятся никогда.
- `undici@8` требует Node >= 22.19, а README/AGENTS.md заявляют 18+ — `engines` не задан.
