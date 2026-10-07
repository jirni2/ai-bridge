AI BRIDGE v5.9.1 — RELIABILITY RELEASE (details: CHANGELOG_v5_9_1.txt)

RELEASE PROCEDURE (every deploy)
1. node tools/sync-version.mjs && node tools/fingerprint-build.mjs && node tools/sync-version.mjs
2. node tools/release-check.mjs --baseline <folder of the previous release> --package
   -> must end with "RELEASE READY"; the ZIP is written to releases/.
3. Upload the files to Cloudflare Pages and deploy.
4. node tools/smoke-test.mjs https://<your-project>.pages.dev --token <BRIDGE_ACCESS_TOKEN> --ai
   -> must end with "SMOKE TEST PASSED". If not: Cloudflare Pages -> Deployments -> Rollback.

SELF-IMPROVEMENT LOOP (never automatic in production)
errors + ratings -> Learn page / Improvement Lab -> AI proposes a patch ->
node tools/improvement-lab.mjs fix.patch            (sandbox: all tests + security + baseline, shows diff)
node tools/improvement-lab.mjs fix.patch --apply    (only if VALIDATED; backup kept)
node tools/rollback.mjs <id>                         (undo) -> release procedure above.

AI BRIDGE v5.8.2 — SUPER ORCHESTRATOR / GOD MODE

WHAT CHANGED IN v5.8.2 (details: CHANGELOG_v5_8_2.txt)
• Jobs now reject a reused clientRequestId when the task or attachment differs;
  an identical retry still recovers its existing result without another AI call.
• KV is labelled as bounded job-record recovery, not durable execution. A real
  durable workflow would checkpoint each provider step and require a separate
  Cloudflare Workflows deployment/binding. No such guarantee is claimed here.

WHAT CHANGED IN v5.8.0 (details: CHANGELOG_v5_8_0.txt, AUDIT_v5_8_0.txt)
• One router picks DIRECT / SEARCH ONLY / SEARCH + AI / AGENT / GOD per task. Simple facts are
  answered from web sources with NO AI; search-backed AI answers pass a citation check.
• God Mode is a real backend pipeline: classify → Search First → plan → tools → AI →
  independent verifier (sees the real evidence, prefers a different model, labels claims
  OBSERVED / INFERRED / UNVERIFIED) → correction pass → learn. Max 4 steps, early stop.
• Free-first routing (Groq → OpenRouter → Gemini → paid) that learns from runtime health,
  latency and malformed output; positive and negative route learning (no prompts or secrets).
• Improvement Lab: /api/improvement-lab proposes; tools/improvement-lab.mjs validates a patch in
  isolation (regression → full suite → security → baseline). Nothing auto-applies.
• KV stores job records across Worker isolates when AI_BRIDGE_JOBS is bound.
  Stale jobs are detected and may be restarted with the same clientRequestId.
• Work Controller: Pause / Resume / Stop / Reconnect, stream inactivity timeout.
• Studio reports IMAGE ENGINE NOT CONFIGURED honestly; with paid opt-in it can use Gemini or
  OpenAI image providers (Workers AI is not mandatory).

DEVELOPER TOOLS
• node tools/run-all-tests.mjs          — every tests/run_*tests.mjs + syntax check, fixture-safe
• node tools/inventory-check.mjs <dir>  — compare file inventory with a baseline
• node tools/improvement-lab.mjs <patch> — isolated validation of a proposed patch
• node tools/sync-version.mjs && node tools/fingerprint-build.mjs && node tools/sync-version.mjs
                                         — version sync + build fingerprint (run last)

OPTIONAL SECRETS ADDED IN v5.8.0
• GEMINI_IMAGE_MODEL (default gemini-2.5-flash-image), OPENAI_IMAGE_MODEL (default gpt-image-1)
  — used only with the Studio paid opt-in.

AI BRIDGE v5.3.2 — UNIFIED SELF-DIRECTED AGENT + RELIABLE JOB RECOVERY + MEDIA STUDIO

OVERVIEW

