import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const ok=(v,msg)=>{if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)};
const meta=JSON.parse(read("bridge-version.json")),version=meta.version;
ok(/^5\./.test(version),"release remains on the v5 design line");
ok(read("_worker.js").includes(`const VERSION="${version}";`),"Worker version is synchronized");
ok(read("app.js").includes(`const UI_VERSION="${version}"`),"main UI version is synchronized");
ok(read("work-controller.js").includes(`const UI_VERSION="${version}"`),"Work Controller version is synchronized");
ok(read("work.html")===read("work/index.html"),"/work route and canonical Work page are byte-identical");
const css=read("styles.css");
// D3 (хвиля 2): стрічку карток замінено вкладками — намір тесту незмінний:
// відповіді моделей порівнюються в одному місці, тепер це .peerTabs/.peerTab.
ok(css.includes(".peerTabs")&&css.includes(".peerTab"),"peer AI responses use comparison tabs");
// D1 (хвиля 1): токенізація — font-size:16px став var(--fs-lg); намір тесту незмінний:
// обчислене значення для textarea лишається 16px (доведено фінгерпринтом декларацій).
const fsLg=(css.match(/--fs-lg\s*:\s*([^;}]+)/)||[])[1]||"";
ok(css.includes("textarea{resize:vertical;min-height:160px")&&(css.includes("font-size:16px")||(css.includes("font-size:var(--fs-lg)")&&fsLg.trim()==="16px")),"main composer uses readable phone typography");
ok(css.includes(".finalAnswer")&&css.includes("font-size:15.5px"),"final answer typography is readable");
ok(css.includes("min-height:50px")&&css.includes("--tap:44px"),"primary controls keep mobile-sized touch targets");
const index=read("index.html");
ok(index.includes("Порівняти відповіді окремих AI"),"comparison UX copy is present");
ok(index.includes("Pro може підключати MCP з read/fetch")&&index.includes("Business та Enterprise/Edu"),"ChatGPT connector guidance includes current plan split");
ok(index.includes("HttpOnly Secure cookie")&&index.includes("Cloudflare Secrets"),"Connections copy accurately distinguishes server and phone secrets");
for(const f of ["plugin.html","privacy.html","terms.html","support.html"]){ok(read(f).includes('href="/styles.css')&&read(f).includes('class="docShell"'),`${f} uses shared branded public design`)}
const sw=read("sw.js");
const m=sw.match(/const ASSETS=(\[[^;]+\]);/);ok(!!m,"service worker core asset list is parseable");
const assets=m?JSON.parse(m[1]):[];
for(const required of ["./index.html","./styles.css","./app.js","./zip-safety-core.js","./manifest.webmanifest","./icon-180.png","./icon-192.png","./icon-512.png"]){ok(assets.includes(required),`service worker precaches ${required}`)}
ok(sw.includes('u.pathname.startsWith("/api/")')&&sw.includes('u.pathname==="/mcp"'),"sensitive routes remain network-only");
const manifest=JSON.parse(read("manifest.webmanifest"));ok(manifest.short_name==="AI Bridge"&&manifest.theme_color==="#050812","PWA branding matches v5 design system");
ok(/^[a-f0-9]{64}$/.test(meta.buildSha256||""),"release has a concrete build fingerprint");
console.log("AI Bridge v5 design/packaging regression tests passed.");
