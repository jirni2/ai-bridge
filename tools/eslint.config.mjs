/* AI Bridge ESLint flat config (v5.11.94).
   Гейт релізу: no-undef, no-const-assign, no-dupe-keys, no-redeclare.
   Додано за аудитом v5.11.93: 4/5 знайдених вручну помилок ловляться цими
   правилами за секунду (safeRenderScrollFab, markSendOutcome, locale(),
   SMART_REPLY_CACHE=, showPage).
   Клієнтські скрипти — окремі classic scripts (sourceType: script);
   міжфайлові глобали (BridgeCore з core.js → app.js) оголошені явно.
   _worker.js — ES-модуль Cloudflare Workers (sourceType: module). */
import globals from "globals";

const clientRules = {
  "no-undef": "error",
  "no-const-assign": "error",
  "no-dupe-keys": "error",
  "no-redeclare": "error",
};

export default [
  {
    // core.js: визначає BridgeCore сам + UMD-експорт для Node-тестів
    files: ["core.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {...globals.browser, module: "readonly"},
    },
    rules: clientRules,
  },
  {
    // Клієнт: окремі classic scripts, завантажуються в index.html по черзі
    files: ["app.js", "crew.js", "markdown.js", "theme-boot.js", "zip-safety-core.js", "dtc-data.js", "oauth-replay-do.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        BridgeCore: "readonly", // core.js завантажується раніше app.js (index.html)
      },
    },
    rules: clientRules,
  },
  {
    // Cloudflare Worker — ES-модуль
    files: ["_worker.js", "oauth-replay-do.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {...globals.worker},
    },
    rules: clientRules,
  },
  {
    // Тести та інструменти — Node-модулі
    files: ["tests/**/*.mjs", "tools/**/*.mjs", "backtests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {...globals.node},
    },
    rules: clientRules,
  },
];
