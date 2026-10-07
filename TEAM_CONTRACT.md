# TEAM CONTRACT — «Команда агентів» v5.11.0

## Загальні правила
- Не ламати існуюче. Додавати, не переписувати.
- KV binding: `AI_BRIDGE_JOBS` (через `jobsKV(env)`), ключі з префіксом `team:`.
- In-memory fallback (Map), коли KV немає — як у jobs.
- Жодних секретів у відповідях/логах: проганяти через `containsSecretLike`, маскувати.
- Версія: 5.11.0.

## KV-схема
- `team:config` → {enabled:bool, autoApproveLowRisk:bool, dailyBudgetUsd:number, scheduleNote:string}
- `team:token:<tokenId>` → {id, agentId, scope:[string], exp:number(сек), issuedAt:number(мс), revoked:bool, revokedAt?:number} — записи командних токенів; TTL = до exp (v5.11.1)
- `team:agent:<roleId>` → {status:"idle"|"running"|"paused"|"stopped"|"error", lastRun:number|null, lastHeartbeat:number|null, activeTasks:number, note:string}
- `team:task:<uuid>` → {id, role, title, status:"queued"|"running"|"paused"|"waiting"|"done"|"failed"|"cancelled"|"blocked", deps:[id], input:any, result:any, evidence:[string], costUsd:number, author:string, approver:string|null, createdAt:number, updatedAt:number, heartbeatAt:number|null, heartbeatOwner:string|null, retries:number, nextRetryAt:number|null, failKind:string|null, reservedUsd:number, estimateUsd:number|null, kind:"diagnostic"|"agent", criteria:[], parentId:string|null, waitingFor:string|null, blockedReason:string|null}
  - author — ЗАВЖДИ у єдиному форматі: "user" або "team:<roleId>". Визначається СЕРВЕРОМ з actor; поля author/agentId з тіла запиту ігноруються.
  - "blocked" — термінальний статус (виходу немає), напр. вичерпано бюджет або ретраї. "waiting" — активний (батько чекає дочірнє).
  - heartbeatAt/heartbeatOwner — пульс виконавця; retries/nextRetryAt/failKind — ретраї; reservedUsd — зарезервована сума бюджету (див. «Бюджет»).
  - kind:"agent" — агентна робота: result = {summary, files[], changes[], evidence[], testResults[], criteriaChecks[]}; criteria = [{id,text,expectEvidence?}]; done — тільки якщо всі критерії pass і є реальні докази (див. «Агентне виконання: межа чесності»).
- `team:tasks:index` → [id], cap 500 (обрізати старі)
- `team:events` → [{ts,kind,actor,msg}], cap 200
- `team:kb:<key>` → {key, value, source, updatedAt}
- `team:release:<uuid>` → {id, title, changes:[string], codeRefs:[string], contentHash:string, approvedHash:string|null, authorRole, author, status:"pending"|"approved"|"rejected"|"blocked"|"deployed", approver, blockedReason:string|null, deployRef:string|null, deployedAt:number|null, createdAt, decidedAt}
  - author — "user" або "team:<roleId>", визначається СЕРВЕРОМ (для агента роль примусово = роль актора; authorRole/role з тіла ігноруються). authorRole лишається для відображення.
  - contentHash = sha256(changes[] + codeRefs[]), рахується при створенні; схвалення фіксує його в approvedHash; будь-яка зміна вмісту після approved/blocked анулює рішення (статус назад у pending) — див. «Релізи: життєвий цикл».
  - deployRef — запис про ФАКТИЧНИЙ деплой; published у звіті — тільки з ним.
- `team:releases:index` → [id], cap 100
- `team:lock:<name>` → {owner, ts, expiresAt} (див. «Блокування»)
- `team:budget:<YYYY-MM-DD>` → {spentUsd, reservedUsd} — денний леджер бюджету команди (див. «Бюджет»)
- `team:report:<YYYY-MM-DD>` → {date, found:[], verified:[], prepared:[], tested:[], fixed:[{task,changes}], published:[{release,deployRef}], blocked:[], events, spentUsd}
  - 7 категорій (див. «Звіти»): verified — перевірки стану; found — усе створене; prepared — релізи в pending; tested — перевірене тестами; fixed — тільки agent-done із changes[] і доказами; published — тільки deployed із deployRef; blocked — blocked/failed із причиною.