SELF-DIRECTED AI AGENT (v5.3.0)
• Dedicated Agent tab in the main mobile UI — it is no longer hidden only inside Team mode.
• Persistent local Agent conversation memory for follow-up tasks.
• Bounded autonomous loop with up to 4 tool/model steps per run.
• Read-only public web search with DuckDuckGo and Bing RSS fallback.
• Read-only fetching of specific public HTTPS pages.
• AI Bridge owns the Agent loop and automatically routes each structured decision through the connected provider pool with fallback.
• Subtask delegation prefers a different model from the controller for a real second opinion.
• Before a final answer, another connected AI can independently verify the draft; Gemini can revise it when the verifier finds a concrete problem.
• Can use current photos plus Files/ZIP project context.
• Live Agent phases, visible tool trace, and resumable jobs after a connection drop.
• External write/destructive actions are intentionally not implemented: no form submission, login, purchase, deletion, email sending, shell, or arbitrary code execution.

MOBILE UI / LANGUAGES
• Camera, Photo and Voice are rounded pill controls with SVG icons and clear pressed/listening states.
• Image previews use rounded cards with remove controls.
• Header language picker sits beside Refresh and persists the selected language in localStorage.
• Included UI languages: Ukrainian, English, Russian, Polish, Spanish, French, German, Portuguese.
• Speech recognition automatically follows the selected interface language on supported browsers.

AI Bridge is a Cloudflare Pages/Workers gateway with:
• a private browser Work Controller at /work/
• a remote MCP endpoint at /mcp for ChatGPT custom apps
• OAuth 2.1 Authorization Code + PKCE S256
• independent review tools backed by configured external AI providers
• provider API keys can be stored as Cloudflare Secrets or as an encrypted HttpOnly mobile override on the authorized device

MCP PROTOCOL
• HTTPS endpoint: /mcp
• Streamable HTTP / JSON-RPC
• Modern stateless revision: 2026-07-28
  - per-request protocolVersion + clientCapabilities metadata
  - required Mcp-Method / Mcp-Name routing headers
  - server/discover
  - resultType on responses
  - ttlMs/cacheScope on cacheable list/discovery results
• Legacy compatibility: 2025-11-25, 2025-06-18, 2025-03-26
• OAuth protected-resource and authorization-server metadata included

MCP TOOLS
1. get_review_panel_status
   Reports Review Panel readiness without provider calls.
2. review_task
   Independent second opinion on a user-selected task or plan.
3. review_code
   Independent code, architecture, implementation, or security review.
4. review_project_files
   Reviews user-selected text/code/ZIP project attachments within bounded extraction limits.

OAUTH
This deployment is designed as a private one-user Bridge unless PUBLIC_PLUGIN_MODE is explicitly enabled.

Work Controller reliability (v4.9.3): `/api/work/provider-stream` runs each free provider as an idempotent background job and streams provider attempt, retry, wait-time and terminal events. `/api/work/provider-status?jobId=...` recovers its status after a connection drop. Bind `AI_BRIDGE_JOBS` for cross-isolate job-record recovery; execution remains bounded and the API reports `durable:false`.
The Bridge login asks only for BRIDGE_ACCESS_TOKEN. Provider API keys can optionally be entered in the authenticated phone setup UI; they are encrypted server-side into an HttpOnly Secure cookie and are never returned to JavaScript after Save.

The authorization flow:
1. ChatGPT discovers /.well-known/oauth-protected-resource
2. ChatGPT discovers /.well-known/oauth-authorization-server
3. Authorization Code + PKCE S256
4. Discovery advertises offline_access and the server issues rotating refresh tokens
5. /mcp validates the signed access token on every authenticated call

If OAUTH_SIGNING_SECRET is not set, changing BRIDGE_ACCESS_TOKEN invalidates previously signed Bridge OAuth tokens. If OAUTH_SIGNING_SECRET is set, rotate that signing secret to invalidate them.
Optional hardening secret: OAUTH_SIGNING_SECRET.
For public-plugin mode, configure OAUTH_REPLAY_DO as documented in OAUTH_REPLAY_DO_SETUP.txt.

CLOUDFLARE SECRETS
Required:
BRIDGE_ACCESS_TOKEN
SESSION_SIGNING_SECRET (recommended; dedicated browser-session signing key)
PROVIDER_VAULT_SECRET (recommended; dedicated mobile provider-token vault key)

At least one provider API key for substantive AI requests:
ANTHROPIC_API_KEY
GOOGLE_API_KEY (Gemini; GEMINI_API_KEY and GOOGLE_GENAI_API_KEY are also accepted aliases)
XAI_API_KEY
GROQ_API_KEY
OPENROUTER_API_KEY
OPENAI_API_KEY (optional)
FAL_KEY (optional; enables fal.ai image fallback plus AI Studio video generation/editing)

