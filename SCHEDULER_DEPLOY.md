# SCHEDULER_DEPLOY.md — розгортання cron-планувальника AI Bridge

## Чому потрібен окремий Worker

Перевірено за офіційними доками Cloudflare (2026-09-30):

- Cron Triggers — фіча **тільки Workers**. Cloudflare Pages її **не підтримує**,
  навіть в advanced mode з `_worker.js`.
  Джерело: гайд «Migrate from Pages to Workers»
  (https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/):
  «Unlike Pages, Workers has a distinctly broader set of features available to it,
  (including Durable Objects, Cron Triggers, and more comprehensive Observability).»
- За доками (https://developers.cloudflare.com/workers/configuration/cron-triggers/)
  `scheduled` handler має бути на `export default` (`async scheduled(controller, env, ctx)`) —
  це в `_worker.js` тепер є (про всяк випадок / для майбутньої міграції на Workers),
  але на Pages cron все одно не спрацює.
- Стандартний патерн спільноти: окремий cron-Worker → HTTP-виклик у Pages-застосунок.

Тому: `scheduler-worker/` — маленький Worker з cron-тригером, який кожні 5 хв
викликає `POST https://aibridge-aff.pages.dev/api/team/scheduled-tick`.
Уся логіка тіку (`teamScheduledTick`: stale-sweep → retry → due tasks → daily review)
живе в `_worker.js` і виконується **на сервері** — Safari/телефон можуть бути закриті.

## Що робить тік (коротко)

1. `teamStaleSweep` — завдання `running` з простроченим heartbeat (>10 хв) → `failed`.
2. `teamRetryPass` — `failed` через stale-heartbeat: `retries<3` → requeue з backoff
   (2/4/8 хв, max 1 год), інакше → `blocked`.
3. `teamProcessDueTasks` — виконує `queued`-завдання, чий `nextRetryAt` настав
   (до 10 за тік): відновлення після рестарту без клієнта.
4. `teamDailyReview` — ідемпотентний щоденний огляд (lock + звіт `team:report:<дата>`).

## Кроки розгортання

### 1. Секрет на Pages-проєкті (один раз)

Секрет має знати обидві сторони. Згенеруй випадковий рядок (32+ символів):

```bash
openssl rand -hex 32
```

Додай як **env var** на Pages-проєкт `aibridge-aff`:

1. Cloudflare Dashboard → **Workers & Pages** → вибери `aibridge-aff` (Pages).
2. **Settings** → **Environment variables** → **Add variable** (Production):
   - Name: `AI_BRIDGE_CRON_SECRET`
   - Value: `<згенерований секрет>`
3. **Save**. Змінні підхоплюються наступним деплоєм Pages
   (або зачекай кілька хвилин — Pages підтягує env без редеплою для Functions;
   якщо тік повертає 401/403 — зроби редеплой).

### 2. Деплой scheduler-worker

```bash
cd ~/workspace/audit_bot/scheduler-worker
npx wrangler login            # або wrangler login через браузер (один раз)
npx wrangler secret put CRON_SECRET
# встав ТОЙ САМИЙ секрет, що й AI_BRIDGE_CRON_SECRET на кроці 1
npx wrangler deploy
```

`wrangler.toml` уже містить `[triggers] crons = ["*/5 * * * *"]` —
деплой одразу ставить cron-тригер. Перевірка в дашборді:
**Workers & Pages** → `aibridge-scheduler` → **Settings** → **Triggers** →
має бути `*/5 * * * *`.

> Безпека: секрет передається лише в `Authorization: Bearer` заголовку
> (HTTPS). У логах секрет не друкується — тільки статуси й підсумки тіку.

### 3. Перевірка

1. Зачекай до 5 хв (перший cron-тік).
2. **Workers & Pages** → `aibridge-scheduler` → **Logs** → **Real-time logs**:
   має бути `aibridge-scheduler: tick ok cron=*/5 * * * * ...`.
3. Перевір звіт команди (авторизований запит):
   `GET https://aibridge-aff.pages.dev/api/team/report` → з'являється
   `team:report:<сьогоднішня дата>` після першого денного тіку.
4. Ручний тік без очікування cron (тест секрету):
   ```bash
   curl -sS -X POST https://aibridge-aff.pages.dev/api/team/scheduled-tick \
     -H "Authorization: Bearer <AI_BRIDGE_CRON_SECRET>" | head -c 600
   ```
   Очікується `{"version":"5.11.0","ok":true,"tick":{...}}`.

### 4. Якщо тік не працює

| Симптом | Причина → дія |
|---|---|
| `tick failed ... 401/403` | Секрет не збігається: перевір `AI_BRIDGE_CRON_SECRET` (Pages) і `CRON_SECRET` (Worker) — мають бути ідентичні. |
| `tick failed ... 503` | На Pages не задано `AI_BRIDGE_CRON_SECRET` (ендпоінт тоді вимагає звичайну авторизацію). |
| Логи порожні > 10 хв | Cron-тригер не став: **Settings → Triggers** worker'а; за доками зміни тригерів розповсюджуються до ~15 хв. |
| `tick ok`, але review `skipped:"disabled"` | Команда вимкнена (`POST /api/team/stop-all` ставить `enabled=false`): увімкни `POST /api/team/config {"enabled":true}`. |

## Зміна розкладу

Відредагуй `crons` у `scheduler-worker/wrangler.toml` і зроби `wrangler deploy`.
Формат — 5 полів, час **UTC** (напр. щоденний огляд о 06:00 UTC: `0 6 * * *`).
Ідемпотентність щоденного огляду гарантує lock + звіт за датою, тож частіший
cron (кожні 5 хв) не створює дублікатів — огляд виконується раз на добу.

## Локальне тестування cron

```bash
cd scheduler-worker
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"
```
Це викличе `scheduled()` локально (потрібні `SITE_URL` і `CRON_SECRET`
в `.dev.vars` — не комітити).