## API (авторизація як в інших /api/*, через сесію)
- GET /api/team/agents → {version, agents:[{id,name,status,lastRun,lastHeartbeat,activeTasks,note,budgetUsdPerDay}]}
- GET /api/team/tasks?status=&role= → {version, tasks:[]}
- POST /api/team/tasks {role,title,input?,deps?[],kind?("diagnostic"|"agent"),criteria?[{id,text,expectEvidence?}],parentId?} → {version, task} (дедуп: той самий role+title у queued/running/paused/waiting → 409)
- POST /api/team/tasks/:id {action:"start"|"pause"|"resume"|"cancel"} → {version, task}; start блокується (409), якщо deps не в done
- POST /api/team/tasks/:id {action:"execute"} → {version, task} (виконання; kind:"agent" → teamRunAgentTask з гейтом доказів); {action:"process-waiting"} → {version, resolved:[{id,status}]} (розбір waiting-батьків; право task.assign)
- POST /api/team/tasks/:id/approve {approve:bool, note?} → 403 якщо approver==author (єдиний формат: "user" або "team:<role>")
- POST /api/team/stop-all → {version, stopped:n} (всі агенти → stopped, running-завдання → cancelled) — лише user
- POST /api/team/tokens {agentId, scope:[], ttlSec?} → {version, token} — лише user; scope мусить бути підмножиною permissions ролі
- POST /api/team/tokens/revoke {tokenId} → {version, ok:true} — лише user
- GET /api/team/events?limit=50 → {version, events:[]}
- GET /api/team/kb → {version, keys:[]}; POST /api/team/kb {key,value,source?} → {version, ok:true}
- GET /api/team/releases → {version, releases:[]}; POST /api/team/releases {title, changes?, codeRefs?, lowRisk?} → 201 (автор = actor, визначає сервер; contentHash рахується одразу); POST /api/team/releases/:id/approve {approve:bool, note?} → 403 якщо approver==author (єдиний формат); approve:false від tester → status "blocked" з причиною; рішення можливе зі статусів pending|blocked (повторний розгляд); POST /api/team/releases/:id/update {changes?,codeRefs?} → 200 (зміна вмісту після approved/blocked анулює рішення → pending); POST /api/team/releases/:id/deploy {deployRef} → 200 (тільки з approved; deployRef обов'язковий)
- GET /api/team/config → {version, config}; POST /api/team/config {enabled?,autoApproveLowRisk?,dailyBudgetUsd?} → поля autoApproveLowRisk/dailyBudgetUsd змінює лише user (агент → 403); підвищення dailyBudgetUsd через actor!="user" → 403
- GET /api/team/report?date= → {version, report|null} (7 категорій: verified/found/prepared/tested/fixed/published/blocked — див. «Звіти»)
- GET /api/team/media → {version, photo:{status,engine,needs}, video:{status,engine,needs}} — ЧЕСНО: status "not_connected", жодного Workers AI
- POST /api/team/scheduled-tick → {version, ok:true, tick:{sweep, retry, due, review}} — серверний тік для scheduler-worker (див. «Розклад»). Авторизація: `Authorization: Bearer <AI_BRIDGE_CRON_SECRET>` (cron:scheduler) або звичайна авторизація користувача; team-токени агентів — 403.

## Експорти з _worker.js (для тестів)
TEAM_ROLES, teamConfigGet, teamConfigPut, teamTaskCreate, teamTaskGet, teamTaskList, teamTaskTransition, teamTaskApprove, teamStopAll, teamEventLog, teamEventList, teamKbPut, teamKbGet, teamKbKeys, teamReleaseCreate, teamReleaseApprove, teamReleaseHash, teamReleaseUpdate, teamReleaseMarkDeployed, teamGuard, teamNormalizeActor, teamAuthorize, teamRouteKey, teamActorPerms, teamTokenSecret, teamIssueToken, teamVerifyToken, teamRevokeToken, teamExecuteTask, teamRunAgentTask, teamProcessWaiting, teamNormalizeCriteria, teamEvaluateCriteria, teamDailyReview, teamMediaCaps, teamBuildReport, handleTeam,
надійність (тести run_v5111_sched_tests.mjs): teamLockAcquire, teamLockHeartbeat, teamLockRelease, teamTaskHeartbeat, teamStaleSweep, teamRetryPass, teamProcessDueTasks, teamScheduledTick, teamBudgetDay, teamBudgetReserve, teamBudgetSettle, teamBudgetRelease, teamRoleSpentToday, teamRoleReservedToday, teamCronSecretOk, TEAM_TRANSITIONS, TEAM_TERMINAL, TEAM_TASK_MAX_RETRIES, TEAM_HEARTBEAT_STALE_MS

## 24 ролі (id — name)
coordinator Координатор, architect Архітектор, chat Chat, agentplan Agent Plan/Team, search Пошук, knowledge Знання та пам'ять, photo Фото, video Відео, voice Голос та аудіо, files Files/ZIP, providers AI-провайдери, jobs Jobs/фон, design Дизайн, iphone iPhone/PWA, backend Backend/дані, security Безпека, integrations OAuth/MCP/Connect, workcontroller Work Controller, binance Binance, analytics Аналітика та витрати, tester Тестувальник, releases Релізи та відновлення, research Дослідження й розвиток, docs Документація та переклади.

## teamGuard (заборонено агентам, actor!="user")
- budget.increase, security.weaken, prod.data.delete, trade.limits.change, trade.live.activate → {allowed:false, reason}
- Релізи: author не може апрувити свій реліз (approver==author у єдиному форматі → 403). Те саме для завдань.

## Безпека /api/team/* (v5.11.1)
- Ідентичність: actor завжди "user" або "team:<roleId>" (`teamNormalizeActor`). Жодних "голих" id ролей у порівняннях.
- `teamAuthorize(env, actor, route, method, ctx)` — єдина матриця прав; `handleTeam` викликає її першою, до будь-яких змін стану. Невідомий маршрут → default deny (403).
- Матриця (скорочено): GET-* — будь-який автентифікований актор; POST /tasks → `task.create`; POST /tasks/:id — start/pause/resume/execute/process-waiting → `task.assign`, cancel → `task.cancel`; POST /tasks/:id/approve → `task.approve`; POST /kb → `kb.write`; POST /releases → `release.prepare`; POST /releases/:id/approve → `release.block`; POST /releases/:id/update, POST /releases/:id/deploy → `release.prepare`; POST /stop-all, POST /tokens, POST /tokens/revoke — лише user; POST /config — autoApproveLowRisk/dailyBudgetUsd лише user, решта → `config.write` (жодна роль його не має).
- Фактичні дозволи агента = перетин прав ролі × scope токена (`teamActorPerms`).
- Токени: формат `team.<tokenId>.<sig(HMAC-SHA256)>`; scope[] зберігається в KV `team:token:<id>` {agentId, scope[], exp, revoked}. Кожна верифікація перевіряє підпис, exp і revoked. Видача відхиляє scope поза permissions ролі (403).
- Секрет підпису — ТІЛЬКИ `env.TEAM_TOKEN_SECRET`. Без нього видача і перевірка БЛОКУЮТЬСЯ (503), fallback-секрету в коді немає. Токени старого безстанного формату (до v5.11.1) після оновлення недійсні.
- Чесні обмеження (не імітуються): bearer-токен не прив'язаний до клієнта — витік токена = витік прав до exp/revoke; відкликання через KV має eventual consistency між ізолятами; точний час — за годинником ізоляту.

## Щоденний огляд (scheduled)
teamDailyReview(env): ідемпотентність у два рівні —
1) lock `team:lock:daily-review:<дата>` {owner:"scheduler", ts, expiresAt} (fail-closed: без захоплення lock огляд не стартує; чужий активний lock → skipped:"locked");
2) запис завершення `team:report:<дата>` (якщо звіт уже є → skipped:"already-ran").
Після захоплення lock — повторна перевірка звіту (гонка двох ізолятів), далі для кожної ролі за її тригерами створити завдання → виконати → teamBuildReport → записати team:report:<дата>. Без дублів. Прапорець enabled=false → skipped:"disabled".