Optional model overrides:
ANTHROPIC_MODEL
GEMINI_MODEL
XAI_MODEL
GROQ_MODEL
OPENROUTER_MODEL
OPENAI_MODEL

DEPLOY
1. Upload all root files to a Cloudflare Pages project. _worker.js MUST be included.
2. Add BRIDGE_ACCESS_TOKEN as a Cloudflare Secret. Provider API keys may also remain Cloudflare Secrets, or you can paste/replace/delete per-provider mobile tokens from the authenticated phone setup UI.
3. Optional: add a Workers AI binding named AI only for Cloudflare-hosted Photo AI. Agent Plan works with the already connected text providers and does not require Workers AI.
4. (Recommended, optional) Bind a KV namespace named AI_BRIDGE_JOBS -- see
   "RESUMABLE JOB LIFECYCLE (v4.9.2)" below for exactly what this does and
   does not guarantee, and how to create/bind it.
5. Deploy/redeploy.
5. Open the pages.dev URL and enter BRIDGE_ACCESS_TOKEN in the UI.
6. Use “Перевірити Connector” to validate Bridge status + OAuth metadata.
7. Use “Перевірити Free AI реальним API-викликом” to verify that the configured Gemini/Groq/OpenRouter keys, models and quota actually work. KEY SET alone is not treated as provider health.

RESUMABLE JOB LIFECYCLE (v4.9.2)
Root cause fixed in this version: the AI Team run used to be tied to one
HTTP connection. A dropped mobile connection (Safari/5G) actually killed
the in-flight run, even though the old UI text claimed otherwise. As of
v4.9.2, every AI Team run is a durable job:
  submit -> jobId -> processing (kept alive via ctx.waitUntil, independent
  of any single client connection) -> GET /api/job/status -> result/error.
/api/run-stream still streams live progress (NDJSON) for a connected
client, but it is now only a convenience relay: closing that connection
never stops the job.

WHAT WORKS WITHOUT AI_BRIDGE_JOBS (no extra setup needed):
- A dropped connection within the SAME Cloudflare Worker isolate does not
  kill the job -- ctx.waitUntil() keeps it running, and the in-memory job
  map answers /api/job/status for as long as that isolate is alive.
- Duplicate/retried Send with the same clientRequestId never re-runs the
  AI providers a second time (in-memory idempotency is a true atomic
  check-and-set within one isolate).
- Every acceptance scenario that stays on the SAME isolate/edge location
  (the common case for one phone reconnecting quickly) works today with
  zero additional Cloudflare configuration.

WHAT IS **NOT** GUARANTEED WITHOUT AI_BRIDGE_JOBS:
- Cloudflare can evict or recycle a Worker isolate at any time, and a
  reconnect can be served by a different edge location entirely. Neither
  case is guaranteed to still have the in-memory job record. In that case
  /api/job/status returns 404 "unknown" and the client cannot recover the
  result -- it is not silently wrong, it is honestly reported
  (jobsDurable:false in every response), but it is not durable.
- Do not describe the in-memory fallback as "durable" or "guaranteed" in
  any product copy. It is best-effort, same-isolate only.

TO KEEP JOB RECORDS ACROSS ISOLATES (best effort while execution remains
bounded by waitUntil), bind a Workers KV namespace:
  1. Cloudflare dashboard -> Workers & Pages -> KV -> Create a namespace.
     Name it ai-bridge-jobs (the namespace's own name can be anything; only
     the BINDING name below matters to the code).
  2. Open your AI Bridge Pages project -> Settings -> Functions ->
     KV namespace bindings -> Add binding.
     Variable name (binding):  AI_BRIDGE_JOBS
     KV namespace:             the namespace created in step 1.
  3. Save, then redeploy (or trigger a new deployment) so the binding takes
     effect -- Pages bindings apply to the next deployment, not the
     currently live one.
  4. Confirm it took effect: GET /api/status (authenticated) reports
     "jobsPersistent": true, "jobsDurable": false, and
     "jobRecovery": "kv-records-best-effort".
No code changes are required once the binding exists -- _worker.js detects
AI_BRIDGE_JOBS at request time and stores job records automatically. KV cannot
checkpoint a partly completed runTeam() call or guarantee that a provider call
will not repeat after a Worker restart. For that, integrate Cloudflare Workflows
with independently persisted steps and an idempotent provider strategy.

