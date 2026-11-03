// Markup for the settingsModal dialog, injected on first use of the owning module.
// Kept out of index.html so the initial shell stays small; data-i18n
// attributes are translated right after injection.
import { applyStaticTranslations } from '../i18n.js';

const MARKUP = `
  <!-- Settings modal -->
  <div class="settings-modal" id="settingsModal" style="display: none;" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
    <div class="settings-backdrop" id="settingsBackdrop"></div>
    <div class="settings-dialog">
      <div class="settings-header">
        <div class="settings-header-title-row">
          <h3 class="settings-title" id="settingsModalTitle" data-i18n="settings.title">Настройки и фильтры</h3>
        </div>
        <button class="btn-icon" id="btnCloseSettings" title="Закрыть" data-i18n-title="modal.close.title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Settings category tabs -->
      <div class="settings-nav-tabs">
        <button type="button" class="settings-nav-tab active" data-tab="general" title="Общие параметры интерфейса и плеера" data-i18n-title="settings.tabGeneral.title">
          <span class="tab-label" data-i18n="settings.tabGeneral">Общие</span>
        </button>
        <button type="button" class="settings-nav-tab" data-tab="search" title="Параметры поиска, источники и рекомендации" data-i18n-title="settings.tabSearch.title">
          <span class="tab-label" data-i18n="settings.tabSearch">Поиск</span>
        </button>
        <button type="button" class="settings-nav-tab" data-tab="filters" title="Черный список, ИИ и слова-триггеры для фильтров" data-i18n-title="settings.tabFilters.title">
          <span class="tab-label" data-i18n="settings.tabFilters">Фильтры</span>
        </button>
        <button type="button" class="settings-nav-tab" data-tab="proxy" title="Маршрутизация медиа, кэш и серверные прокси" data-i18n-title="settings.tabProxy.title">
          <span class="tab-label" data-i18n="settings.tabProxy">Прокси</span>
        </button>
        <button type="button" class="settings-nav-tab" data-tab="apikeys" title="API ключи для Booru" data-i18n-title="settings.tabApikeys.title">
          <span class="tab-label" data-i18n="settings.tabApikeys">Ключи</span>
        </button>
        <button type="button" class="settings-nav-tab" data-tab="storage" title="Кэш, память и перенос данных" data-i18n-title="settings.tabStorage.title">
          <span class="tab-label" data-i18n="settings.tabStorage">Память</span>
        </button>
      </div>

      <div class="settings-content">
        <!-- 1. TAB: GENERAL -->
        <div class="settings-tab-pane active" id="tabPane-general">
          <!-- Card: Appearance & Language -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                <span data-i18n="settings.cardAppearance">Оформление и язык</span>
              </h4>
              <p class="settings-card-hint">Язык интерфейса и визуальный стиль приложения.</p>
            </div>

            <!-- Interface language -->
            <div class="settings-group">
              <label class="settings-label" data-i18n="settings.language">Язык интерфейса:</label>
              <div class="theme-options" id="langOptions">
                <button type="button" class="btn-theme active" data-lang-val="ru">
                  <span data-i18n="settings.langRu">Русский</span>
                </button>
                <button type="button" class="btn-theme" data-lang-val="en">
                  <span data-i18n="settings.langEn">English</span>
                </button>
              </div>
            </div>

            <!-- Appearance theme -->
            <div class="settings-group">
              <label class="settings-label" data-i18n="settings.theme">Цветовая тема:</label>
              <div class="theme-options">
                <button class="btn-theme active" data-theme-val="kotobox" title="Фирменный тёплый эспрессо и крафтовый янтарь" data-i18n-title="settings.themeKotobox.title">
                  <span class="theme-preview-dot theme-preview-kotobox"></span>
                  <span data-i18n="settings.themeKotobox">Котобокс</span>
                </button>
                <button class="btn-theme" data-theme-val="tokyo-night" title="Индиго-ноктюрн и неоновый коралл">
                  <span class="theme-preview-dot theme-preview-tokyo"></span>
                  <span>Токио</span>
                </button>
                <button class="btn-theme" data-theme-val="warm-paper" title="Тёплая бумага и янтарный акцент" data-i18n-title="settings.themePaper.title">
                  <span class="theme-preview-dot theme-preview-paper"></span>
                  <span data-i18n="settings.themePaper">Манускрипт</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Card: Feed & Gallery Parameters -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                <span data-i18n="settings.cardFeedGallery">Параметры ленты</span>
              </h4>
              <p class="settings-card-hint">Настройки плотности выдачи и качества изображений при прокрутке.</p>
            </div>

            <!-- Number of posts -->
            <div class="settings-group">
              <label class="settings-label" for="selectItemsPerPage" data-i18n="settings.itemsPerPage">Количество постов за один прокрут (порция):</label>
              <p class="settings-hint" data-i18n="settings.itemsPerPageHint">Сколько постов запрашивать с сайтов за один шаг прокрутки ленты.</p>
              <select id="selectItemsPerPage" class="input-setting">
                <option value="20" data-i18n="settings.items20">20 постов</option>
                <option value="40" selected data-i18n="settings.items40">40 постов (Рекомендуется)</option>
                <option value="60" data-i18n="settings.items60">60 постов</option>
                <option value="80" data-i18n="settings.items80">80 постов</option>
                <option value="100" data-i18n="settings.items100">100 постов</option>
                <option value="150" data-i18n="settings.items150">150 постов</option>
                <option value="200" data-i18n="settings.items200">200 постов (Максимум)</option>
              </select>
            </div>

            <!-- Feed preview quality -->
            <div class="settings-group">
              <label class="settings-label" for="selectPreviewQuality" data-i18n="settings.previewQuality">Качество превью в галерее:</label>
              <p class="settings-hint" data-i18n="settings.previewQualityHint">Выберите баланс между качеством картинок в ленте и скоростью загрузки.</p>
              <select id="selectPreviewQuality" class="input-setting">
                <option value="low" data-i18n="settings.qualityLow">Низкое (миниатюры), максимальная скорость</option>
                <option value="medium" selected data-i18n="settings.qualityMedium">Среднее (стандартное), оптимальный баланс (Рекомендуется)</option>
                <option value="high" data-i18n="settings.qualityHigh">Высокое (HD Sample), повышенная четкость</option>
                <option value="original" data-i18n="settings.qualityOriginal">Оригинал (Full HD / 4K), максимальная детализация</option>
              </select>
            </div>
          </div>

          <!-- Card: Video Playback & Player -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span data-i18n="settings.cardVideoPlayer">Воспроизведение видео</span>
              </h4>
              <p class="settings-card-hint">Поведение плеера, качество видео и автовоспроизведение.</p>
            </div>

            <!-- Video playback quality -->
            <div class="settings-group">
              <label class="settings-label" for="selectVideoDefaultQuality" data-i18n="settings.videoQuality">Качество видео по умолчанию:</label>
              <p class="settings-hint" data-i18n="settings.videoQualityHint">Качество видео при открытии в просмотрщике. Для слабых устройств рекомендуется 480p.</p>
              <select id="selectVideoDefaultQuality" class="input-setting">
                <option value="original" selected data-i18n="settings.videoQualityOriginal">Оригинал (Исходное качество)</option>
                <option value="720p" data-i18n="settings.videoQuality720p">720p HD (Баланс качества и скорости)</option>
                <option value="480p" data-i18n="settings.videoQuality480p">480p (Быстрая загрузка / Для слабых устройств)</option>
              </select>
            </div>

            <div class="settings-group">
              <label class="settings-label" data-i18n="settings.playback">Воспроизведение и автоплей видео:</label>
              <div class="toggles-list">
                <label class="toggle-row" title="Воспроизводить превью видео при наведении курсора мыши в галерее" data-i18n-title="settings.autoplayHover.title">
                  <input type="checkbox" id="checkVideoAutoplayHover" checked>
                  <span class="toggle-slider"></span>
                  <span class="toggle-name" data-i18n="settings.autoplayHover">Автовоспроизведение в ленте при наведении (ПК)</span>
                </label>
                <label class="toggle-row" title="Автоматически запускать видео без звука при прокрутке ленты в фокус на смартфонах" data-i18n-title="settings.autoplayMobile.title">
                  <input type="checkbox" id="checkVideoAutoplayMobile" checked>
                  <span class="toggle-slider"></span>
                  <span class="toggle-name" data-i18n="settings.autoplayMobile">Автовоспроизведение в ленте при прокрутке (Смартфоны)</span>
                </label>
                <label class="toggle-row" title="Автоматически начинать проигрывание видео при открытии в полноэкранном просмотрщике" data-i18n-title="settings.autoplayViewer.title">
                  <input type="checkbox" id="checkVideoAutoplayViewer" checked>
                  <span class="toggle-slider"></span>
                  <span class="toggle-name" data-i18n="settings.autoplayViewer">Автовоспроизведение при открытии в просмотрщике</span>
                </label>
                <label class="toggle-row" title="Показывать информационную плашку с кнопками кеширования в память, FFmpeg и прокси в просмотрщике" data-i18n-title="settings.showStatusBanner.title">
                  <input type="checkbox" id="checkShowVideoStatusBanner" checked>
                  <span class="toggle-slider"></span>
                  <span class="toggle-name" data-i18n="settings.showStatusBanner">Показывать статусную плашку видео (кэш, прокси, транскодер)</span>
                </label>
                <label class="toggle-row" title="Показывать кнопку и нижнюю ленту похожих работ в просмотрщике" data-i18n-title="settings.enableSimilarPosts.title">
                  <input type="checkbox" id="checkEnableSimilarPosts" checked>
                  <span class="toggle-slider"></span>
                  <span class="toggle-name" data-i18n="settings.enableSimilarPosts">Похожие работы в просмотрщике</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Card: Notifications & Author Updates -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                <span data-i18n="settings.cardNotifications">Внутренние уведомления</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.notificationsHint">Фоновое отслеживание новых публикаций авторов, на которых вы подписаны.</p>
            </div>

            <div class="settings-group">
              <div class="toggles-list">
                <label class="toggle-row" title="Автоматически проверять новые работы отслеживаемых авторов" data-i18n-title="settings.notificationsEnabled.title">
                  <input type="checkbox" id="checkNotificationsEnabled" checked>
                  <span class="toggle-slider"></span>
                  <span class="toggle-name" data-i18n="settings.notificationsEnabled">Включить уведомления о новых публикациях</span>
                </label>
              </div>
            </div>

            <div class="settings-group">
              <label class="settings-label" for="selectNotificationsInterval" data-i18n="settings.notificationsInterval">Интервал фоновой проверки:</label>
              <select id="selectNotificationsInterval" class="input-setting">
                <option value="15" selected data-i18n="settings.interval15m">Каждые 15 минут</option>
                <option value="30" data-i18n="settings.interval30m">Каждые 30 минут</option>
                <option value="60" data-i18n="settings.interval60m">Каждый час</option>
              </select>
            </div>

            <div class="settings-group" style="margin-top: 10px;">
              <button type="button" class="btn-primary" id="btnSettingsCheckNotifications" style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                <span data-i18n="notifications.check">Проверить новые посты сейчас</span>
              </button>
            </div>
          </div>

          <!-- PWA app for smartphone/desktop -->
          <div class="settings-group" id="pwaInstallGroup" style="display: none; background: var(--accent-primary-subtle); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-medium);">
            <label class="settings-label" style="color: var(--accent-primary);" data-i18n="settings.pwaLabel">Мобильное PWA-приложение:</label>
            <p class="settings-hint" style="margin-bottom: 10px;" data-i18n="settings.pwaHint">Установите Booru Explorer как отдельное быстрое приложение на рабочий стол смартфона или ПК.</p>
            <button type="button" class="btn-primary" id="btnInstallPwa" style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span data-i18n="settings.pwaInstall">Установить Booru Explorer</span>
            </button>
          </div>
        </div>

        <!-- 2. TAB: SEARCH & SOURCES -->
        <div class="settings-tab-pane" id="tabPane-search" style="display: none;">
          <!-- Card: Search Depth and Algorithms -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span data-i18n="settings.cardSearchEngine">Алгоритм и глубина поиска</span>
              </h4>
              <p class="settings-card-hint">Глубина запросов, альбомы и приоритеты обработки поисковых тегов.</p>
            </div>

            <!-- Deep fetch pages -->
            <div class="settings-group">
              <label class="settings-label" for="selectDeepFetchPages" data-i18n="settings.deepFetch">Глубина глубокого поиска (страниц на запрос):</label>
              <p class="settings-hint" data-i18n="settings.deepFetchHint">Сколько скрытых страниц опрашивать вглубь на всех сайтах для заполнения ленты при строгой фильтрации.</p>
              <select id="selectDeepFetchPages" class="input-setting">
                <option value="1" selected data-i18n="settings.deep1">1 страница (быстро, по умолчанию)</option>
                <option value="2" data-i18n="settings.deep2">2 страницы</option>
                <option value="3" data-i18n="settings.deep3">3 страницы (глубокий)</option>
                <option value="4" data-i18n="settings.deep4">4 страницы (очень глубокий)</option>
                <option value="5" data-i18n="settings.deep5">5 страниц (максимальный)</option>
              </select>
            </div>

            <!-- Toggles: Albums & Tags -->
            <div class="toggles-list">
              <label class="toggle-row" title="Автоматически объединять многостраничные посты и серии одного поста в альбомы" data-i18n-title="settings.groupAlbums.title">
                <input type="checkbox" id="checkGroupAlbums" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.groupAlbums">Группировать многостраничные посты в альбомы</span>
              </label>
              <label class="toggle-row" title="Ручные теги (например 'petite') будут иметь приоритет над сортировкой 'Популярное' и 'Видео' при поиске на Danbooru" data-i18n-title="settings.prioritizeTags.title">
                <input type="checkbox" id="checkPrioritizeUserTags">
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.prioritizeTags">Отдавать приоритет ручным тегам перед системными фильтрами (Danbooru)</span>
              </label>
            </div>
          </div>

          <!-- Card: Source Specifics -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                <span data-i18n="settings.cardSourceBehaviors">Особенности источников</span>
              </h4>
              <p class="settings-card-hint">Индивидуальные настройки для Rule34, Pawchive и видео-движка.</p>
            </div>

            <!-- Rule34 Provider -->
            <div class="setting-row" style="margin-bottom: 8px;">
              <div class="setting-info">
                <label class="setting-title" for="selectRule34Provider" data-i18n="settings.rule34Provider">Источник данных Rule34:</label>
                <span class="setting-desc" data-i18n="settings.rule34ProviderHint">Выберите базу для поиска по сайту Rule34. Автопереключение отключено.</span>
              </div>
              <div class="setting-control" style="min-width: 220px;">
                <select id="selectRule34Provider" class="input-setting">
                  <option value="rule34xxx" selected data-i18n="settings.rule34ProviderXxx">Rule34.xxx (основной)</option>
                  <option value="paheal" data-i18n="settings.rule34ProviderPaheal">Rule34 Paheal (paheal.net)</option>
                </select>
              </div>
            </div>

            <div class="toggles-list">
              <label class="toggle-row" title="Мгновенное воспроизведение проблемных видео прямо в браузере через MediaSource. При отключении плеер сразу использует серверный FFmpeg транскодер." data-i18n-title="settings.jsDemux.title">
                <input type="checkbox" id="checkEnableJsDemuxing" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.jsDemux">Клиентский MP4Box демуксинг (выключите для прямого перехода на FFmpeg)</span>
              </label>
              <label class="toggle-row" title="Не показывать посты Pawchive, в которых нет картинок и видео (только ZIP-архивы)" data-i18n-title="settings.hideZipPosts.title">
                <input type="checkbox" id="checkHideZipPosts">
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.hideZipPosts">Скрывать ZIP-посты (Pawchive)</span>
              </label>
              <label class="toggle-row" title="При нажатии кнопки скачивания ZIP-архива распаковать его на сервере и скачать извлечённые файлы по отдельности" data-i18n-title="settings.unpackArchivesOnDownload.title">
                <input type="checkbox" id="checkUnpackArchivesOnDownload">
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.unpackArchivesOnDownload">Распаковывать архивы на сервере при скачивании</span>
              </label>
            </div>

            <!-- Archive Download Threads -->
            <div class="settings-group" style="margin-top: 8px;">
              <label class="settings-label" for="selectArchiveDownloadThreads" data-i18n="settings.archiveDownloadThreads">Количество потоков загрузки архивов:</label>
              <p class="settings-hint" data-i18n="settings.archiveDownloadThreadsHint">Параллельные HTTP Range запросы для ускорения загрузки ZIP-архивов.</p>
              <select id="selectArchiveDownloadThreads" class="input-setting">
                <option value="1" data-i18n="settings.archiveThreads1">1 поток (обычный режим)</option>
                <option value="2" data-i18n="settings.archiveThreads2">2 потока</option>
                <option value="3" data-i18n="settings.archiveThreads3">3 потока</option>
                <option value="4" selected data-i18n="settings.archiveThreads4">4 потока (рекомендуется)</option>
                <option value="6" data-i18n="settings.archiveThreads6">6 потоков</option>
                <option value="8" data-i18n="settings.archiveThreads8">8 потоков</option>
              </select>
            </div>
          </div>

          <!-- Card: Site Sort Tags -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                <span data-i18n="settings.sortTagsTitle">Теги сортировки по сайтам</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.sortTagsHint">Настройте поисковые теги для кнопок сортировки (Горячее, Просмотры, Топ, Новое) для каждого сайта индивидуально.</p>
            </div>

            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
                <label class="settings-label" for="selectSortTagsSite" data-i18n="settings.selectSortSite">Выберите сайт для настройки:</label>
                <button type="button" class="btn-text" id="btnResetCurrentSiteSort" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.resetSiteSort">Сбросить для этого сайта</button>
              </div>
              
              <select id="selectSortTagsSite" class="input-setting" style="margin-bottom: 12px;">
                <option value="gelbooru">Gelbooru.com</option>
                <option value="danbooru">Danbooru (donmai.us)</option>
                <option value="yandere">Yande.re</option>
                <option value="konachan">Konachan.com</option>
                <option value="safebooru">Safebooru.org</option>
                <option value="rule34">Rule34.xxx / Paheal</option>
                <option value="rule34video">Rule34Video.com</option>
                <option value="xbooru">Xbooru.com</option>
                <option value="hypnohub">Hypnohub.net</option>
                <option value="tbib">TBIB.org</option>
              </select>

              <div class="site-sort-inputs-grid" style="display: flex; flex-direction: column; gap: 10px;">
                <!-- 1. Hot tag -->
                <div class="site-sort-field">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
                    <label class="settings-label" for="inputSiteSortHot" style="font-size: 12px; margin: 0;" data-i18n="settings.sortTagHot">Тег для «Горячее» (Hot):</label>
                    <span id="siteSortHotDefaultBadge" style="font-size: 10px; opacity: 0.65; font-family: monospace;"></span>
                  </div>
                  <input type="text" id="inputSiteSortHot" class="input-setting" placeholder="Тег (например: score:>10, order:rank)..." autocomplete="off" spellcheck="false">
                  <div class="site-sort-presets" id="siteSortHotPresets" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;"></div>
                </div>

                <!-- 2. Views tag -->
                <div class="site-sort-field">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
                    <label class="settings-label" for="inputSiteSortViews" style="font-size: 12px; margin: 0;" data-i18n="settings.sortTagViews">Тег для «Просмотры» (Views):</label>
                    <span id="siteSortViewsDefaultBadge" style="font-size: 10px; opacity: 0.65; font-family: monospace;"></span>
                  </div>
                  <input type="text" id="inputSiteSortViews" class="input-setting" placeholder="Тег (например: sort:views:desc, order:views)..." autocomplete="off" spellcheck="false">
                </div>

                <!-- 3. Top tag -->
                <div class="site-sort-field">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
                    <label class="settings-label" for="inputSiteSortTop" style="font-size: 12px; margin: 0;" data-i18n="settings.sortTagTop">Тег для «Топ» (Top):</label>
                    <span id="siteSortTopDefaultBadge" style="font-size: 10px; opacity: 0.65; font-family: monospace;"></span>
                  </div>
                  <input type="text" id="inputSiteSortTop" class="input-setting" placeholder="Тег (например: sort:score:desc, order:score)..." autocomplete="off" spellcheck="false">
                </div>

                <!-- 4. New tag -->
                <div class="site-sort-field">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
                    <label class="settings-label" for="inputSiteSortNew" style="font-size: 12px; margin: 0;" data-i18n="settings.sortTagNew">Тег для «Новое» (New, опционально):</label>
                    <span id="siteSortNewDefaultBadge" style="font-size: 10px; opacity: 0.65; font-family: monospace;"></span>
                  </div>
                  <input type="text" id="inputSiteSortNew" class="input-setting" placeholder="По умолчанию пусто (хронологическая лента)..." autocomplete="off" spellcheck="false">
                </div>
              </div>
            </div>
          </div>

          <!-- Card: Recommendations and Taste Profile -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                <span data-i18n="settings.recTasteProfileTitle">Профиль вкусов и рекомендаций</span>
              </h4>
              <p class="settings-card-hint">Персонализация ленты «Для вас» на основе реакций и истории.</p>
            </div>

            <div class="settings-group">
              <label class="settings-label" for="selectRecommendationMode" data-i18n="settings.recMode">Лента «Для вас» (Рекомендации):</label>
              <select id="selectRecommendationMode" class="input-setting">
                <option value="tags-only" selected data-i18n="settings.recModeOn">Включена (По тегам и интересам)</option>
                <option value="off" data-i18n="settings.recModeOff">Отключить категорию «Для вас»</option>
              </select>
            </div>

            <div class="settings-group">
              <label class="toggle-row" title="Снижать приоритет тегов артов, мимо которых вы проскроллили без интереса" data-i18n-title="settings.recSkipPenalty.title">
                <input type="checkbox" id="checkRecSkipPenalty" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.recSkipPenalty">Учитывать неявный пропуск (Skip penalty)</span>
              </label>
              <p class="settings-hint" style="margin-top: 4px;" data-i18n="settings.recSkipPenaltyHint">Мягко понижает вес тем, которые задержались на экране, но были пролистаны без открытия или реакций.</p>
            </div>

            <div class="settings-group" style="margin-top: 4px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" data-i18n="settings.sessionInterestsLabel">Сессионная память вкусов:</label>
                <button type="button" class="btn-text" id="btnClearSessionInterests" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.clearSessionBtn">Сбросить сессию</button>
              </div>
              <p class="settings-hint" data-i18n="settings.sessionInterestsHint">Кратковременные сигналы просмотров и зумов в текущей сессии.</p>
            </div>

            <div class="settings-group" style="margin-top: 4px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" data-i18n="settings.topInterestsLabel">Текущие ведущие интересы:</label>
                <span id="recInterestsCount" style="font-size: 11px; color: var(--text-muted);">0</span>
              </div>
              <p class="settings-hint" data-i18n="settings.topInterestsHint">Теги с наивысшим весом на основе ваших лайков и избранного. Нажмите [×], чтобы скрыть тег.</p>
              <div class="rec-interests-chip-container" id="recInterestsContainer">
                <span class="text-muted" style="font-size: 12px;" data-i18n="settings.noInterests">Лайкайте арты, чтобы сформировать профиль вкусов.</span>
              </div>
            </div>

            <div class="settings-group" style="margin-top: 4px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" data-i18n="settings.excludedRecTagsLabel">Исключено из рекомендаций:</label>
                <button type="button" class="btn-text" id="btnResetExcludedRecTags" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.clearAllBtn">Очистить все</button>
              </div>
              <p class="settings-hint" data-i18n="settings.excludedRecTagsHint">Эти теги не используются для сидов и поиска рекомендаций.</p>
              <div class="rec-excluded-chip-container" id="recExcludedContainer">
                <span class="text-muted" style="font-size: 12px;" data-i18n="settings.noExcludedTags">Нет исключенных тегов</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. TAB: FILTERS AND TAGS -->
        <div class="settings-tab-pane" id="tabPane-filters" style="display: none;">
          <!-- Card: Blacklist & AI Detector -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Чёрный список и фильтрация ИИ</span>
              </h4>
              <p class="settings-card-hint">Исключение нежелательного контента и распознавание генераций.</p>
            </div>

            <!-- Tag blacklist -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="blacklistInput" data-i18n="settings.blacklist">Черный список тегов (Blacklist):</label>
                <button type="button" class="btn-text" id="btnResetBlacklist" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.reset">По умолчанию</button>
              </div>
              <p class="settings-hint" data-i18n="settings.blacklistHint">Посты с этими тегами будут скрыты из всех результатов поиска.</p>
              <div class="tags-input-box" id="blacklistWrapper">
                <input type="text" id="blacklistInput" placeholder="Введите тег и нажмите Enter..." data-i18n-placeholder="settings.blacklist.placeholder" spellcheck="false">
              </div>
            </div>

            <!-- AI detection tag list -->
            <div class="settings-group" style="margin-top: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="aiTagsInput" data-i18n="settings.aiTagsList">Список тегов ИИ (AI Detector):</label>
                <button type="button" class="btn-text" id="btnResetAiTags" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.reset">По умолчанию</button>
              </div>
              <p class="settings-hint" data-i18n="settings.aiTagsHint">Теги, по которым система определяет искусственно сгенерированные работы.</p>
              <div class="tags-input-box" id="aiTagsWrapper">
                <input type="text" id="aiTagsInput" placeholder="Добавить AI тег..." data-i18n-placeholder="settings.aiTags.placeholder" spellcheck="false">
              </div>
            </div>
          </div>

          <!-- Card: Toggle Trigger Words -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><circle cx="4" cy="14" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="20" cy="16" r="2"/></svg>
                <span data-i18n="settings.triggerWords">Слова-триггеры для переключателей</span>
              </h4>
              <p class="settings-card-hint">Теги, которые активируются кнопками быстрых фильтров в панели поиска.</p>
            </div>

            <!-- 1. Curvy / Mature -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="curvyTagsInput" data-i18n="settings.curvyWords">Слова для «Пышные / Мамочки» (Curvy / Mature):</label>
                <button type="button" class="btn-text" id="btnResetCurvyTags" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.reset">По умолчанию</button>
              </div>
              <div class="tags-input-box" id="curvyTagsWrapper">
                <input type="text" id="curvyTagsInput" placeholder="Добавить тег (например: milf, mature)..." data-i18n-placeholder="settings.curvy.placeholder" spellcheck="false">
              </div>
            </div>

            <!-- 2. Petite / Loli -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="petiteTagsInput" data-i18n="settings.petiteWords">Слова для «Миниатюрные / Лоли» (Petite / Loli):</label>
                <button type="button" class="btn-text" id="btnResetPetiteTags" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.reset">По умолчанию</button>
              </div>
              <div class="tags-input-box" id="petiteTagsWrapper">
                <input type="text" id="petiteTagsInput" placeholder="Добавить тег (например: loli, petite)..." data-i18n-placeholder="settings.petite.placeholder" spellcheck="false">
              </div>
            </div>

            <!-- 3. Furry and anthro -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="furryTagsInput" data-i18n="settings.furryWords">Слова для «Скрыть фурри и антро» (Furry / Anthro):</label>
                <button type="button" class="btn-text" id="btnResetFurryTags" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.reset">По умолчанию</button>
              </div>
              <div class="tags-input-box" id="furryTagsWrapper">
                <input type="text" id="furryTagsInput" placeholder="Добавить тег (например: furry, anthro)..." data-i18n-placeholder="settings.furry.placeholder" spellcheck="false">
              </div>
            </div>

            <!-- 4. Pregnancy -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="pregnantTagsInput" data-i18n="settings.pregnantWords">Слова для «Скрыть беременность» (Pregnant / Inflation):</label>
                <button type="button" class="btn-text" id="btnResetPregnantTags" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.reset">По умолчанию</button>
              </div>
              <div class="tags-input-box" id="pregnantTagsWrapper">
                <input type="text" id="pregnantTagsInput" placeholder="Добавить тег (например: pregnant, pregnancy)..." data-i18n-placeholder="settings.pregnant.placeholder" spellcheck="false">
              </div>
            </div>

            <!-- 5. LGBT -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="lgbtTagsInput" data-i18n="settings.lgbtWords">Слова для «Скрыть ЛГБТ» (LGBT / Yaoi / Futanari):</label>
                <button type="button" class="btn-text" id="btnResetLgbtTags" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.reset">По умолчанию</button>
              </div>
              <div class="tags-input-box" id="lgbtTagsWrapper">
                <input type="text" id="lgbtTagsInput" placeholder="Добавить тег (например: yaoi, gay, futanari)..." data-i18n-placeholder="settings.lgbt.placeholder" spellcheck="false">
              </div>
            </div>
          </div>

          <!-- Card: Author and Tag Aliases -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                <span data-i18n="settings.authorAliasesTitle">Алиасы авторов и тегов</span>
              </h4>
              <p class="settings-card-hint">Связывание авторов между разными сайтами и автообнаружение синонимов.</p>
            </div>

            <!-- Toggle: Enable Alias Discovery -->
            <div class="settings-group">
              <label class="toggle-row" title="Автоматически искать синонимы авторов в Danbooru и связывать авторов по совпадающим источникам" data-i18n-title="settings.enableAliasDiscovery.title">
                <input type="checkbox" id="checkEnableAliasDiscovery" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.enableAliasDiscovery">Автообнаружение алиасов</span>
              </label>
              <p class="settings-hint" style="margin-top: 4px;" data-i18n="settings.enableAliasDiscoveryHint">Автоматически находит другие ники автора в каталоге Danbooru и сопоставляет авторов по одинаковым ссылкам на арты.</p>
            </div>

            <!-- Ignored/Banned Aliases -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="ignoredAliasesInput" data-i18n="settings.ignoredAliasesLabel">Запрещённые алиасы (чёрный список):</label>
                <button type="button" class="btn-text" id="btnResetIgnoredAliases" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.clear">Очистить</button>
              </div>
              <p class="settings-hint" data-i18n="settings.ignoredAliasesHint">Теги и имена, которые запрещено связывать или автоматически регистрировать как синонимы.</p>
              <div class="tags-input-box" id="ignoredAliasesWrapper">
                <input type="text" id="ignoredAliasesInput" placeholder="Добавить запрещенный тег (например: tagme, various_artists)..." data-i18n-placeholder="settings.ignoredAliases.placeholder" spellcheck="false">
              </div>
            </div>

            <!-- Custom Cross-Site Aliases -->
            <div class="settings-group">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <label class="settings-label" for="customAliasesInput" data-i18n="settings.authorAliasesLabel">Пользовательские соответствия (межсайтовые синонимы):</label>
                <button type="button" class="btn-text" id="btnResetCustomAliases" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none;" data-i18n="settings.clear">Очистить</button>
              </div>
              <p class="settings-hint" data-i18n="settings.authorAliasesHint">Форматирует теги под движки сайтов. Формат: ник = danbooru:ник1, rule34:ник2 или ник1 = ник2.</p>
              <textarea id="customAliasesInput" class="input-setting" style="width: 100%; min-height: 80px; font-family: monospace; font-size: 12px; line-height: 1.4; resize: vertical;" placeholder="# Пример:&#10;redrainsfm = danbooru:redrain3d, rule34:redrainsfm&#10;csr = cutesexyrobutts" spellcheck="false"></textarea>
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 11px; color: var(--text-muted);">
                <span><span data-i18n="settings.discoveredAliasesCount">Обнаружено автоматически:</span> <strong id="discoveredAliasesCountText" style="color: var(--text-primary);">0</strong></span>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <button type="button" class="btn-text" id="btnManageDiscoveredAliases" style="font-size: 11px; color: var(--accent-primary); cursor: pointer; background: none; border: none; font-weight: 500;" data-i18n="settings.manageDiscoveredBtn">Редактировать список...</button>
                  <button type="button" class="btn-text" id="btnClearDiscoveredAliases" style="font-size: 11px; color: var(--text-muted); cursor: pointer; background: none; border: none;" data-i18n="settings.clearDiscoveredBtn">Очистить кэш автопоиска</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. TAB: PROXY & NETWORK -->
        <div class="settings-tab-pane" id="tabPane-proxy" style="display: none;">
          <!-- Card: Media Routing (Global Toggles) -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg>
                <span data-i18n="settings.cardMediaRouting">Маршрутизация медиа (Кэш и CDN)</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.proxyMainHint">Отключайте проксирование для прямой загрузки с CDN. Если CDN борды блокирует доступ, приложение автоматически подключит резервный прокси (Fallback).</p>
            </div>

            <div class="toggles-list">
              <label class="toggle-row" id="rowProxyThumbnails" title="Загружать превью и миниатюры через серверный прокси с сохранением в локальный дисковый кэш" data-i18n-title="settings.proxyThumbs.title">
                <input type="checkbox" id="checkProxyThumbnails" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.proxyThumbs">Проксировать превью в ленте (кэширование на сервере)</span>
              </label>
              <div id="proxyThumbnailsVercelNotice" style="display: none; font-size: 11px; color: var(--text-muted); margin: -4px 0 6px 36px; line-height: 1.3;">
                <span data-i18n="settings.proxyNotice">Прокси превью недоступен на Live Demo (для экономии Fast Origin Transfer)</span>
              </div>
              <label class="toggle-row" id="rowProxyFullImages" title="Загружать полноразмерные оригиналы артов через серверный прокси в просмотрщике" data-i18n-title="settings.proxyFull.title">
                <input type="checkbox" id="checkProxyFullImages" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.proxyFull">Проксировать полноразмерные изображения (просмотрщик)</span>
              </label>
              <div id="proxyFullImagesVercelNotice" style="display: none; font-size: 11px; color: var(--text-muted); margin: -4px 0 6px 36px; line-height: 1.3;">
                <span data-i18n="settings.proxyFullNotice">Прокси изображений недоступен на Live Demo (для экономии Fast Origin Transfer)</span>
              </div>
              <label class="toggle-row" id="rowProxyVideos" title="Загружать видеопотоки через локальный прокси для мгновенного запуска и обхода CDN-ограничений" data-i18n-title="settings.proxyVideos.title">
                <input type="checkbox" id="checkProxyVideos" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.proxyVideos">Проксировать видеопотоки (лента и полноэкранный плеер)</span>
              </label>
              <div id="proxyVideosVercelNotice" style="display: none; font-size: 11px; color: var(--text-muted); margin: -4px 0 6px 36px; line-height: 1.3;">
                <span data-i18n="settings.proxyVideosNotice">Прокси видео недоступен на Live Demo (для экономии Fast Origin Transfer)</span>
              </div>
              <label class="toggle-row" id="rowProxyDownloads" title="Скачивать файлы через серверный прокси для гарантированного сохранения с оригинальным именем" data-i18n-title="settings.proxyDownloads.title">
                <input type="checkbox" id="checkProxyDownloads" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-name" data-i18n="settings.proxyDownloads">Проксировать скачивание файлов на устройство</span>
              </label>
              <div id="proxyDownloadsVercelNotice" style="display: none; font-size: 11px; color: var(--text-muted); margin: -4px 0 6px 36px; line-height: 1.3;">
                <span data-i18n="settings.proxyDownloadsNotice">Прокси скачивания недоступен на Live Demo (для экономии Fast Origin Transfer)</span>
              </div>
            </div>
          </div>

          <!-- Card: Per-Source Media Proxy Routing (NEW FEATURE) -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>
                <span data-i18n="settings.cardPerSourceProxy">Выбор проксирования для каждого источника</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.perSourceProxyHint">
                Настройте индивидуальный режим для каждого источника: «Через сервер» (для кэширования и обхода блокировок), «Напрямую» (для максимальной скорости без нагрузки на сервер) или «По умолчанию» (по общим переключателям выше).
              </p>
            </div>

            <!-- Interactive list rendered by settingsModal.js -->
            <div class="site-proxy-list" id="siteMediaProxyList"></div>
          </div>

          <!-- Card: Upstream HTTP / SOCKS5 Proxies -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <span data-i18n="settings.cardUpstreamProxy">Серверные HTTP / HTTPS / SOCKS5 прокси для сайтов</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.proxyServersHint">Укажите прокси (например <code>http://127.0.0.1:8080</code> или <code>socks5://127.0.0.1:1080</code>) под сайты для обхода блокировок со стороны хостинга.</p>
            </div>

            <!-- Global Fallback Proxy -->
            <div class="api-key-card" style="margin-top: 4px;">
              <div class="api-key-card-header">
                <span class="api-key-site-badge site-global" data-i18n="settings.proxyGlobalBadge">🌐 Общий прокси (Fallback)</span>
                <span class="api-key-card-actions">
                  <button type="button" class="api-key-test-btn" id="btnTestGlobalProxy" title="Проверить общий прокси">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span data-i18n="settings.authTest">Тест</span>
                  </button>
                </span>
              </div>
              <div>
                <input type="text" id="inputGlobalProxy" class="input-setting" placeholder="http://127.0.0.1:8080 или socks5://127.0.0.1:1080" autocomplete="off" spellcheck="false" data-i18n-placeholder="settings.proxyGlobalPlaceholder">
              </div>
            </div>

            <!-- Site Specific Upstream Proxy Selector -->
            <div class="upstream-proxy-card" style="margin-top: 6px;">
              <div class="upstream-site-picker-row">
                <label class="settings-label" for="selectUpstreamProxySite" data-i18n="settings.selectUpstreamSite">Индивидуальный прокси для сайта:</label>
                <select id="selectUpstreamProxySite" class="input-setting" style="min-width: 200px;">
                  <option value="danbooru">Danbooru</option>
                  <option value="gelbooru">Gelbooru</option>
                  <option value="rule34">Rule34.xxx</option>
                  <option value="yandere">Yande.re</option>
                  <option value="konachan">Konachan</option>
                  <option value="safebooru">Safebooru</option>
                  <option value="rule34video">Rule34Video</option>
                  <option value="pawchive">Pawchive</option>
                  <option value="kemono">Kemono</option>
                  <option value="xbooru">Xbooru</option>
                  <option value="hypnohub">Hypnohub</option>
                  <option value="tbib">TBIB</option>
                </select>
              </div>

              <!-- Dedicated inputs & test buttons for each site -->
              <div id="upstreamSiteProxyEditors" style="margin-top: 6px;">
                <!-- 1. Danbooru -->
                <div class="upstream-site-editor-row" data-upstream-site="danbooru">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputDanbooruProxy" class="input-setting" placeholder="Прокси для Danbooru (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestDanbooruProxy" title="Проверить прокси Danbooru">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 2. Gelbooru -->
                <div class="upstream-site-editor-row" data-upstream-site="gelbooru" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputGelbooruProxy" class="input-setting" placeholder="Прокси для Gelbooru (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestGelbooruProxy" title="Проверить прокси Gelbooru">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 3. Rule34 -->
                <div class="upstream-site-editor-row" data-upstream-site="rule34" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputRule34Proxy" class="input-setting" placeholder="Прокси для Rule34 (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestRule34Proxy" title="Проверить прокси Rule34">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 4. Yandere -->
                <div class="upstream-site-editor-row" data-upstream-site="yandere" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputYandereProxy" class="input-setting" placeholder="Прокси для Yande.re (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestYandereProxy" title="Проверить прокси Yande.re">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 5. Konachan -->
                <div class="upstream-site-editor-row" data-upstream-site="konachan" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputKonachanProxy" class="input-setting" placeholder="Прокси для Konachan (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestKonachanProxy" title="Проверить прокси Konachan">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 6. Safebooru -->
                <div class="upstream-site-editor-row" data-upstream-site="safebooru" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputSafebooruProxy" class="input-setting" placeholder="Прокси для Safebooru (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestSafebooruProxy" title="Проверить прокси Safebooru">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 7. Rule34video -->
                <div class="upstream-site-editor-row" data-upstream-site="rule34video" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputRule34videoProxy" class="input-setting" placeholder="Прокси для Rule34Video (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestRule34videoProxy" title="Проверить прокси Rule34Video">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 8. Pawchive -->
                <div class="upstream-site-editor-row" data-upstream-site="pawchive" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputPawchiveProxy" class="input-setting" placeholder="Прокси для Pawchive (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestPawchiveProxy" title="Проверить прокси Pawchive">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 9. Kemono -->
                <div class="upstream-site-editor-row" data-upstream-site="kemono" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputKemonoProxy" class="input-setting" placeholder="Прокси для Kemono (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestKemonoProxy" title="Проверить прокси Kemono">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 10. Xbooru -->
                <div class="upstream-site-editor-row" data-upstream-site="xbooru" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputXbooruProxy" class="input-setting" placeholder="Прокси для Xbooru (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestXbooruProxy" title="Проверить прокси Xbooru">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 11. Hypnohub -->
                <div class="upstream-site-editor-row" data-upstream-site="hypnohub" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputHypnohubProxy" class="input-setting" placeholder="Прокси для Hypnohub (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestHypnohubProxy" title="Проверить прокси Hypnohub">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>

                <!-- 12. TBIB -->
                <div class="upstream-site-editor-row" data-upstream-site="tbib" style="display: none;">
                  <div class="upstream-site-editor">
                    <input type="text" id="inputTbibProxy" class="input-setting" placeholder="Прокси для TBIB (http://... или socks5://...)" autocomplete="off" spellcheck="false">
                    <button type="button" class="api-key-test-btn" id="btnTestTbibProxy" title="Проверить прокси TBIB">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 5. TAB: API KEYS -->
        <div class="settings-tab-pane" id="tabPane-apikeys" style="display: none;">
          <!-- Card: Personal API keys -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                <span data-i18n="settings.apiKeys">Персональные API Ключи (Booru)</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.apiKeysHint">Необязательно. Бесплатные ключи снимают ограничения поиска, повышают лимиты и ускоряют выдачу.</p>
            </div>

            <div class="api-keys-container">
              <!-- 1. Rule34.xxx -->
              <div class="api-key-card">
                <div class="api-key-card-header">
                  <span class="api-key-site-badge site-r34">Rule34.xxx</span>
                  <span class="api-key-card-actions">
                    <button type="button" class="api-key-test-btn" id="btnTestRule34Auth" title="Проверить авторизацию">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                    <a href="https://rule34.xxx/index.php?page=account&s=home" target="_blank" rel="noopener" class="api-key-link" title="Получить ключ в профиле Rule34" data-i18n="settings.whereGet">Где взять? ↗</a>
                  </span>
                </div>
                <div class="api-keys-grid">
                  <input type="text" id="inputRule34ApiKey" class="input-setting" placeholder="Rule34 API Key" autocomplete="off" spellcheck="false">
                  <input type="text" id="inputRule34UserId" class="input-setting" placeholder="Rule34 User ID" autocomplete="off" spellcheck="false">
                </div>
              </div>

              <!-- 2. Gelbooru -->
              <div class="api-key-card">
                <div class="api-key-card-header">
                  <span class="api-key-site-badge site-gelbooru">Gelbooru.com</span>
                  <span class="api-key-card-actions">
                    <button type="button" class="api-key-test-btn" id="btnTestGelbooruAuth" title="Проверить авторизацию">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                    <a href="https://gelbooru.com/index.php?page=account&s=options" target="_blank" rel="noopener" class="api-key-link" title="Получить ключ в настройках Gelbooru" data-i18n="settings.whereGet">Где взять? ↗</a>
                  </span>
                </div>
                <div class="api-keys-grid">
                  <input type="text" id="inputGelbooruApiKey" class="input-setting" placeholder="Gelbooru API Key" autocomplete="off" spellcheck="false">
                  <input type="text" id="inputGelbooruUserId" class="input-setting" placeholder="Gelbooru User ID" autocomplete="off" spellcheck="false">
                </div>
              </div>

              <!-- 3. Danbooru -->
              <div class="api-key-card">
                <div class="api-key-card-header">
                  <span class="api-key-site-badge site-danbooru">Danbooru</span>
                  <span class="api-key-card-actions">
                    <button type="button" class="api-key-test-btn" id="btnTestDanbooruAuth" title="Проверить авторизацию">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                    <a href="https://danbooru.donmai.us/profile" target="_blank" rel="noopener" class="api-key-link" title="Получить API Key в профиле Danbooru" data-i18n="settings.whereGet">Где взять? ↗</a>
                  </span>
                </div>
                <div class="api-keys-grid">
                  <input type="text" id="inputDanbooruApiKey" class="input-setting" placeholder="Danbooru API Key" autocomplete="off" spellcheck="false">
                  <input type="text" id="inputDanbooruLogin" class="input-setting" placeholder="Danbooru Username (Логин)" autocomplete="off" spellcheck="false">
                </div>
              </div>

              <!-- 4. Konachan -->
              <div class="api-key-card">
                <div class="api-key-card-header">
                  <span class="api-key-site-badge site-konachan">Konachan.com</span>
                  <span class="api-key-card-actions">
                    <button type="button" class="api-key-test-btn" id="btnTestKonachanAuth" title="Проверить авторизацию">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                    <a href="https://konachan.com/login" target="_blank" rel="noopener" class="api-key-link" title="Логин или регистрация на Konachan" data-i18n="settings.whereGet">Где взять? ↗</a>
                  </span>
                </div>
                <div class="api-keys-grid">
                  <input type="text" id="inputKonachanLogin" class="input-setting" placeholder="Konachan логин" autocomplete="off" spellcheck="false" data-i18n-placeholder="settings.konachanLogin.placeholder">
                  <input type="text" id="inputKonachanPassword" class="input-setting" placeholder="Konachan пароль" autocomplete="off" spellcheck="false" data-i18n-placeholder="settings.konachanPassword.placeholder">
                </div>
              </div>

              <!-- 5. Yande.re -->
              <div class="api-key-card">
                <div class="api-key-card-header">
                  <span class="api-key-site-badge site-yandere">Yande.re</span>
                  <span class="api-key-card-actions">
                    <button type="button" class="api-key-test-btn" id="btnTestYandereAuth" title="Проверить авторизацию">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                    <a href="https://yande.re/login" target="_blank" rel="noopener" class="api-key-link" title="Логин или регистрация на Yande.re" data-i18n="settings.whereGet">Где взять? ↗</a>
                  </span>
                </div>
                <div class="api-keys-grid">
                  <input type="text" id="inputYandereLogin" class="input-setting" placeholder="Yande.re логин" autocomplete="off" spellcheck="false" data-i18n-placeholder="settings.yandereLogin.placeholder">
                  <input type="text" id="inputYanderePassword" class="input-setting" placeholder="Yande.re пароль" autocomplete="off" spellcheck="false" data-i18n-placeholder="settings.yanderePassword.placeholder">
                </div>
              </div>

              <!-- 6. Pawchive -->
              <div class="api-key-card">
                <div class="api-key-card-header">
                  <span class="api-key-site-badge site-pawchive">Pawchive.pw</span>
                  <span class="api-key-card-actions">
                    <button type="button" class="api-key-test-btn" id="btnTestPawchiveAuth" title="Проверить авторизацию">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                    <a href="https://pawchive.pw/" target="_blank" rel="noopener" class="api-key-link" title="Открыть Pawchive" data-i18n="settings.whereGet">Где взять? ↗</a>
                  </span>
                </div>
                <div class="api-keys-grid api-keys-grid-single">
                  <input type="text" id="inputPawchiveSession" class="input-setting" placeholder="Pawchive Session Token (cookie: session=...)" autocomplete="off" spellcheck="false" data-i18n-placeholder="settings.pawchiveSession.placeholder">
                </div>
              </div>

              <!-- 7. Kemono -->
              <div class="api-key-card">
                <div class="api-key-card-header">
                  <span class="api-key-site-badge site-kemono">Kemono.cr</span>
                  <span class="api-key-card-actions">
                    <button type="button" class="api-key-test-btn" id="btnTestKemonoAuth" title="Проверить авторизацию">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span data-i18n="settings.authTest">Тест</span>
                    </button>
                    <a href="https://kemono.cr/" target="_blank" rel="noopener" class="api-key-link" title="Открыть Kemono" data-i18n="settings.whereGet">Где взять? ↗</a>
                  </span>
                </div>
                <div class="api-keys-grid api-keys-grid-single">
                  <input type="text" id="inputKemonoSession" class="input-setting" placeholder="Kemono Session Token (cookie: session=...)" autocomplete="off" spellcheck="false" data-i18n-placeholder="settings.kemonoSession.placeholder">
                </div>
              </div>
            </div>
          </div>

          <!-- Card: External Sync Action -->
          <div class="settings-section-card">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                <span data-i18n="settings.syncExternalHeading">Синхронизация сохранённых данных</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.syncExternalHint">Отправить все ранее поставленные лайки, закладки и подписки на авторов в ваши аккаунты Danbooru и Pawchive.</p>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <button type="button" class="btn-primary" id="btnSyncExternalAll" style="padding: 8px 16px; font-size: 12.5px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span data-i18n="settings.syncExternalBtn">Выгрузить всё в аккаунты</span>
              </button>
              <div id="syncExternalStatusText" style="font-size: 12px; color: var(--accent-primary); display: none;"></div>
            </div>
          </div>
        </div>

        <!-- 6. TAB: STORAGE & BACKUP -->
        <div class="settings-tab-pane" id="tabPane-storage" style="display: none;">
          <!-- Card: Local Device Storage and Cache -->
          <div class="settings-section-card storage-settings-group">
            <div class="storage-header-row">
              <div>
                <h4 class="settings-card-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  <span data-i18n="settings.storageHeading">Кэш и память устройства</span>
                </h4>
                <p class="settings-card-hint" data-i18n="settings.storageHint">Закэшированные медиа-файлы и запросы для мгновенной работы офлайн/онлайн.</p>
              </div>
              <button type="button" class="btn-refresh-storage" id="btnRefreshStorage" title="Обновить расчет памяти" data-i18n-title="settings.refreshStorage">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
              </button>
            </div>
            
            <div class="storage-card">
              <div class="storage-info-row">
                <div class="storage-stat">
                  <span class="storage-stat-label" data-i18n="settings.usedOnDevice">Занято на устройстве:</span>
                  <span class="storage-stat-value" id="storageUsageText">0.0 МБ</span>
                </div>
                <div class="storage-stat text-right">
                  <span class="storage-stat-label" data-i18n="settings.quotaAvailable">Доступная квота:</span>
                  <span class="storage-stat-quota" id="storageQuotaText">-- ГБ</span>
                </div>
              </div>
              
              <div class="storage-progress-track">
                <div class="storage-progress-bar" id="storageProgressBar" style="width: 0%;"></div>
              </div>
              
              <div class="storage-breakdown" id="storageBreakdown">
                <div class="storage-breakdown-item">
                  <span class="storage-dot dot-cache"></span>
                  <span class="storage-breakdown-label" data-i18n="settings.mediaCache">Кэш PWA / Медиа:</span>
                  <span class="storage-breakdown-val" id="storageMediaCacheText">0.0 МБ</span>
                </div>
                <div class="storage-breakdown-item">
                  <span class="storage-dot dot-server"></span>
                  <span class="storage-breakdown-label" data-i18n="settings.serverCache">Серверный кэш:</span>
                  <span class="storage-breakdown-val" id="storageServerCacheText">0.0 МБ</span>
                </div>
              </div>

              <!-- Server disk cache limit setting -->
              <div class="storage-limit-control" style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border-color);">
                <div class="settings-sublabel-row" style="margin-bottom: 6px;">
                  <label class="settings-sublabel" for="selectMaxServerCache" style="font-weight: 600;" data-i18n="settings.cacheLimit">Лимит дискового кэша на сервере:</label>
                  <span class="storage-limit-badge" id="storageLimitBadge" style="font-size: 11px; color: var(--accent-primary);">1.5 ГБ</span>
                </div>
                <select id="selectMaxServerCache" class="settings-select" style="width: 100%;">
                  <option value="250" data-i18n="settings.cache250">250 МБ (Минимальный)</option>
                  <option value="500" data-i18n="settings.cache500">500 МБ</option>
                  <option value="1000" data-i18n="settings.cache1000">1 ГБ</option>
                  <option value="1500" selected data-i18n="settings.cache1500">1.5 ГБ (Рекомендуется)</option>
                  <option value="2000" data-i18n="settings.cache2000">2 ГБ</option>
                  <option value="5000" data-i18n="settings.cache5000">5 ГБ (Просторный)</option>
                  <option value="10000" data-i18n="settings.cache10000">10 ГБ</option>
                  <option value="0" data-i18n="settings.cacheUnlimited">Без ограничений</option>
                </select>
                <p class="settings-hint" style="margin-top: 6px; font-size: 11.5px; opacity: 0.8;" data-i18n="settings.cacheLimitHint">При превышении лимита сервер автоматически очищает старые превью и видео (LRU автоочистка).</p>
              </div>

              <div class="storage-actions-row">
                <button type="button" class="btn-clean-cache" id="btnClearStorageBtn">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  <span data-i18n="settings.clearMediaCache">Очистить кэш медиа</span>
                </button>
                <span id="storageClearStatus" class="storage-clear-status"></span>
              </div>
            </div>
          </div>

          <!-- Card: Backup and Data Migration -->
          <div class="settings-section-card backup-settings-group">
            <div class="settings-card-header">
              <h4 class="settings-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                <span data-i18n="settings.backupHeading">Резервное копирование и перенос данных</span>
              </h4>
              <p class="settings-card-hint" data-i18n="settings.backupHint">Выгрузите свои настройки, слова типажей, API-ключи, закладки, лайки и список любимых авторов в файл или перенесите на другое устройство.</p>
            </div>
            
            <div class="backup-actions-grid">
              <button type="button" class="btn-backup btn-export" id="btnExportData">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span data-i18n="settings.exportJson">Экспорт в файл (JSON)</span>
              </button>

              <button type="button" class="btn-backup btn-import" id="btnImportData">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span data-i18n="settings.importFile">Импорт из файла</span>
              </button>
              <input type="file" id="inputImportFile" accept=".json" style="display: none;">
            </div>
          </div>

          <!-- Card: Telegram Auto-Backup -->
          <div class="settings-section-card telegram-backup-group">
            <div class="settings-group-header-row">
              <label class="settings-label" for="checkTelegramBackupEnabled">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tg-icon-svg">
                  <path d="M21.5 2L2 9.5l7 3.5 3.5 7L21.5 2z"/>
                  <path d="M9 13l5.5-5.5"/>
                </svg>
                <span data-i18n="settings.telegramHeading">Автобэкап в Telegram</span>
              </label>
              <label class="toggle-switch">
                <input type="checkbox" id="checkTelegramBackupEnabled">
                <span class="toggle-slider"></span>
              </label>
            </div>
            <p class="settings-hint">
              Сервер будет автоматически отправлять резервную копию со всеми вашими закладками, лайками, авторами и настройками в личные сообщения Telegram.
            </p>

            <div class="telegram-backup-form" id="telegramBackupForm">
              <div class="settings-input-row">
                <div class="settings-sublabel-row">
                  <label class="settings-sublabel" for="inputTelegramBotToken" data-i18n="settings.tgToken">Токен бота (Bot Token):</label>
                  <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" class="tg-helper-link" data-i18n="settings.tgGetBotFather">Получить в @BotFather ↗</a>
                </div>
                <input type="text" id="inputTelegramBotToken" class="settings-input" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..." autocomplete="off">
              </div>

              <div class="settings-input-row">
                <div class="settings-sublabel-row">
                  <label class="settings-sublabel" for="inputTelegramChatId" data-i18n="settings.tgChatId">ID чата (Chat ID):</label>
                  <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" class="tg-helper-link" data-i18n="settings.tgGetUserId">Узнать в @userinfobot ↗</a>
                </div>
                <input type="text" id="inputTelegramChatId" class="settings-input" placeholder="Например: 123456789" autocomplete="off">
              </div>

              <div class="settings-input-row">
                <label class="settings-sublabel" for="selectTelegramBackupInterval" data-i18n="settings.tgInterval">Периодичность автобэкапа:</label>
                <select id="selectTelegramBackupInterval" class="settings-select">
                  <option value="daily" data-i18n="settings.tgDaily">Каждые 24 часа (Раз в сутки)</option>
                  <option value="every_3_days" data-i18n="settings.tg3days">Каждые 3 дня</option>
                  <option value="weekly" data-i18n="settings.tgWeekly">Раз в неделю (Каждые 7 дней)</option>
                </select>
              </div>

              <div class="telegram-backup-status-bar" id="telegramBackupStatusBar">
                <span class="tg-status-dot" id="telegramStatusDot"></span>
                <span class="tg-status-text" id="telegramStatusText" data-i18n="settings.tgLastBackup">Последний бэкап: нет данных</span>
              </div>

              <div class="telegram-actions-grid">
                <button type="button" class="btn-backup btn-tg-test" id="btnTestTelegram">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <span data-i18n="settings.tgTest">Проверить связь</span>
                </button>

                <button type="button" class="btn-backup btn-tg-send" id="btnSendTelegramBackup">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                  <span data-i18n="settings.tgSendNow">Отправить бэкап сейчас</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button class="btn-secondary" id="btnResetSettings" data-i18n="settings.resetAll">Сбросить по умолчанию</button>
        <button class="btn-primary" id="btnSaveSettings" data-i18n="modal.save">Сохранить</button>
      </div>
    </div>
  </div>
`;

export function ensureSettingsMarkup() {
  if (document.getElementById('settingsModal')) return;
  document.body.insertAdjacentHTML('beforeend', MARKUP);
  applyStaticTranslations(document);
}
