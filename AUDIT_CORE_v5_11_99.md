# AI Bridge v5.11.99 — deep core audit

Date: 2026-10-05

## Scope
Reviewed `core.js`, its v5.11.99 learning integration in `app.js`, worker/auth/team/scheduler surfaces relevant to core operation, version/build metadata, and targeted regression suites.

## Confirmed good
- `tests/run_v51199_core_learning_tests.mjs`: 70/70 after the added regression test.
- `tests/run_v51171_core_tests.mjs`: 49/49.
- v5.11.9x grouped run before the patch: 14/14 test files, 609 PASS lines, syntax 243/243.
- v5.11.8x grouped run before the patch: 9/9 test files, 319 PASS lines, syntax 243/243.
- auth/team grouped run before the patch: 4/4 test files, 212 PASS lines, syntax 243/243.
- Core learning rejects volatile/current questions, arithmetic auto-learning, number-mismatched retrieval, malformed memory, oversized QA entries, and automatic overwrite of user-taught answers.
- Core memory stays local in the normal UI learning path and the app excludes incognito/error/file/image/agent/context-contaminated runs from automatic learning.

## Fixed
### Stale JSON export version
`core.js` module 34 still exported analysis JSON with hard-coded version `5.11.72` although the package/core is `5.11.99`.

Fix: `EXPORT_VERSION` now references the top-level `VERSION` constant. Added a v5.11.99 regression assertion that `JSON.parse(C.exportJSON(...)).version === C.VERSION`.

Build fingerprint was regenerated and synced after the change.

## Remaining limitations / next AI
1. Run the entire regression suite with enough wall-clock time (`node tools/run-all-tests.mjs --json ...`). The environment used for this audit timed out on the complete suite; targeted high-value groups passed.
2. Install project dev dependencies and run the release ESLint gate. `node_modules/.bin/eslint` was not present in this extracted ZIP, so the configured lint gate could not be executed here.
3. Run Playwright/browser tests in an environment with Chromium available and ensure there are zero `SKIP:` lines. The release gate intentionally treats browser skips as blockers.
4. Run `node tools/release-check.mjs` with sufficient time after dependencies are installed. Do not claim RELEASE READY until the complete gate passes.
5. Deployment/infrastructure cannot be verified from this offline ZIP: Cloudflare bindings, KV/D1 persistence, scheduler cron deployment, secrets, production headers, and live provider behavior need a deployed-environment check.
6. Consider a future memory schema migration (`v:2` is currently fixed) only when the serialized shape actually changes; do not bump it merely to match app version.
7. Consider adding explicit tests for learned-answer usage counters (`uses`) persistence/ranking if `uses` is intended to affect eviction or retrieval in a future release. It is currently recorded/persisted but not used for ranking/eviction.

## Release note
This audit intentionally made a minimal, evidence-backed core fix rather than changing retrieval thresholds or learning heuristics that already have strong regression coverage. Those behavioral changes need dedicated A/B fixtures to avoid silent quality regressions.

## Gate re-run (second reviewer, 2026-10-05)

Run on this exact package after the EXPORT_VERSION fix:

- Full regression suite without the three trading files (`run_v5911_trade`, `run_v5912_auto_bot`, `run_v5111_sched`): 192/192 files PASS.
- ESLint (`no-undef`, `no-const-assign`, `no-dupe-keys` …) on core.js, app.js, crew.js, _worker.js: clean except the 4 known `BridgeCore` cross-file global reports in app.js.
- Playwright, iPhone 13 emulation: 18 pages, send, error path, all-providers-failed rescue, core learning from cloud answers, history training, data-map controls, offline — 0 page errors, no horizontal overflow.

Packaging defects found in the previous ZIP and fixed here:

- `MANIFEST.sha256.json` was not regenerated after the fix (4 stale hashes; `AUDIT_CORE_v5_11_99.md` not listed).
- `buildSha256` did not match the package contents (it was computed before this report file was added).
- Three temporary test artefacts were shipped (`tests/worker-v495-under-test.mjs`, two `tests/worker-v591-deadline-*.mjs`, ~2 MB).

Still NOT run (items 4–5 above remain open): the three trading test files, `tools/release-check.mjs` (it runs them), and any live Cloudflare check.