EXECUTION LIMITS (read before assuming "waitUntil" means "run forever"):
ctx.waitUntil() extends a Worker invocation's lifetime, but Cloudflare
still caps total CPU/wall time per invocation depending on your plan
(materially different between the free tier and paid plans, and subject to
change -- check your current Cloudflare Workers limits documentation
rather than assuming a fixed number here). This project's AI Team runs
stay well inside those limits because every provider call already has its
own timeout/retry ceiling (see withRetry/RETRY_DELAY_CAP_MS in
_worker.js). If a future change needs a single job to legitimately run
longer than your plan's waitUntil ceiling, waitUntil is the WRONG
architecture for that -- the correct fix is an external queue (Cloudflare
Queues) or a Durable Object with its own alarm() to checkpoint/resume the
work, not a longer waitUntil.

CONNECT TO CHATGPT (CURRENT UI)
1. Use ChatGPT on the web.
2. Custom MCP app creation currently requires ChatGPT Business or Enterprise/Edu with the needed workspace permissions. ChatGPT Plus can still use AI Bridge directly as a web app, but cannot currently create this custom MCP app.
3. Open Settings / Workspace Settings → Apps → Create.
4. Enter https://YOUR-PROJECT.pages.dev/mcp and select OAuth.
5. Click Scan tools and complete the AI Bridge authorization prompt with BRIDGE_ACCESS_TOKEN.
6. Create the app after the four Review Panel tools are discovered.

IMPORTANT
• Creating this ZIP does not install or authorize the app in ChatGPT; the user must explicitly connect it.
• Custom MCP app availability and write/full-MCP capabilities depend on ChatGPT plan/workspace policy.
• Provider status means a key is configured, not that quota/billing/model access is guaranteed.
• Review tools send the user-selected task content to external AI APIs and can consume provider quota.

FILE TOOL SECURITY
The file-review tool accepts HTTPS download URLs, blocks obvious localhost/private-network targets, limits downloads, bounds ZIP entries/decompressed bytes/compression ratio, skips common dependency/build folders, and extracts only supported readable text/code.

TOKEN STORAGE
BRIDGE_ACCESS_TOKEN is exchanged for an HttpOnly + Secure + SameSite=Strict HMAC-signed browser session token; the cookie does not contain the raw Bridge token, and the raw Bridge token is not persisted in localStorage/sessionStorage. Set SESSION_SIGNING_SECRET as a dedicated Cloudflare Secret when possible; otherwise the Worker safely falls back to OAUTH_SIGNING_SECRET or BRIDGE_ACCESS_TOKEN only as signing key material. Legacy browser token storage is cleared. Per-provider mobile tokens are AES-GCM encrypted server-side and stored only inside an HttpOnly Secure cookie for that device; the plaintext provider token is never returned to JavaScript after Save. Set PROVIDER_VAULT_SECRET as a dedicated Cloudflare Secret when possible. v4.9.5 can still decrypt legacy vault cookies using the previous fallback secrets during migration.


v2.2 NOTE
Provider status means the API key is configured. A real API call can still fail because of model access, billing, quota, or provider-side errors. v2.2 preserves and displays per-provider API errors for diagnosis.
Mobile provider tokens apply to browser requests from that device. External MCP/ChatGPT clients do not receive the device cookie, so use Cloudflare Secrets for provider credentials that must also work through external connectors.

V2.4 FREE TEAM
• Kimi support removed from the active provider list.
• Added Groq Free using GROQ_API_KEY and default model openai/gpt-oss-120b.
• Added OpenRouter Free using OPENROUTER_API_KEY and default model openrouter/free.
• Auto mode is Free-first: Gemini, Groq Free, OpenRouter Free are preferred.
• Ordinary Auto chat is reliability-first: preferred free providers race, the first valid answer wins, and slower requests are cancelled.
• If all free providers fail, OpenAI/Claude/Grok can rescue the request only when the user explicitly selected that paid provider in the UI.
• Ordinary greetings and chat prompts use the real selected AI provider path; there is no fake local greeting response.
• Existing KIMI_API_KEY in Cloudflare can simply be deleted; v2.4 ignores it.


V3 PUBLIC PLUGIN SURFACE
The public MCP surface is no longer a generic AI-provider connector. It exposes four focused Review Panel tools: status, task review, code review, and attached-project review. Public review calls use only Gemini, Groq Free, and OpenRouter Free and return a structured second-opinion result. Provider selection and single-provider passthrough are not exposed publicly.

Set PUBLIC_PLUGIN_MODE=1 only when you are ready for the /mcp endpoint to be publicly callable.


