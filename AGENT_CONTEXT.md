# 🧠 AGENT_CONTEXT.md — Руководство по архитектуре и кодовой базе

> **Назначение файла**: Этот документ предназначен для быстрого погружения AI-ассистента и разработчиков в устройство проекта Booru Explorer в новых сессиях. Содержит полную схему архитектуры, ключевые контракты, потоки данных и правила разработки.

---

## 📌 1. Общие сведения о проекте
* **Название**: Booru Explorer
* **Стек**: Node.js (ESM), Express.js, Vanilla JavaScript (ES6+), Vanilla CSS, HTML5.
* **Репозиторий GitHub**: `https://github.com/David3e234234/booru-explorer`
* **Основная ветка**: `main`
* **Порт по умолчанию**: `3000` (http://localhost:3000)

---

## 🏛 2. Структура проекта

```
BooruExp/
├── AGENT_CONTEXT.md         # Данный справочник архитектуры для AI-агента
├── README.md                # Пользовательская документация проекта
├── package.json             # Конфигурация проекта (ESM: "type": "module")
├── server.js                # Основной бэкенд сервер (Express API, прокси, парсеры)
├── start.bat                # Скрипт запуска для ПК (Windows)
├── start_phone.bat          # Скрипт запуска для мобильных устройств
├── start_phone.js           # Определение локального IP и вывод QR-кода
├── .gitignore               # Исключение личных данных (settings.json, favorites.json, кэш)
├── data/                    # Локальное хранилище (не коммитится в Git)
│   ├── settings.json        # Личные настройки пользователя и API-ключи
│   ├── settings.example.json# Шаблон настроек по умолчанию (в Git)
│   ├── favorites.json       # Избранные посты пользователя
│   └── cache/               # Дисковый кэш превью и видео (LRU автоочистка)
│       ├── thumbnails/
│       └── videos/
└── public/                  # Фронтенд (SPA без сборщиков и фреймворков)
    ├── index.html           # Базовая разметка страницы и модальных окон
    ├── manifest.json        # Манифест PWA
    ├── sw.js                # Service Worker для PWA
    ├── css/
    │   ├── variables.css    # Цветовые темы (Dark, Light, OLED Pure Black) и токены
    │   ├── main.css         # Базовые стили, сетка, сайдбар, скроллбары
    │   ├── components.css   # Кнопки, бейджи, инпуты, карточки галереи
    │   └── viewer.css       # Стили модального окна просмотра (Pan/Zoom, плеер)
    └── js/
        ├── state.js         # Глобальный реактивный стейт приложения (state)
        ├── api.js           # Клиентские методы HTTP-запросов к бэкенду
        ├── autocomplete.js  # Умный автокомплит тегов с категориями
        ├── gallery.js       # Рендер карточек, infinite scroll, мобильный автоплей
        ├── viewer.js        # Полноэкранный просмотрщик (Pan/Zoom, видеоплеер, fallback)
        └── app.js           # Точка входа фронтенда, роутинг, темы, настройки
```

---

## ⚙️ 3. Архитектура бэкенда (`server.js`)

### Ключевые модули и классы:
1. **`MemoryCache`**: In-Memory LRU кэш с TTL (посты кэшируются на 6 минут, теги — на 30 минут).
2. **Дисковый кэш (`cleanDiskCacheIfNeeded`)**: Автоматическая очистка старых файлов при превышении лимита (1.5 GB).
3. **Универсальные хелперы**:
   * `extractAuthor(rawTags, source, itemAuthor)`: Извлекает авторов из тегов (`artist:`, `*_(artist)`), ссылок источников (`Twitter/X`, `Pixiv`, `ArtStation`, `Fanbox`, `Fantia`, `Patreon`, `Skeb`) и метаданных.
   * `normalizeDate(rawDate)`: Приводит любые timestamp / строковые даты в ISO стандарт `YYYY-MM-DDTHH:mm:ss.sssZ`.
   * `classifyTags(rawTags, author)`: Классифицирует теги по группам: `artist`, `character`, `copyright`, `meta`, `general`.
   * `checkMediaTypes(url, fileExt, rawTags)`: Определяет `isVideo`, `isGif`, `hasSound`, `fileExt`.
   * `checkIsAi(tagsArray, aiTagsList)`: Детектирует ИИ-генерации по 20+ маркерам.
   * `adaptTagsForSite(site, tags, ageFilter, typeFilter)`: Адаптирует синтаксис тегов (скобки, алиасы, возрастные фильтры) под конкретный Booru.

### Поддерживаемые сайты (Парсеры):
* `danbooru` (`fetchDanbooru`): Официальный REST API c поддержкой вариантов `media_asset`.
* `gelbooru` (`fetchGelbooru`): DAPI JSON (с поддержкой API ключа) + Fallback HTML Scraper.
* `rule34` (`fetchRule34`): API key DAPI + открытый Paheal XML API.
* `yandere` / `konachan` (`fetchMoebooru`): JSON Moebooru API.
* `safebooru` (`fetchSafebooru`): DAPI XML/JSON.
* `rule34video` (`fetchRule34Video`): Парсер видеоархива со звуком и предпросмотром.
* `xbooru` (`fetchXbooru`), `hypnohub` (`fetchHypnohub`): DAPI JSON.
* `all`: Round-Robin агрегатор со всех активных источников.

### Основные эндпоинты:
* `GET /api/posts`: Поиск и выдача постов с фильтрами (`site`, `tags`, `page`, `category`, `aiFilter`, `ratingFilter`, `typeFilter`, `ageFilter`).
* `GET /api/proxy`: Потоковый HTTP-прокси с поддержкой `Range` заголовков для бесперебойного видео и обхода CORS/хотлинка.
* `GET /api/video-thumbnail`: Генерация или извлечение превью кадров из видео.
* `GET /api/transcode-video`: Транскодирование видео через FFmpeg в совместимый H.264/AAC.
* `POST /api/download`: Скачивание медиафайлов.
* `GET /api/tags/autocomplete`: Автокомплит тегов с внешних API.
* `GET / POST /api/settings`: Управление настройками.
* `GET / POST /api/favorites`: Избранное.

---

## 🎨 4. Архитектура фронтенда (`public/`)

### 1. `state.js`
Хранит централизованное состояние:
* Текущий сайт (`currentSite`), категория (`currentCategory`), страница (`page`), посты (`posts`), фильтры (`ratingFilter`, `typeFilter`, `aiFilter`, `ageFilter`), настройки (`settings`), избранное (`favorites`).

### 2. `gallery.js`
* `renderGallery()`: Отрисовывает сетку постов.
* **Бейджи на карточке**:
  * 🎨 **Автор**: кликабелен, сразу запускает поиск по автору.
  * 🎬 **Формат/Качество**: `4K UHD`, `2K QHD`, `HD`, `🎬 VIDEO`, `🔊 ЗВУК`, `GIF`.
  * 🔞 **Рейтинг**: `18+` (для `explicit` / `questionable`).
  * 📅 **Дата публикации**: `дд.мм.гггг`.
  * 🤖 **ИИ**: `🤖 ИИ`.
* **Автоплей**: Умный предпросмотр видео при ховере (ПК) и через `IntersectionObserver` (мобильные).

### 3. `viewer.js`
* Полноэкранный режим с поддержкой жестов, зума (`wheel`, `dblclick`, drag) и горячих клавиш (`←`, `→`, `F`, `Esc`).
* Видеоплеер с управлением источниками: Прямой CDN ⚡ ⟷ Прокси 🛡️ ⟷ FFmpeg 🔄 ⟷ Кэш в память ⚡.
* Кликабельные теги и автор в боковой панели.

---

## 🔒 5. Безопасность и Git-правила

1. **Обязательное обновление этого файла (`AGENT_CONTEXT.md`)**:
   * При любых доработках, изменении архитектуры, добавлении новых эндпоинтов, исправлении багов или изменении структуры компонентов **AI-ассистент обязан дополнять и актуализировать этот файл**.
   * Все важные архитектурные решения и изменения должны фиксироваться в разделе **7. Журнал изменений и решений**.
2. **Никаких секретов в Git**:
   * Файлы `data/settings.json`, `data/favorites.json`, `data/cache/` **никогда не должны попадать в коммиты**.
   * Для шаблона настроек используется `data/settings.example.json`.
3. **Обновление репозитория на GitHub**:
   * По запросу пользователя после значимых изменений:
     1. Проверить синтаксис `node --check server.js public/js/*.js`.
     2. Убедиться, что `git status` не содержит лишних временных файлов.
     3. Зафиксировать коммит с понятным описанием.
     4. Отправить в ветку `main` (`git push origin main`).

---

## 🚀 6. Полезные команды

* Запуск dev-сервера: `npm start` или `node server.js`
* Запуск для мобильных (с QR-кодом): `node start_phone.js`
* Проверка синтаксиса JS: `node --check server.js public/js/gallery.js public/js/viewer.js public/js/app.js`

---

## 📝 7. Журнал изменений и ключевых решений (Decision Log)

* **2026-08-16**:
  * **Фикс видеоплеера**: Устранена ошибка `ReferenceError: switchBtn is not defined` в `viewer.js`, из-за которой блокировалось открытие видео постов в галерее.
  * **Универсальные авторы и метаданные**: Реализован глубокий парсер `extractAuthor()` (распознавание ссылок Pixiv/Twitter/ArtStation/Fanbox/Patreon/Skeb), `normalizeDate()` и `classifyTags()` для всех 11 Booru (Gelbooru, Rule34, Safebooru, Yande.re, Konachan, Rule34Video, Xbooru, Hypnohub).
  * **Интерактивные карточки**: Бейджи авторов `🎨` сделаны кликабельными (поиск в 1 клик), добавлены градации качества (`4K UHD`, `2K QHD`, `HD`), даты и формат.
  * **Подготовка к GitHub**: Добавлен `.gitignore`, исключены личные ключи/настройки, удалены временные файлы, создан шаблон `data/settings.example.json`. Репозиторий выгружен на `https://github.com/David3e234234/booru-explorer`.