## Розклад (cron)
- Перевірено за офіційними доками Cloudflare (2026-09-30): Cron Triggers — фіча **тільки Workers**; **Cloudflare Pages не підтримує cron**, навіть в advanced mode з `_worker.js` (гайд «Migrate from Pages to Workers»: «Unlike Pages, Workers has … Cron Triggers …»). За доками `scheduled` має бути на `export default` — це в коді є (для коректності/майбутньої міграції), але на Pages cron не спрацює.
- Production-шлях: окремий Worker-планувальник `scheduler-worker/` (код + `wrangler.toml` з `[triggers] crons = ["*/5 * * * *"]`, UTC). Кожні 5 хв він викликає `POST {SITE_URL}/api/team/scheduled-tick` з `Authorization: Bearer <CRON_SECRET>`.
- Секрет: env `AI_BRIDGE_CRON_SECRET` на Pages-проєкті = secret `CRON_SECRET` на worker'і. Без секрету в env ендпоінт вимагає звичайну авторизацію користувача.
- Тік виконує `teamScheduledTick(env)` **на сервері** (Safari може бути закрито): stale-sweep → retry-pass → due tasks → daily review. Кроки розгортання — `SCHEDULER_DEPLOY.md`.
- Ідемпотентність щоденного огляду (lock + звіт за датою) гарантує: частіший cron не створює дублікатів.

