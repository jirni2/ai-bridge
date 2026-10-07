# AI Bridge — статус релізів

## v5.11.100 (2026-10-06)
Production honesty hotfix after a real browser test on aibridge-aff.pages.dev.
- `app.js`: Muse and local Core no longer inflate the configured API-key count; the header and provider ratio now count only cloud API providers.
- Simple deterministic questions can fall back to local Core in Auto/Agent/God when no cloud key is available, instead of ending in HTTP 503.
- Failed requests now end the activity log with “no answer received”, not the false “answer ready”.
- `tests/run_v511100_production_honesty_tests.mjs`: regression coverage for all three defects.
- Production v5.11.99 accepted and parsed the full 425-entry release ZIP (417 text/code files); this fix does not reduce ZIP safety limits.

## v5.11.99 (2026-10-05)
Ядро: більше автономності — вбудовані знання, самонавчання, пряме навчання, списки, кілька команд.
- core.js: блок «ЗНАННЯ ЯДРА» (194 країни uk/ru/en + 78 фактів × 3 мови), `learnQA/forgetQA/findLearned`, teach/feedback, синоніми, одруківки, списки, multi; exportMemory v2.
- app.js: `coreLearnFromRun()` (вчиться з відповідей хмари), `coreTrainFromHistory()` (одноразово з історії + кнопка), перемикач самонавчання в «Карті даних», 👎 → forgetQA.
- i18n.js: V51199 (en/uk/ru). Тест: `tests/run_v51199_core_learning_tests.mjs` (69).
- Торговий модуль не змінювався. Деталі: CHANGELOG_v5_11_99.txt.

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
