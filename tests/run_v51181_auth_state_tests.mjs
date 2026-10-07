/* v5.11.81 regression tests: auth-state separation (audit fixes). */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const appJs=readFileSync(join(root,"app.js"),"utf8");
const crewJs=readFileSync(join(root,"crew.js"),"utf8");
const i18nJs=readFileSync(join(root,"i18n.js"),"utf8");

let pass=0,fail=0;
const ok=(cond,name)=>{if(cond){pass++;console.log(`  PASS ${name}`)}else{fail++;console.log(`  FAIL ${name}`)}};

console.log("v5.11.81 auth-state regression tests:");

// 1. crew.js distinguishes 401 from network error
ok(crewJs.includes('lastRefreshState="need-login"'),"crew.js tracks need-login state");
ok(crewJs.includes('t("crewNeedLogin")'),"crew.js shows crewNeedLogin on 401");
ok(crewJs.includes('[data-goto-auth]'),"crew.js has go-to-auth button");
ok(crewJs.includes('e&&e.name==="AbortError"'),"crew.js distinguishes timeout from network error");

// 2. app.js guards provider/connection rendering when unauthenticated
ok(appJs.includes('status.authState="need-login"'),"app.js sets authState need-login on 401");
ok(appJs.includes('authState:"network-error"'),"app.js sets authState network-error on fetch throw");
ok(appJs.includes('status.authState="authenticated"'),"app.js sets authState authenticated on success");
ok(appJs.includes('t("authStateUnknown")'),"app.js uses authStateUnknown for unauthenticated panels");
ok(appJs.includes('status.authState==="need-login"'),"renderProviders/renderConnections check needAuth");

// 3. Loading indicators terminate: crew api() has timeout
ok(crewJs.includes("AbortController"),"crew.js api() uses AbortController timeout");
ok(crewJs.includes("15000"),"crew.js api() timeout is 15s");

// 4. i18n keys exist in both en and uk
for(const k of ["authStateUnknown","crewNeedLogin","crewGoToLogin","binanceNeedLogin","studioEngineMissing"]){
  ok(i18nJs.includes(k+':"')||i18nJs.includes(k+':\u0022'),"i18n has key "+k);
}
ok(i18nJs.includes('authStateUnknown:"Невідомо — потрібен вхід"'),"uk authStateUnknown text");
ok(i18nJs.includes('crewNeedLogin:"Потрібен вхід — дані команди недоступні"'),"uk crewNeedLogin text");

// 5. Binance bot-ui.js: SKIPPED — trade/ is forbidden zone (see final report)
// Fix prepared but requires explicit authorization to touch trade/bot-ui.js

// 6. Studio: no longer advertises Workers AI as Free Mode
ok(!i18nJs.includes('Free Mode with Cloudflare Workers AI'),"en studioDesc no longer advertises Workers AI");
ok(!i18nJs.includes('Free Mode через Cloudflare Workers AI'),"uk studioDesc no longer advertises Workers AI");
ok(appJs.includes('t("studioEngineMissing")'),"updateStudioEngineInfo uses studioEngineMissing");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
