# AI Bridge — статус релізів

## v5.11.103 (2026-10-09)
- app.js: стрілки гілок діалогу — бейдж ⑂ «Гілка i з n» з ◀ ▶ у шапці відповіді (ansBadges); forkRun тепер штампує forkFrom (id батька) + forkFromPeer; старі форки знаходяться за суфіксом " (fork)"; навігація з зацикленням; кеш списку діалогів від renderHistory (інвалідація в saveRun)
- crew.js + _worker.js: критерії прийняття завдань команди — дія set-criteria (POST /api/team/tasks/:id, лише queued/paused, perm task.create), клієнтський чек-лист з вердиктами ✓/✗/· (вердикт раннера → expectEvidence → не оцінено), інлайн-редактор «по одному в рядку»
- core.js (робота brain-агента, влито в реліз): токенізатор тримає дефіс між літерами — «бізнес-план», «well-known» один токен (тейлоринг UAX #29); дефіс біля цифр/тире — розрив як раніше; VERSION 5.11.103
- i18n.js: ключі branchNav/branchPrev/branchNext/branchOf, crewCrit* (uk+en); styles.css: .branchBadge/.branchArrow, .crew-crit
- tests/run_v511103_branch_arrows_tests.mjs (21/21) + tests/run_v511103_acceptance_criteria_tests.mjs (41/41)
- changelog-app.json: запис 5.11.103 (персистентність перевірено: md5 + git diff --stat)
- Інвентаризація файлів: 0 видалених; ZIP releases/AI_Bridge_v5.11.103.zip (443 файли, без .wrangler/ — вкладений scheduler-worker/.wrangler/ виключено вручну)
- Гейт: RELEASE READY 201/201 файлів, 5953 перевірки, ESLint чистий. Деплой preview+production; жива перевірка: /api/version → 5.11.103, живий app.js — branch-навігація, crew.js — критерії, core.js — VERSION 5.11.103
- Коміт 881a51f

## v5.11.102 (2026-10-06)
Фікс реакції Сергія «було 8 провайдерів, зараз 6, де Ядро»: v5.11.101 звузив пігулку netCount до API-only (X/6) — виглядало як зникнення Muse і Ядра.
- app.js: пігулка знову доступно/всього по ВСІХ провайдерах (X/8); Muse і Ядро (сервер звітує true) повернулися в лічильник
- Без змін (чесні): топ-статус «N API keys configured» лишився API-only; configuredIds в оцінках — API-only; список провайдерів і так показував усі 8 з бейджами «Асистент»/«Офлайн»
- tests/run_v511102_provider_count_tests.mjs: 16 перевірок (8 провайдерів, пігулка /8, список не фільтрує built-in, сервер звітує muse/core); honesty-тест оновлено під нову пігулку
- Інвентаризація файлів: 0 видалених між v5.11.101 і v5.11.102 (515/515)
- Гейт: RELEASE READY 198/198 файлів, 5887 перевірок, ESLint чистий. ZIP releases/AI_Bridge_v5.11.102.zip (443 файли, без .wrangler/)
- Деплой preview+production; жива перевірка коду: /api/version → 5.11.102, живий app.js містить нову пігулку X/8 і UI_VERSION 5.11.102, живий core.js — VERSION 5.11.102 і EXPORT_VERSION = VERSION
- Коміт 6a7db50

## v5.11.101 (2026-10-05)
Мердж «production honesty hotfix» іншого AI (AI_Bridge_v5_11_100_FINAL.zip, базувався на v5.11.99 — перенесено тільки 3 зміни на моє дерево v5.11.100).
- app.js: LOCAL_PROVIDER_IDS (muse/core) + apiProviderIds() — Muse і Ядро більше не рахуються як «налаштовані API-ключі» (4 місця: топ-статус, knownCount, пігулка netCount, configuredIds)
- app.js: детерміноване питання (математика, одиниці, дата, пам'ять…) відповідає локальне Ядро, навіть якщо лишено Auto/Agent/God без хмарного ключа (доповнює CORE_RESCUE v5.11.97, не дублює)
- app.js + i18n.js (en/uk/ru): саммарі активності каже «Зупинено — відповідь не отримано» після HTTP/провайдерних помилок замість безумовного «Готово»
- tests/run_v511100_production_honesty_tests.mjs: 8 перевірок трьох фіксів
- Критично: EXPORT_VERSION=VERSION збережено (їхній core.js мав старий хардкод 5.11.72 — не тягнув); core.js VERSION бампнуто вручну до 5.11.101 (sync-version його не чіпає); тест run_v51144 оновлено: pushPromptHistory 6→7 місць
- Гейт: RELEASE READY 197/197 файлів, 5867 перевірок, ESLint чистий. Деплой preview+production, /api/version → 5.11.101 на обох. Коміт 9153347

## v5.11.100 (2026-10-05)
Мердж аудиту іншого AI (AI_Bridge_v5_11_99_FINAL.zip): єдиний фікс — core.js модуль 34.
- core.js: `const EXPORT_VERSION = VERSION;` (було захардкоджено `"5.11.72"`) — JSON-експорт аналізу тепер несе поточну версію ядра
- tests/run_v511100_export_version_tests.mjs: новий регресійний тест (5 перевірок: версія експорту === C.VERSION, не хардкод, null-вхід, parseAnalysis round-trip)
- «Не зміг» аудитора закрито повністю: повний регресійний сьют (196/196, 5855 перевірок), ESLint gate чистий, Playwright без SKIP, release-check до кінця
- changelog-app.json: запис v5.11.100 трьома мовами (uk/en/ru)
- Гейт: RELEASE READY: 196/196 файлів, 5855 перевірок, ESLint чистий, browser tests not skipped
- Деплой: preview + production, /api/version → 5.11.100 на обох, buildSha256 670d60b4 збігається; живий production core.js містить `const EXPORT_VERSION = VERSION;` і `VERSION="5.11.100"`
- Коміт 4d8841a. ZIP: releases/AI_Bridge_v5.11.100.zip (438 файлів, без .wrangler/)

## v5.11.98 (2026-10-05)
М'які фейди країв скрольованих панелей + аудит тач-цілей і зума полів вводу.
- app.js: scroll-fade — JS відстежує краї скрольованих панелей (історія, «Що нового», листи, палітра, журнал прогресу, прев'ю інструментів) і виставляє data-fade-top/bottom; маска — чистий CSS
- styles.css: `.scroll-fade` mask-image з токенами `--sf-top`/`--sf-bottom` (26px); усі кнопки, чипи, вкладки, іконки топбару — min-height ≥44px; усі поля вводу — font-size ≥16px (iOS більше не зумить екран при фокусі); `.emptyState` gap 8→12px (design-evolver — індиго-сяйву емодзі було тісно)
- changelog-app.json: запис v5.11.98 трьома мовами (uk/en/ru)
- Гейт: перший прогін — FAIL run_v5118_d1_tokens_tests.mjs (var(--sf-top)/var(--sf-bottom) не були токенами D1); виправлено чесно — додано як :root-токени (код не чіпав тести); повторний прогін — RELEASE READY: 194/194 файлів, 5847 перевірок, ESLint чистий
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.98 на обох, buildSha256 bd014410 збігається; живий app.js production містить scroll-fade і UI_VERSION 5.11.98, styles.css — scroll-fade mask і 44px тач-цілі ✓ (перевірено код фічі в живих файлах, не лише версію)
- ZIP: releases/AI_Bridge_v5.11.98.zip (423 файли, без директорії .wrangler/; 2 легітимні wrangler.toml на місці)
- Коміт: 5991eb4 (дерево чисте)

## v5.11.97 (2026-10-05)
Мердж аудиту CORE_RESCUE: коли всі хмарні моделі відмовили — Ядро підхоплює розмову локально.
- app.js: `providersFailedReport()` — ядро (createAssistant) пробує відповісти саме; якщо може — відповідь Ядра першою, заголовок «Відповідь Ядра» (coreRescueShort), а не «Помилка»; якщо не може — чесно пише, що потрібна хмарна модель. Причини згруповано простими словами (новий ключ / поповнити баланс / зачекати), техрядок з HTTP кодом внизу дрібним курсивом. Сесія 401 / 404 / 503 — як раніше через friendlyRunError. Залізне правило збережено: текст питання в хмару ядро НЕ надсилає
- _worker.js: `providerErrorKind()` — Gemini і xAI на неправильний ключ відповідають HTTP 400 («API key not valid», «Incorrect API key provided») → тепер invalid_api_key, а не request_failed
- i18n.js: пакет V51197 — 12 ключів en/uk/ru (coreRescueTitle/coreRescueShort/coreRescueNone/fixTech/fixInvalidKey/fixBilling/fixRate/fixPermission/fixModel/fixTimeout/fixDown/fixOther)
- core.js: оптимізація __analyzeChunk з v5.11.96 збережена (аудит базувався на свіжій версії, конфліктів немає)
- Тести: +run_v51197_core_rescue_tests.mjs (33/33); виправлено захардкоджену версію в run_v51194_core_assistant_tests.mjs (тепер з bridge-version.json)
- Тести: 194/194 файлів, 5843 перевірки, SYNTAX 243/243, ESLint-гейт чистий — PASS (RELEASE READY)
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.97 на обох, buildSha256 60e9b729 збігається; живий app.js production містить providersFailedReport, i18n.js — coreRescueTitle/V51197 ✓ (перевірено код фічі в живих файлах, не лише версію)
- ZIP: releases/AI_Bridge_v5.11.97.zip (436 файлів; перезібрано вручну — виключено .wrangler/ на всіх рівнях включно з scheduler-worker/.wrangler/cache з секретами акаунта; 2 легітимні wrangler.toml на місці)
- Коміт: 4446857

## v5.11.91 (2026-10-05)
builder, цикл 09:14: перейменування діалогів + тост «Відповідь готова»; у релізі також skip-link (design-evolver) і збалансоване резюме ядра (core-evolver).
- app.js: олівець ✎ у рядку історії — `startHistRename()`: інлайн-редагування назви (Enter/blur — зберегти через putRun, Esc — скасувати, порожній ввід — лишити як було); своя назва має пріоритет над автозаголовком
- app.js: in-app тост «✅ Відповідь готова» — `toastAction()` + `openHistoryRunByUid()`: діалог, що завершився не на екрані (той же випадок, що й «непрочитане» в saveRun), показує тост з кнопкою «Відкрити»; прихований застосунок покриває push, помилки й інкогніто — ні
- i18n.js: пакет V51191 — 5 нових ключів uk+en (renameRun, renameRunPh, renameSaved, ansReadyToast, ansReadyOpen); styles.css: `.histRenameInput`
- У релізі їдуть зміни сусідів: design-evolver — skip-link «Пропустити до вмісту» (a11y, перший Tab → #mainContent); core-evolver — analyze(): збалансований бюджет резюме head/middle/tail 33/34/33 (висновок довгого документа не губиться), A/B FIX 1/REGRESSION 0
- Тести: 187/187 файлів, 5582 перевірки, SYNTAX 232/232 — PASS (RELEASE READY)
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.91 на обох; живий app.js production містить startHistRename/toastAction/ansReadyToast, i18n.js — renameRun/skipLink ✓ (перевірено код фічі в живих файлах, не лише версію)
- ZIP: releases/AI_Bridge_v5.11.91.zip (перезібрано вручну — виключено .git, releases, node_modules, .wrangler/ на всіх рівнях включно з scheduler-worker/.wrangler/cache з секретами акаунта; 2 легітимні wrangler.toml на місці)
- Коміт: be29620

## v5.11.90 (2026-10-05)
design-evolver, цикл «темна тема»: видимий блік-шиммер скелетонів завантаження.
- styles.css: `.skel` += `position:relative;overflow:hidden`; новий `.skel:after` — білий блік 8% (`linear-gradient(100deg,…)`), `animation:skelSweep 1.8s ease-in-out infinite` з паузою (55% циклу); новий `@keyframes skelSweep`. У темній темі завантаження списків (промпти, проєкти, агенти) нарешті «живе» — досі базова смуга (--surface-2→--surface-3) майже не читалась; у світлій темі білий блік невидимий — без змін
- Видалено осиротіле MINIMAL-правило `.skel:after` (було без content/позиції/анімації — нічого не робило); prefers-reduced-motion: `.skel:after{display:none}`
- Тести: 186/186 файлів, 5578 перевірок, SYNTAX 231/231 — PASS (гейт прогнано ЗІ зміною)
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.90 на обох, buildSha256 688d0776 збігається; живий styles.css production містить skelSweep ✓ (перевірено код фічі в живих файлах, не лише версію)
- ZIP: releases/AI_Bridge_v5.11.90.zip (407 файлів; перезібрано вручну — виключено .wrangler/ з секретами акаунта; 2 легітимні wrangler.toml на місці)
- Коміт: 82db6f3

## v5.11.88 (2026-10-05)
Терміновий багфікс за self-diagnostic звітом Сергія з iPhone (v5.11.87).
- app.js: `renderScrollFab` — виправлено масовий `ReferenceError: Can't find variable` (×15068). Корінь: крайовий випадок області видимості в Safari. Функція тепер явно виставлена на `window.renderScrollFab`, додано безпечний враппер `safeRenderScrollFab()` (typeof-check + try/catch + fallback на window); усі 3 виклики (noteScrollFabEvent, onclick FAB, scroll/resize rAF) йдуть через нього
- app.js: `wireConfirmSheet()` — null-check для `$("confirmSheetOk")` перед присвоєнням onclick (виправлено `TypeError: null is not an object`)
- _worker.js `decideRoute`: Improvement Lab `route_failing` (agent|none|no_tools на greeting: 3 failures / 1 success, confidence 0.333) — привітання в режимі `agent` більше не женуться через Agent Core, повертається `direct` з reason `greeting_trivial_no_agent_needed`
- Тести: 185/185 файлів, 5505 перевірок, SYNTAX 230/230 — PASS (тест v51129 оновлено під safeRenderScrollFab)
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.88 на обох, buildSha256 2769ebf0 збігається
- ZIP: releases/AI_Bridge_v5.11.88.zip (перезібрано вручну — виключено .wrangler/ з секретами акаунта)
- Коміт: af5ea02

## v5.11.87 (2026-10-05)
design-evolver, цикл «мікровзаємодії»: тактильний відгук карток історії чатів.
- styles.css: `.historyItem:active{transform:scale(.98)}` — картка м'яко «натискається» при тапі, як кнопки й чипи (досі press-ефекту в .historyItem не було взагалі); transition доповнено `transform .12s ease` — той самий таймінг, що й у press-групи
- scale .98 (не .96) — свідомо м'якше: це повноширинна картка, а не маленький контрол; pinned/hasUnread-стани не конфліктують (лише border-стилі)
- prefers-reduced-motion: `.historyItem:active` додано до існуючого правила `transform:none`
- Тести: 185/185 файлів, 5497 перевірок, SYNTAX 230/230 — PASS (гейт прогнано ЗІ зміною)
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.87 на обох, buildSha256 a7b82984 збігається; живий styles.css production містить .historyItem:active ✓
- ZIP: releases/AI_Bridge_v5.11.87.zip (перезібрано вручну — виключено .wrangler/cache з секретами акаунта; маніфест почищено: 406 файлів)
- Коміти: 9e7f0c9 (зміна), f7d905e (реліз + STATUS)

## v5.11.83 (2026-10-05)
design-evolver, цикл «кольори»: світіння акцентних кнопок — у фірмовому індиго.
- styles.css: новий токен `--glow` (темна — 94,106,210 = #5e6ad2; світла/auto — 74,88,196 = #4a58c4); 6 хардкодів `rgba(111,149,255,…)` замінено на `rgba(var(--glow),…)` у .brandMark, .primary, .agentEmpty .agentOrb, .uploadIconBtn, .runBtn, .docMark — тіні-світіння тепер у кольорі градієнта, єдиний акцент індиго скрізь
- Орбу чату (багатобарвний radial-gradient) не чіпано — це окремий креативний елемент з власними токенами --orb-*
- Тести: 183/183 файлів, 5435 перевірок, SYNTAX 228/228 — PASS (гейт прогнано ЗІ зміною)
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.83 на обох, buildSha256 4b0cdbe7 збігається; живий styles.css production містить --glow ✓ (production підтягнувся з ~хвилинною затримкою)
- ZIP: releases/AI_Bridge_v5.11.83.zip (перезібрано вручну — виключено .wrangler/ з секретами акаунта)

## v5.11.79 (2026-10-04)
design-evolver, цикл «типографіка»: збалансовані переноси дисплейних заголовків.
- styles.css: `text-wrap:balance` для .pageTitle h2, .hero h2, .agentHero h2, .workTop h1, .docHero h1, .brand h1, .md h1/h2/h3 — довгі українські заголовки на 390px більше не «рвуться», прогресивне покращення (старі браузери ігнорують)
- Тести: 180/180 файлів, 5362→5366 перевірок — PASS (гейт прогнано ЗІ зміною)
- Деплой: preview (chat-simplify) ✓ + production (main) ✓ — /api/version = 5.11.79 на обох, buildSha256 7a6f98c0 збігається з комітом; живий styles.css production містить text-wrap:balance ✓
- Preview-десинхронізація (був 5.11.76) — виправлено цим деплоєм
- ZIP: releases/AI_Bridge_v5.11.79.zip (перезібрано вручну — виключено .wrangler/)
- Коміт: c76cd32

## v5.11.77 (2026-10-04)
Терміновий багфікс: картки агентів тепер клікабельні (Сергій: «натискаю — нічого не відбувається»).
- crew.js renderAgents(): картки отримали data-role + tabindex=0 + title-хінт
- Клік по картці → відкривається форма нового завдання (crewNewTaskDetails) з preselected роллю агента + фокус на полі назви
- Клік не спрацьовує при виділенні тексту (перевірка window.getSelection())
- Клавіатура: Enter/Space на картці теж відкриває форму
- CSS: cursor:pointer, hover-підняття картки з тінню в акцентному кольорі, active/focus-visible стани; на touch-пристроях hover вимкнено
- FAB «+» тепер використовує спільну функцію openTaskForm()
- Тести: 179/179 файлів, 5362 перевірок — PASS
- Деплой: preview ✓, production (main) ✓ — /api/version = 5.11.77
- ZIP: releases/AI_Bridge_v5.11.77.zip (зібрано вручну — виключено .wrangler/)
- Fingerprint: 6b7dab97aa98eb6f9132d04fb937b74b0f137990261e431303a009ba8e76dbff
- Коміт: ae226a3

## v5.11.70 (2026-10-04)
«Ядро» — власний локальний движок аналізу тексту (вимога Сергія: «своє ядро, свій движок», відхилив Cloudflare Workers AI).
- core.js (новий, zero dependencies): summarize/answer/keywords/stats/detectLang/analyze — чистий JS, нуль мережевих викликів, працює офлайн
- Провайдер «Ядро» (⚙️, бейдж «Офлайн», local:true): картка в селекторі, «Не потребує налаштування» у Зв'язку, providers.core=true в /api/status
- sendTask перехоплює вибір тільки-Ядра: довгий текст (≥200) → повний аналіз (мова/статистика/ключові слова/резюме); файли + питання → екстрактивна відповідь з контексту; коротке → чесне пояснення
- Чесність: «аналізатор тексту, а не чат-бот» — не називається LLM ніде; i18n uk/en (+ru-назви мов через ключі)
- Виправлено по ходу гейту: CSS-змінні для .coreBadge (D1-токени), allowlist «Ядро» в i18n-аудиті, оновлено тести muse/promptlang
- Тести: 174/174 файлів, 5189 перевірок — PASS (новий run_v51170_core_tests.mjs: 58)
- Деплой: preview (chat-simplify) ✓, production (main) ✓ — /api/version = 5.11.70, код фічі (runLocalCore/BridgeCore) підтверджено в живому app.js, core.js → 200
- ZIP: releases/AI_Bridge_v5.11.70.zip (перезібрано вручну — виключено .wrangler/cache)
- Fingerprint: a18d4e8573467ca70bcea30dc349bdcb52dd7bf19e328bb9651db3d705725b0b
- Коміт: 875a113

## v5.11.57 (2026-10-03)
Лотерейний аналізатор, що навчається + еволюція успішних стратегій (ідея Сергія: «те, що реально працювало — ті ідеї розвивати»).
- Цикл зворотного зв'язку: генерація → збереження прогнозу (KV lotto:predictions, макс 20) → новий тираж → перевірка збігів → оновлення ваг стратегій (EMA α=0.25, KV lotto:strategy-stats)
- Еволюція: стратегія з ema ≥ 0.6 дає похідне комбо (Гарячі+, Дозрілі+, Парні+, Баланс+/Анти-тренд зі зсувом); макс 8 комбо (5 базових + до 3 похідних); похідні вчаться окремо
- UI: точність кожної стратегії («Точність стратегії: X.X збігів у середньому»), рядок «Перевірено прогнозів: N · Найкраща стратегія: …»; i18n uk/en
- Дисклеймер про випадковість лишено
- Тести: 163/163 файлів, 4545 перевірок — PASS (новий run_v51157_lotto_learn_tests.mjs: 54)
- Деплой: preview (chat-simplify) ✓, production (main) ✓ — /api/version = 5.11.57 на обох
- Fingerprint: 14819452fa8b66d38fc57c0b8c21f4455d59c7d737f6fb7bc9c038e199e74874
- Коміт: d247148

## v5.11.49 (2026-10-03)
Головний екран як у макеті v2 (main-chat.html), мобільний 390px, темна тема.
- Таб-бар: всі 9 вкладок видно без кнопки «Ще» (підписи з макету: Чат, Агент, Команда, Агенти, Файли, Студія, Мозок, Зв'язок, Історія; іконки stroke 2 з макету)
- Топбар: орб 28px + «AI Bridge» 16px/700 + версія моно 11px; пігулка мережі «6/6»; круглі кнопки мови 40px і «···» 40px; нижня волосяна лінія
- Композер: рядок вартості зверху праворуч (моно 11px); пігулка radius 28px; кнопки-інструменти круглі 44px без підписів; поле 17px, плейсхолдер «Написати…»; відправка — індиго-круг 44px з білою стрілкою
- i18n: navCrew → «Агенти»/«Agents»/«Агенты»
- Тести: 159/159 файлів, 4309 перевірок — PASS
- Деплой: preview (chat-simplify) ✓, production (main) ✓
- Fingerprint: 9dfd1e4396a0202f079be6db7b2c1d698f6759eee2e158a5465399e19f379f8c

## v5.11.48 (2026-10-03)
Дизайн V2 частково: таб-бар, акцент Індиго #5e6ad2, шапка відповіді, статуси-крапки. Схвалено Сергієм.