## Блокування (locks)
- `teamLockAcquire(env,name,owner,ttlMs)` / `teamLockHeartbeat` / `teamLockRelease`. Fail-closed: помилка KV або зайнятий lock → операція не стартує.
- **Межа чесності (KV без CAS):** Workers KV не має compare-and-swap, тому get→put **не є атомарним** між ізолятами. У проєкті є Durable Object лише для OAuth replay (`oauth-replay-do.js`, біндинг `OAUTH_REPLAY_DO`, API `/consume` без release/heartbeat) — окремого DO для команди немає; перепрофілювання OAuth-DO під локи відхилено (змішування просторів імен і семантики). Реалізовано чесний максимум: lock {owner, ts, expiresAt} + heartbeat володіння + read-back після put (якщо інший власник точно виграв — LOCKED) + другий рівень ідемпотентності (звіти завершення, дедуп role+title, легальні переходи). Залишковий ризик: два ізоляти у вікні реплікації KV можуть обидва пройти перевірку — тіла операцій ідемпотентні, тож наслідок обмежений повторним виконанням, а не подвійним ефектом.
- Локальний in-memory fallback lock'ів — лише коли KV не прив'язано (той самий ізолят).

## Heartbeat / таймаути / ретраї
- Виконавці оновлюють `heartbeatAt` (`teamTaskHeartbeat`; перший heartbeat фіксує власника; чужий власник → 403).
- `teamStaleSweep` (у тіку): `running` з heartbeat, простроченим > `TEAM_HEARTBEAT_STALE_MS` (10 хв), → `failed` (failKind="stale-heartbeat"), резерв бюджету звільняється.
- `teamRetryPass` (у тіку): `failed` через stale-heartbeat і `retries < TEAM_TASK_MAX_RETRIES` (3) → requeue (`queued`, `retries+1`, `nextRetryAt = now + backoff` 2/4/8 хв, max 1 год); ретраї вичерпано → `blocked` з причиною.
- `teamProcessDueTasks` (у тіку): виконує `queued`-завдання, чий `nextRetryAt` настав (до 10 за тік) — відновлення після рестарту/закритого Safari без клієнта. Завдання в KV зберігають чекпоінти (статус, retries, evidence, result).

## Бюджет
- Діють РЕАЛЬНО, не декларативно: денний бюджет команди (`team:config.dailyBudgetUsd`, леджер `team:budget:<дата>` {spentUsd, reservedUsd}) + бюджети ролей (`TEAM_ROLES[].budget.maxUsdPerDay`, витрачене рахується з `costUsd`, зарезервоване — з `reservedUsd` активних завдань).
- Перед виконанням — `teamBudgetReserve`: оцінка = `task.estimateUsd` або консервативна `TEAM_TASK_COST_ESTIMATE_USD` (0.01). Невідома вартість ≠ 0. Резерви паралельних завдань сумуються в леджері.
- Після виконання — `teamBudgetSettle`: резерв знімається, списується фактична `costUsd` (якщо runner повернув 0/undefined — списується оцінка). Помилка/скасування — `teamBudgetRelease` (резерв повертається).
- Перевищення будь-якого ліміту → завдання `blocked` з причиною + `BUDGET` (429) назовні.