V3.1 SUPPORT CONTACT
Public support URL: https://aibridge-aff.pages.dev/support.html
Published support email: aibridge.support@gmail.com
SUPPORT_EMAIL remains optional as an override; the public page no longer depends on it.


V3.3 WORK CONTROLLER
Open /work for the deterministic ChatGPT Work control surface.
• Uses only Gemini, Groq Free and OpenRouter Free.
• Never calls paid OpenAI, Claude or xAI Grok from Work Controller.
• Sends tasks in parallel, shows exact per-provider results/errors, synthesizes with a successful free provider, and can retry only failed providers.
• BRIDGE_ACCESS_TOKEN remains required.


V4.7.0 RELIABILITY HARDENING
• Rebuilt ordinary Auto chat around first-success provider racing instead of waiting for a fragile multi-model synthesis on every prompt.
• Greetings use the real configured provider path; client/runtime regressions are covered by browser/API smoke tests instead of a fake local greeting responder.
• Added Gemini secret aliases: GEMINI_API_KEY and GOOGLE_GENAI_API_KEY.
• Added model compatibility fallbacks for current stable Gemini/Groq/OpenAI/Claude/xAI model families, used only when the configured model itself is rejected/unavailable.
• Updated Groq GPT-OSS requests to max_completion_tokens with include_reasoning=false and low reasoning effort.
• Added robust OpenAI-compatible content extraction for string/array response shapes.
• Linked caller cancellation to in-flight provider fetches.
• Provider failures now carry classified error kinds and redact configured secrets before reaching the browser.
• Browser error handling now preserves useful HTTP/provider diagnostics even when an upstream/proxy response is not JSON.
• Removed brittle response-length thresholds that could reject correct concise answers.


V4.8.8 VERIFIED FILE AUDITS
• Auto audits/reviews of code ZIPs no longer trust the first model answer. Two independent reviewers are used when available and findings pass through a source-grounded Judge.
• The Judge must classify each claim as supported, unsupported, or uncertain after actively checking counterevidence.
• JavaScript undefined/ReferenceError claims are guarded against the common false positive where a top-level function declaration exists later in the file (function declarations are hoisted).
• Main mobile ZIP ingestion no longer chops every source file at the first 70k characters. Important source files can contribute up to 180k characters; oversized files preserve head + middle + tail samples and mark truncation explicitly.
• Source/config files are prioritized above changelogs so the limited model context is spent on code rather than release notes.
• Only source-supported actionable defects/risks are shown as findings. Unsupported/uncertain hypotheses are counted but hidden from the defect list; positive/neutral observations are filtered out.


V4.8.9 AUDIT REPORT CLARITY
• Final audit findings contain only source-supported actionable defects/risks.
• Unsupported/uncertain hypotheses are summarized by count instead of being displayed as defects.
• Positive controls and neutral observations are excluded from defect findings.
• A zero-confirmed-defect result explicitly states that this does not prove the project is perfect; it means the available evidence did not justify a confirmed defect.

V4.9.0 MOBILE STREAMING RELIABILITY
- Long Chat/Files runs use /api/run-stream (NDJSON). The Worker emits an immediate start event and heartbeats every 8 seconds so mobile Safari/5G does not see a long silent HTTP request.
- The browser consumes streamed events and shows elapsed connection progress. Legacy /api/run remains as a compatibility fallback only if streaming cannot start.
- Generic Safari `Load failed` is never shown raw to the user.

V4.9.1 STATUS TRUTH FIX
- Fixed the v4.9.0 client-side refreshStatus ReferenceError (`run.status` -> `r.status`) that could falsely show "Bridge offline" and zero AI providers after a successful AI run.
- Status refresh now preserves known-good provider state during transient probe failures.
- Successful AI responses immediately mark the Bridge path online and trigger a background status reconciliation.


V4.9.5 SESSION / PACKAGE HARDENING
• /work/ is byte-for-byte synchronized with work.html so live routing cannot show stale token-storage instructions.
• Browser login no longer puts BRIDGE_ACCESS_TOKEN itself into ai_bridge_session. Login issues a 14-day HMAC-signed session token.
• Existing v4.9.4 raw-token browser sessions are intentionally rejected after upgrade; sign in once again.
• SESSION_SIGNING_SECRET is supported as a dedicated signing secret, with OAUTH_SIGNING_SECRET / BRIDGE_ACCESS_TOKEN fallback for backwards-compatible deployment.
• PROVIDER_VAULT_SECRET is supported as the preferred AES-GCM vault secret. Legacy vault cookies can still be decrypted during migration.
• Cross-origin session login/logout mutations are blocked.




