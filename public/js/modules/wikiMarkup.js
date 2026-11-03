// Markup for the modalWikiBackdrop dialog, injected on first use of the owning module.
// Kept out of index.html so the initial shell stays small; data-i18n
// attributes are translated right after injection.
import { applyStaticTranslations } from '../i18n.js';

const MARKUP = `
  <!-- Wiki and Search Guide Modal -->
  <div class="modal-backdrop" id="modalWikiBackdrop" style="display: none;">
    <div class="modal-dialog modal-dialog-lg modal-dialog-wiki" role="dialog" aria-modal="true" aria-label="Справка и Wiki по поиску">
      <div class="modal-header wiki-modal-header">
        <div class="modal-title-wrap">
          <h3 class="modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color: var(--accent);"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/><path d="M6 14h6"/></svg>
            <span data-i18n="wiki.title">Справка и Wiki по поиску</span>
          </h3>
          <span class="modal-subtitle" data-i18n="wiki.subtitle">Руководство по синтаксису тегов, особенностям каждого источника и горячим клавишам</span>
        </div>
        <button class="btn-icon btn-modal-close" id="btnCloseWikiModal" title="Закрыть" data-i18n-title="modal.close.title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Wiki Search Toolbar -->
      <div class="wiki-search-toolbar">
        <div class="wiki-search-box">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="wikiSearchInput" class="wiki-search-input" placeholder="Поиск по статьям и тегам Wiki..." data-i18n-placeholder="wiki.search.placeholder" autocomplete="off" spellcheck="false">
          <button class="btn-clear-wiki-search" id="btnClearWikiSearch" title="Очистить" style="display: none;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- Wiki Tab Navigation -->
      <div class="wiki-tabs-bar">
        <button type="button" class="wiki-tab-btn active" data-tab="tag-basics">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          <span data-i18n="wiki.tab.basics">Основы тегов</span>
        </button>
        <button type="button" class="wiki-tab-btn" data-tab="sources">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span data-i18n="wiki.tab.sources">Гид по источникам</span>
        </button>
        <button type="button" class="wiki-tab-btn" data-tab="filters">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span data-i18n="wiki.tab.filters">Мультипоиск и фильтры</span>
        </button>
        <button type="button" class="wiki-tab-btn" data-tab="hotkeys">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg>
          <span data-i18n="wiki.tab.hotkeys">Горячие клавиши</span>
        </button>
      </div>

      <div class="modal-body wiki-modal-body">
        <!-- 1. TAB: TAG BASICS -->
        <div class="wiki-tab-pane" id="wikiPane-tag-basics">
          <div class="wiki-grid">
            <!-- Card 1: Tag Structure -->
            <div class="wiki-card">
              <div class="wiki-card-header">
                <div class="wiki-card-icon icon-blue">🏷️</div>
                <div>
                  <h4 class="wiki-card-title" data-i18n="wiki.basics.syntaxTitle">Синтаксис и пробелы</h4>
                  <span class="wiki-card-category" data-i18n="wiki.basics.syntaxCategory">Главное правило Booru</span>
                </div>
              </div>
              <div class="wiki-card-body">
                <p data-i18n="wiki.basics.syntaxDesc">В Booru-системах понятия из нескольких слов всегда соединяются <strong>подчеркиванием <code>_</code></strong>. Пробел между словами означает логическое <strong>«И» (AND)</strong>: то есть на картинке должны присутствовать оба признака.</p>
                <div class="wiki-example-box">
                  <div class="wiki-example-row">
                    <span class="wiki-tag-example" data-tag="hatsune_miku">hatsune_miku</span>
                    <span class="wiki-example-desc" data-i18n="wiki.example.miku">Один тег (персонаж Hatsune Miku)</span>
                  </div>
                  <div class="wiki-example-row">
                    <span class="wiki-tag-example" data-tag="blue_eyes">blue_eyes</span>
                    <span class="wiki-example-desc" data-i18n="wiki.example.eyes">Один тег (голубые глаза)</span>
                  </div>
                  <div class="wiki-example-row">
                    <span class="wiki-example-combo">1girl blue_eyes solo</span>
                    <span class="wiki-example-desc" data-i18n="wiki.example.combo">Поиск артов, где есть все три тега</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Card 2: Negative Tags (Exclusion) -->
            <div class="wiki-card">
              <div class="wiki-card-header">
                <div class="wiki-card-icon icon-red">⛔</div>
                <div>
                  <h4 class="wiki-card-title" data-i18n="wiki.basics.negTitle">Исключение тегов (Минус)</h4>
                  <span class="wiki-card-category" data-i18n="wiki.basics.negCategory">Фильтрация лишнего</span>
                </div>
              </div>
              <div class="wiki-card-body">
                <p data-i18n="wiki.basics.negDesc">Чтобы скрыть из выдачи арты с определенными элементами, добавьте перед тегом знак <strong>минус (<code>-</code>)</strong>. Это работает во всех источниках и в мультипоиске.</p>
                <div class="wiki-example-box">
                  <div class="wiki-example-row">
                    <span class="wiki-tag-example tag-negative" data-tag="-furry">-furry</span>
                    <span class="wiki-example-desc" data-i18n="wiki.example.nofurry">Скрыть весь фурри-контент</span>
                  </div>
                  <div class="wiki-example-row">
                    <span class="wiki-tag-example tag-negative" data-tag="-comic">-comic</span>
                    <span class="wiki-example-desc" data-i18n="wiki.example.nocommic">Скрыть многостраничные комиксы</span>
                  </div>
                  <div class="wiki-example-row">
                    <span class="wiki-tag-example tag-negative" data-tag="-male">-male</span>
                    <span class="wiki-example-desc" data-i18n="wiki.example.nomale">Скрыть мужских персонажей</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Card 3: Tag Categories -->
            <div class="wiki-card full-width">
              <div class="wiki-card-header">
                <div class="wiki-card-icon icon-purple">🎨</div>
                <div>
                  <h4 class="wiki-card-title" data-i18n="wiki.basics.catsTitle">Категории тегов и префиксы</h4>
                  <span class="wiki-card-category" data-i18n="wiki.basics.catsCategory">Цветовая разметка и назначение</span>
                </div>
              </div>
              <div class="wiki-card-body">
                <p data-i18n="wiki.basics.catsDesc">В карточках артов и подсказках поиска теги разделены по 5 типам. Вы можете указывать явный префикс (например <code>artist:</code>) для точного поиска:</p>
                <div class="wiki-tags-categories-grid">
                  <div class="wiki-category-card cat-artist">
                    <div class="wiki-category-header">
                      <span class="wiki-cat-badge badge-artist" data-i18n="wiki.cat.artist">Художник (Artist)</span>
                    </div>
                    <p data-i18n="wiki.cat.artistDesc">Имя или никнейм автора иллюстрации.</p>
                    <div class="wiki-tag-chips">
                      <span class="wiki-tag-example" data-tag="artist:ciloru">artist:ciloru</span>
                      <span class="wiki-tag-example" data-tag="artist:wlop">artist:wlop</span>
                      <span class="wiki-tag-example" data-tag="artist:sakimichan">artist:sakimichan</span>
                    </div>
                  </div>

                  <div class="wiki-category-card cat-character">
                    <div class="wiki-category-header">
                      <span class="wiki-cat-badge badge-character" data-i18n="wiki.cat.character">Персонаж (Character)</span>
                    </div>
                    <p data-i18n="wiki.cat.characterDesc">Имя изображенного героя или героини.</p>
                    <div class="wiki-tag-chips">
                      <span class="wiki-tag-example" data-tag="raiden_shogun">raiden_shogun</span>
                      <span class="wiki-tag-example" data-tag="2b_(nier:automata)">2b_(nier:automata)</span>
                      <span class="wiki-tag-example" data-tag="ishtar">ishtar</span>
                    </div>
                  </div>

                  <div class="wiki-category-card cat-copyright">
                    <div class="wiki-category-header">
                      <span class="wiki-cat-badge badge-copyright" data-i18n="wiki.cat.copyright">Франшиза (Copyright)</span>
                    </div>
                    <p data-i18n="wiki.cat.copyrightDesc">Игра, аниме, манга или вселенная произведения.</p>
                    <div class="wiki-tag-chips">
                      <span class="wiki-tag-example" data-tag="genshin_impact">genshin_impact</span>
                      <span class="wiki-tag-example" data-tag="fate/grand_order">fate/grand_order</span>
                      <span class="wiki-tag-example" data-tag="honkai:_star_rail">honkai:_star_rail</span>
                    </div>
                  </div>

                  <div class="wiki-category-card cat-general">
                    <div class="wiki-category-header">
                      <span class="wiki-cat-badge badge-general" data-i18n="wiki.cat.general">Общие (General)</span>
                    </div>
                    <p data-i18n="wiki.cat.generalDesc">Позы, одежда, эмоции, цвета, окружающая обстановка.</p>
                    <div class="wiki-tag-chips">
                      <span class="wiki-tag-example" data-tag="1girl">1girl</span>
                      <span class="wiki-tag-example" data-tag="solo">solo</span>
                      <span class="wiki-tag-example" data-tag="swimsuit">swimsuit</span>
                      <span class="wiki-tag-example" data-tag="looking_at_viewer">looking_at_viewer</span>
                    </div>
                  </div>

                  <div class="wiki-category-card cat-meta">
                    <div class="wiki-category-header">
                      <span class="wiki-cat-badge badge-meta" data-i18n="wiki.cat.meta">Мета (Meta)</span>
                    </div>
                    <p data-i18n="wiki.cat.metaDesc">Разрешение, качество файла, наличие перевода и анимации.</p>
                    <div class="wiki-tag-chips">
                      <span class="wiki-tag-example" data-tag="highres">highres</span>
                      <span class="wiki-tag-example" data-tag="absurdres">absurdres</span>
                      <span class="wiki-tag-example" data-tag="animated">animated</span>
                      <span class="wiki-tag-example" data-tag="translated">translated</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. TAB: SOURCES GUIDE -->
        <div class="wiki-tab-pane" id="wikiPane-sources" style="display: none;">
          <div class="wiki-sources-list">
            <!-- 1. Danbooru -->
            <div class="wiki-source-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-danbooru">Danbooru</span>
                  <h4 class="wiki-source-title">Danbooru (danbooru.donmai.us)</h4>
                </div>
                <button type="button" class="btn-wiki-switch-site" data-site="danbooru" data-i18n="wiki.switchSite">Искать здесь ↗</button>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.danbooru.desc">Самая эталонная и строго модерируемая аниме-база с глубоким каталогом тегов. Отличается высочайшей точностью тегирования.</p>
              <div class="wiki-source-details">
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.danbooru.limTitle">Лимит тегов:</strong>
                  <span data-i18n="wiki.danbooru.limDesc">Без ключа разрешено максимум <strong>2 тега</strong> на запрос. Добавьте свой бесплатный API-ключ в <a href="#settings" id="wikiOpenSettingsLink" class="wiki-inline-link">Настройках</a>, чтобы снять лимит.</span>
                </div>
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.danbooru.ratingsTitle">Рейтинги:</strong>
                  <span><code>rating:g</code> (безопасно / SFW), <code>rating:s</code> (пикантно / 16+), <code>rating:q</code> (фансервис), <code>rating:e</code> (18+).</span>
                </div>
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.danbooru.sortTitle">Сортировки:</strong>
                  <span><code>order:score</code> (по лайкам), <code>order:rank</code> (топ за день/неделю), <code>order:favcount</code> (по закладкам).</span>
                </div>
              </div>
            </div>

            <!-- 2. Gelbooru -->
            <div class="wiki-source-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-gelbooru">Gelbooru</span>
                  <h4 class="wiki-source-title">Gelbooru (gelbooru.com)</h4>
                </div>
                <button type="button" class="btn-wiki-switch-site" data-site="gelbooru" data-i18n="wiki.switchSite">Искать здесь ↗</button>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.gelbooru.desc">Огромный архив артов без жесткого лимита в 2 тега. Поддерживает поиск сложных комбинаций персонажей и авторов.</p>
              <div class="wiki-source-details">
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.gelbooru.ratingsTitle">Рейтинги:</strong>
                  <span><code>rating:general</code> (SFW), <code>rating:sensitive</code> (16+), <code>rating:questionable</code>, <code>rating:explicit</code> (18+).</span>
                </div>
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.gelbooru.sortTitle">Сортировки:</strong>
                  <span><code>sort:score:desc</code>, <code>sort:updated:desc</code>, <code>sort:random</code>.</span>
                </div>
              </div>
            </div>

            <!-- 3. Pawchive -->
            <div class="wiki-source-card highlight-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-pawchive">Pawchive</span>
                  <h4 class="wiki-source-title">Pawchive (Fanbox, Patreon, Fantia)</h4>
                </div>
                <button type="button" class="btn-wiki-switch-site" data-site="pawchive" data-i18n="wiki.switchSite">Искать здесь ↗</button>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.pawchive.desc">Архив платных подписок и фанартов с Pixiv Fanbox, Patreon, Fantia, Boosty и Gumroad. Поиск работает по именам авторов, сервисам и ключевым словам в названиях постов.</p>
              <div class="wiki-source-details">
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.pawchive.artistsTitle">Поиск авторов:</strong>
                  <span><code>artist:wlop</code>, <code>author:sakimichan</code>, <code>artist:gemba</code> <em>(автоматический резолвинг среди 92 000+ создателей)</em>.</span>
                </div>
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.pawchive.servicesTitle">Поиск платформ:</strong>
                  <span><code>service:fanbox</code>, <code>service:patreon</code>, <code>service:fantia</code>, <code>service:boosty</code>, <code>service:gumroad</code>.</span>
                </div>
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.pawchive.albumsTitle">Вложения и альбомы:</strong>
                  <span data-i18n="wiki.pawchive.albumsDesc">Если у автора в одном посте несколько изображений или архив, при клике открывается просмотрщик с листанием всех файлов.</span>
                </div>
              </div>
            </div>

            <!-- 4. Kemono -->
            <div class="wiki-source-card highlight-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-kemono">Kemono</span>
                  <h4 class="wiki-source-title">Kemono (Patreon, Fanbox, Fantia, Boosty)</h4>
                </div>
                <button type="button" class="btn-wiki-switch-site" data-site="kemono" data-i18n="wiki.switchSite">Искать здесь ↗</button>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.kemono.desc">Архив платных подписок (Patreon, Fanbox, Fantia, Boosty, Gumroad, Discord). Поиск работает по именам создателей, сервисам и названиям постов.</p>
              <div class="wiki-source-details">
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.kemono.artistsTitle">Поиск авторов:</strong>
                  <span><code>artist:wlop</code>, <code>author:sakimichan</code>, <code>creator:gemba</code> <em>(автоматический поиск по базе создателей)</em>.</span>
                </div>
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.kemono.servicesTitle">Поиск платформ:</strong>
                  <span><code>service:patreon</code>, <code>service:fanbox</code>, <code>service:fantia</code>, <code>service:boosty</code>, <code>service:gumroad</code>.</span>
                </div>
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.kemono.albumsTitle">Вложения и альбомы:</strong>
                  <span data-i18n="wiki.kemono.albumsDesc">Для постов с несколькими файлами или архивами доступен полноэкранный просмотрщик альбома.</span>
                </div>
              </div>
            </div>

            <!-- 4. Rule34 & Rule34 Paheal -->
            <div class="wiki-source-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-rule34">Rule34</span>
                  <h4 class="wiki-source-title">Rule34.xxx & Paheal</h4>
                </div>
                <button type="button" class="btn-wiki-switch-site" data-site="rule34" data-i18n="wiki.switchSite">Искать здесь ↗</button>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.r34.desc">Крупнейшие 18+ архивы контента, комиксов и 2D/3D анимаций. Paheal работает быстро без ключей, а Rule34.xxx поддерживает полную базу тегов.</p>
              <div class="wiki-source-details">
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.r34.videoTitle">Видео и звук:</strong>
                  <span><code>video</code>, <code>sound</code>, <code>has_sound</code>, <code>animated</code>, <code>webm</code>, <code>mp4</code>.</span>
                </div>
              </div>
            </div>

            <!-- 5. Rule34Video -->
            <div class="wiki-source-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-rule34video">Rule34Video</span>
                  <h4 class="wiki-source-title">Rule34Video (rule34video.com)</h4>
                </div>
                <button type="button" class="btn-wiki-switch-site" data-site="rule34video" data-i18n="wiki.switchSite">Искать здесь ↗</button>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.r34v.desc">Видеохостинг 3D и 2D анимаций. Полноценная поддержка авторов, моделей, каналов и тегов.</p>
              <div class="wiki-source-details">
                <div class="wiki-source-feat">
                  <strong data-i18n="wiki.r34v.authorTitle">Поиск студий и авторов:</strong>
                  <span><code>artist:redmoap</code>, <code>channel:derpixon</code>, <code>artist:kasssm</code>.</span>
                </div>
              </div>
            </div>

            <!-- 6. Yande.re & Konachan -->
            <div class="wiki-source-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-yandere">Yande.re</span>
                  <span class="badge-site site-konachan">Konachan</span>
                  <h4 class="wiki-source-title">Yande.re & Konachan (Moebooru)</h4>
                </div>
                <button type="button" class="btn-wiki-switch-site" data-site="yandere" data-i18n="wiki.switchSite">Искать здесь ↗</button>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.moebooru.desc">Каталоги обоев и артов безупречного разрешения и качества (lossless/original). Поддерживают поиск по пулам и коллекциям (<code>pool:123</code>).</p>
            </div>

            <!-- 7. Safebooru, Xbooru, Hypnohub, TBIB -->
            <div class="wiki-source-card">
              <div class="wiki-source-header">
                <div class="wiki-source-title-row">
                  <span class="badge-site site-safebooru">Safebooru</span>
                  <span class="badge-site site-xbooru">Xbooru</span>
                  <span class="badge-site site-tbib">TBIB</span>
                  <h4 class="wiki-source-title">DAPI-источники (Safebooru, TBIB, Hypnohub, Xbooru)</h4>
                </div>
              </div>
              <p class="wiki-source-desc" data-i18n="wiki.dapi.desc"><strong>Safebooru</strong>: только чистый SFW контент. <strong>TBIB</strong>: гигантский агрегатор изображений (~19 млн постов). <strong>Hypnohub</strong> и <strong>Xbooru</strong>: тематические DAPI-каталоги с быстрой выдачей.</p>
            </div>
          </div>
        </div>

        <!-- 3. TAB: FILTERS & MULTI-SEARCH -->
        <div class="wiki-tab-pane" id="wikiPane-filters" style="display: none;">
          <div class="wiki-grid">
            <div class="wiki-card">
              <div class="wiki-card-header">
                <div class="wiki-card-icon icon-amber">⚡</div>
                <div>
                  <h4 class="wiki-card-title" data-i18n="wiki.multi.title">Мультипоиск («Все сайты» / «Пользовательские»)</h4>
                  <span class="wiki-card-category" data-i18n="wiki.multi.cat">Параллельный опрос и адаптация</span>
                </div>
              </div>
              <div class="wiki-card-body">
                <p data-i18n="wiki.multi.desc">В режиме «Все сайты» приложение параллельно отправляет запросы на все подключенные борды. Синтаксис тегов автоматически адаптируется под каждый движок (Danbooru, Moebooru, DAPI, Pawchive), а результаты перемешиваются методом Round-Robin для разнообразия ленты.</p>
              </div>
            </div>

            <div class="wiki-card">
              <div class="wiki-card-header">
                <div class="wiki-card-icon icon-purple">🤖</div>
                <div>
                  <h4 class="wiki-card-title" data-i18n="wiki.ai.title">Фильтр ИИ (No-AI)</h4>
                  <span class="wiki-card-category" data-i18n="wiki.ai.cat">Отсечение нейросетей</span>
                </div>
              </div>
              <div class="wiki-card-body">
                <p data-i18n="wiki.ai.desc">Фильтр «Без ИИ» проверяет каждый пост по базе из 80+ меток нейросетей (NovelAI, Stable Diffusion, Midjourney, AI Generated и др.) и показывает только авторский человеческий арт.</p>
              </div>
            </div>

            <div class="wiki-card">
              <div class="wiki-card-header">
                <div class="wiki-card-icon icon-green">🛡️</div>
                <div>
                  <h4 class="wiki-card-title" data-i18n="wiki.censor.title">Фильтры цензуры (Furry, Pregnant, LGBT)</h4>
                  <span class="wiki-card-category" data-i18n="wiki.censor.cat">Комфортная лента</span>
                </div>
              </div>
              <div class="wiki-card-body">
                <p data-i18n="wiki.censor.desc">В левом сайдбаре вы можете в один клик скрыть специфичные категории контента. Приложение автоматически фильтрует теги и глубоко добирает другие арты (Deep Fetch), чтобы лента всегда оставалась заполненной.</p>
              </div>
            </div>

            <div class="wiki-card">
              <div class="wiki-card-header">
                <div class="wiki-card-icon icon-pink">✨</div>
                <div>
                  <h4 class="wiki-card-title" data-i18n="wiki.rec.title">Рекомендации «Для вас»</h4>
                  <span class="wiki-card-category" data-i18n="wiki.rec.cat">Персональный ИИ-граф</span>
                </div>
              </div>
              <div class="wiki-card-body">
                <p data-i18n="wiki.rec.desc">На основе ваших лайков, закладок и любимых художников приложение строит персонализированный граф предпочтений и подбирает новые релевантные работы из всех источников.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. TAB: HOTKEYS -->
        <div class="wiki-tab-pane" id="wikiPane-hotkeys" style="display: none;">
          <div class="wiki-hotkeys-grid">
            <div class="wiki-hotkey-card">
              <div class="wiki-hotkey-keys"><kbd>←</kbd> <kbd>→</kbd></div>
              <div class="wiki-hotkey-info">
                <strong data-i18n="wiki.hk.nav">Предыдущий / Следующий пост</strong>
                <span data-i18n="wiki.hk.navDesc">Быстрое перелистывание работ в полноэкранном просмотрщике</span>
              </div>
            </div>

            <div class="wiki-hotkey-card">
              <div class="wiki-hotkey-keys"><kbd>L</kbd></div>
              <div class="wiki-hotkey-info">
                <strong data-i18n="wiki.hk.like">Поставить / снять лайк</strong>
                <span data-i18n="wiki.hk.likeDesc">Добавляет пост в профиль и обучает персональные рекомендации</span>
              </div>
            </div>

            <div class="wiki-hotkey-card">
              <div class="wiki-hotkey-keys"><kbd>B</kbd></div>
              <div class="wiki-hotkey-info">
                <strong data-i18n="wiki.hk.fav">Добавить в закладки</strong>
                <span data-i18n="wiki.hk.favDesc">Сохраняет пост в раздел «Избранное»</span>
              </div>
            </div>

            <div class="wiki-hotkey-card">
              <div class="wiki-hotkey-keys"><kbd>F</kbd></div>
              <div class="wiki-hotkey-info">
                <strong data-i18n="wiki.hk.fs">Полноэкранный режим</strong>
                <span data-i18n="wiki.hk.fsDesc">Разворачивает арт или видео на весь экран</span>
              </div>
            </div>

            <div class="wiki-hotkey-card">
              <div class="wiki-hotkey-keys"><kbd>S</kbd></div>
              <div class="wiki-hotkey-info">
                <strong data-i18n="wiki.hk.dl">Скачать медиафайл</strong>
                <span data-i18n="wiki.hk.dlDesc">Загружает изображение или видео в максимальном качестве</span>
              </div>
            </div>

            <div class="wiki-hotkey-card">
              <div class="wiki-hotkey-keys"><kbd>Esc</kbd></div>
              <div class="wiki-hotkey-info">
                <strong data-i18n="wiki.hk.esc">Закрыть окно</strong>
                <span data-i18n="wiki.hk.escDesc">Закрывает просмотрщик, справку Wiki или окно настроек</span>
              </div>
            </div>

            <div class="wiki-hotkey-card">
              <div class="wiki-hotkey-keys"><kbd>Enter</kbd></div>
              <div class="wiki-hotkey-info">
                <strong data-i18n="wiki.hk.enter">Применить поиск</strong>
                <span data-i18n="wiki.hk.enterDesc">Запуск поиска по введенным в поле тегам</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer wiki-modal-footer">
        <span class="wiki-footer-hint" data-i18n="wiki.footerHint">💡 Нажмите на любой тег-пример в справке, чтобы сразу добавить его в поиск</span>
        <button type="button" class="btn-primary" id="btnUnderstandWikiModal" data-i18n="modal.close">Понятно</button>
      </div>
    </div>
  </div>
`;

export function ensureWikiMarkup() {
  if (document.getElementById('modalWikiBackdrop')) return;
  document.body.insertAdjacentHTML('beforeend', MARKUP);
  applyStaticTranslations(document);
}