## Stop All / термінальні переходи
- `team:config.enabled=false` перевіряється ПЕРЕД create / execute / transition / approve → `DISABLED` (403). Виняток: `cancel` дозволено навіть при disabled (напрямок «вимкнути», а не нова робота).
- `teamStopAll`: агенти → stopped; `running`/`paused`/`waiting` → `cancelled` (резерви бюджету звільняються); `enabled=false`.
- Легальні переходи (`TEAM_TRANSITIONS`); термінальні `done`/`failed`/`cancelled`/`blocked` — виходу немає. `teamExecuteTask` після виконання перечитує завдання і пише `done`/`failed` лише якщо статус досі `running`: пізній виконавець не перезапише `cancelled`→`done` (результат відкидається, подія логується).

## Чесні помилки KV
- `teamGet`/`teamPut`/`teamDel`: якщо KV прив'язано, але операція впала — помилка летить назовні (throw). In-memory fallback — ЛИШЕ коли KV взагалі не прив'язано. Ніколи «успішно збережено» з пам'яті замість помилки KV.

## Агентне виконання (v5.11.1-exec): межа чесності
`task.kind`: `"diagnostic"` (default) — перевірка стану, поведінка як раніше; `"agent"` — агентна робота.
Раннер отримує `(env, task, ctx)`, де `ctx = {instructions (з TEAM_ROLES), input (задача), criteria}`.
Результат agent-завдання — СТРУКТУРОВАНИЙ: `{summary, files[], changes[], evidence[], testResults[], criteriaChecks[]}`.
Гейт `teamRunAgentTask`:
- `done` — ТІЛЬКИ якщо кожен критерій з `task.criteria[]` має вердикт `pass` І `evidence[]` непорожній після вирізання заглушок.
- Заглушки замість доказів (`"manual"`, `"delegated…"`, `"n/a"`, `"tbd"` — `teamRealEvidence`) НЕ зараховуються: done з ними неможливий.
- Вердикт критерію: (1) вердикт раннера за id; (2) `expectEvidence` — маркер-підрядок у доказах; (3) інакше — `fail`.
- Немає інструмента/доступу → статус `blocked` з `blockedReason`, НЕ done.
- Делегування: раннер повертає `delegate:{role,title,input,criteria,reason}` → створюється дочірнє завдання (`parentId`, успадковує критерії), батько → `waiting` (не done). `teamProcessWaiting` розбирає waiting-батьків: дитина done → вердикт успадковується за id критеріїв; дитина failed/cancelled → батько failed; дитина blocked → батько blocked. done напряму з делегуванням — заборонено.
- Fail-closed як у diagnostic-шляху: бюджетний резерв перед стартом, пізній виконавець не перезаписує чужий статус.
Що РЕАЛЬНО виконується всередині раннерів: детерміновані перевірки й мутації KV/індексів (triage черги, self-тести, kb-запис, підрахунок витрат, скан налаштувань, перевірка заголовків/ключів). Жодних текстових заглушок замість роботи.
МЕЖА СЕРЕДОВИЩА (не імітується): Worker не може спавнити реальні саб-агенти, виконувати shell, ходити браузером, викликати Workers AI (заборонено вимогою), торгувати наживо. `research` у kind:"agent" чесно повертає `blocked` («немає автономного циклу дослідження в Worker»), а не вигадані знахідки. Тести: `tests/run_v5111_exec_tests.mjs`.

## Релізи: життєвий цикл (v5.11.1-exec)
- Створення (`teamReleaseCreate`): `contentHash = sha256(changes[] + codeRefs[])`.
- Схвалення (`teamReleaseApprove`): фіксує `approvedHash = contentHash`. «Хто може схвалювати» (approver ≠ author) — у потоці безпеки, не чіпати. `approve:false` від ролі tester → статус `blocked` з причиною (дефектний випуск); від інших → `rejected`. Рішення можливе зі статусів `pending`|`blocked`.
- Зміна вмісту (`teamReleaseUpdate`): перераховує хеш; якщо реліз мав рішення (approved/blocked) і хеш змінився — рішення АНУЛЮЄТЬСЯ (статус назад у `pending`, approver/approvedHash скинуто). Ідентичний вміст рішення не анулює. `rejected`/`deployed` змінювати не можна.
- Деплой (`teamReleaseMarkDeployed`): тільки з `approved`, `deployRef` обов'язковий (запис про фактичний деплой).