V5.0.2 MULTIMODAL TASK COMPOSER
- Chat composer now has Camera, Photo, and Voice controls.
- Camera opens the mobile rear-camera capture flow; Photo selects existing images.
- Up to 4 photos are resized/compressed locally before Send and previewed with remove controls.
- Images are only transmitted when the user presses Send. Image tasks route to configured vision-capable providers: Gemini, OpenAI, Claude, or Grok.
- Voice input uses browser SpeechRecognition/webkitSpeechRecognition when available and writes recognized speech into the task textarea; it never auto-sends.
- If web speech recognition is unavailable, the UI tells iPhone users to use keyboard dictation instead.

V5.0.1 INTERACTION POLISH
- The large + button in Files opens the native file picker, the same as “Вибрати файли”.
- File-picker controls show a visible pressed state.
- The header refresh control visibly spins, checks for a newer service worker, and reloads the site.
- Refresh feedback is intentionally visible before reload so taps never feel ignored on iPhone.

V5.0.0 EXPERIENCE / DESIGN SYSTEM
• Rebuilt the private PWA around a mobile-first orchestration workspace while preserving all existing routes and stable DOM ids used by runtime code.
• Increased primary mobile typography and touch targets; removed legacy 7–9 px critical UI text.
• Added a clearer provider/status layer, higher-contrast composer, larger final-answer surface, and horizontal peer-response comparison.
• Unified /work and the public Review/Privacy/Terms/Support pages under the same AI Bridge visual system.
• Updated the ChatGPT connector note for current Business/Enterprise/Edu full-MCP availability and Pro read/fetch developer-mode support.
• Service worker now precaches the complete core UI asset set while keeping network-first behavior for normal navigation and bypassing all sensitive API/OAuth/MCP routes.


V5.1.0 SINGLE AI + MEDIA STUDIO
- Single AI now requires exactly one configured provider and never silently substitutes another model.
- Billing/quota failures are classified separately from temporary rate limits.
- Optional AI Studio supports image generation/editing plus fal.ai video generation/editing.
- fal.ai actions are allowlisted: Nano Banana 2 photo generation/editing, Pika 2.2 image/text-to-video, and Wan 2.7 instruction-based short-video editing.
- Browser never receives FAL_KEY; long fal.ai media jobs use queue submit/status/result APIs through the Worker.

V5.1.1 CLOUDFLARE IMAGE FALLBACK
- Photo AI and Create Image prefer a Cloudflare Workers AI binding named AI using FLUX.2 klein 4B.
- Cloudflare image generation/editing runs server-side through env.AI and never exposes a Cloudflare API token to the browser.
- If Workers AI is missing or temporarily fails, image requests can automatically fall back to fal.ai when FAL_KEY is configured.
- The browser sends media only after the user presses Run AI Studio. For photo edit, a <=500px reference is prepared for Workers AI while the original is retained for fal.ai fallback.
- Video generation/editing still uses fal.ai and requires available fal.ai credits.
- See WORKERS_AI_SETUP.txt for the one-time Pages binding setup.


v5.1.2 FREE-FIRST STUDIO
- Add a Workers AI binding named AI for free-quota image generation/editing.
- Studio does NOT call fal.ai unless the user explicitly enables Advanced paid fallback.
- Studio voice dictation writes directly into the image prompt.
- Free Motion runs locally with no provider or credits.


UNIFIED v5.3.0 NOTES
- Combines the dedicated self-directed Agent branch with the stronger v5.1.4/v5.1.5 job recovery and Cloudflare Workers AI REST fallback branch.
- AI Bridge remains the controller of the goal, state, tools, limits and stopping policy; connected models only return one structured next-action proposal.
- Agent Core transport order: optional Workers AI binding/REST -> connected provider router with automatic failover.
- Job recovery supports clientRequestId lookup, propagation grace, retryable claim loss, same-isolate job shadowing, and UTF-8 byte-safe persistence limits.
- See CHANGELOG_v5_3_0.txt and WORKERS_AI_SETUP.txt.


v5.3.2 AGENT IMAGE ENGINE
The self-directed Agent can generate images through its own internal Workers AI image tool. External helper AIs and fal.ai are not used for Agent image generation.