## Звіти (v5.11.1-exec)
`teamBuildReport` — 7 категорій:
- `verified` — перевірки стану: diagnostic-done + agent-done БЕЗ changes (діагностичні завдання йдуть сюди, а не в fixed);
- `found` — усе створене за день;
- `prepared` — релізи в pending за день;
- `tested` — done із testResults або роль tester;
- `fixed` — ТІЛЬКИ agent-done із непорожніми changes[] І доказами (запис {task, changes} — посилання на конкретну зміну);
- `published` — ТІЛЬКИ deployed із deployRef (запис {release, deployRef});
- `blocked` — blocked/failed із причиною.

## Матриця дій ролей: що РЕАЛЬНО доступно в Worker (v5.11.1-exec)
Кожна дія — детермінована, виконується справді (KV/індекси/typeof-перевірки/обчислення), без LLM, браузера й shell. «Чим перевірено» — тест, що це доводить.

| Роль | Реально доступні дії | Чим перевірено |
|---|---|---|
| coordinator | Скан індексу завдань; stale-running (>30хв) → failed; підрахунок active/waiting; делегування (створення дочірнього, waiting) | run_v511_team_tests §9 (stale-sweep); run_v5111_exec §delegation |
| architect | typeof-перевірка присутності team-експортів | run_v5111_exec (expectEvidence) |
| chat | Зріз providerHealthSnapshot (кількість здорових) | run_v511_team_tests §8 |
| agentplan | typeof-перевірка runAgent/agentControllerOrder | run_v5111_exec |
| search | typeof-перевірка handleWebSearch | run_v5111_exec |
| knowledge | Підрахунок kb-ключів; agent: справжній kb put + get-roundtrip | run_v511_team_tests §16; run_v5111_exec §knowledge |
| photo | imageEngineStatus (чесно not_connected) | run_v511_team_tests §14 |
| video | Скан ключів налаштувань /video\|fal/ | run_v511_team_tests §14 |
| voice | Декларація client-side WebSpeech (серверних ключів не треба) | run_v5111_exec |
| files | typeof-перевірка safeFileContext/normalizeZipEntryName | run_v5111_exec |
| providers | Зріз provider health | run_v511_team_tests §8 |
| jobs | KV list префікса job: / нотатка memory-mode | run_v511_team_tests §9 |
| design | Перевірка CSP у securityHeaders | run_v5111_exec |
| iphone | Перевірка налаштованості VAPID-ключів | run_v5111_exec |
| backend | Перевірка jobsPersistent (KV) | run_v5111_exec |
| security | Скан publicSettings на витік секретів + LOGIN_MAX_ATTEMPTS; agent: справжній скан | run_v511_team_tests §7; run_v5111_exec |
| integrations | MCP_TOOLS.length | run_v5111_exec |
| workcontroller | typeof-перевірка handleWorkRun | run_v5111_exec |
| binance | Перевірка configured(env,"binance") — чи можлива жива торгівля; УГОД НЕ ВИКОНУЄ | run_v5111_exec |
| analytics | Сума витрат за N днів з getUsageDays (справжнє обчислення) | run_v5111_exec |
| tester | Іменовані детерміновані перевірки (roles24, teamFns, versionFormat, kvRoundtrip, noSecretsInPublicSettings, loginRateLimit, cspPresent); невідома перевірка → fail | run_v511_team_tests; run_v5111_exec §gate |
| releases | teamReleaseList + VERSION | run_v511_team_tests §13 |
| research | diagnostic: чесна нотатка; agent: BLOCKED — автономного веб-дослідження в Worker немає, вигадані «знахідки» заборонені | run_v5111_exec §research (blocked, never fake done) |
| docs | Перевірка формату VERSION | run_v5111_exec |

НЕДОСТУПНО в Worker (не імітується): спавн саб-агентів, shell/термінал, навігація браузером, Workers AI, жива торгівля, зовнішня мережа поза налаштованими fetch-викликами.
