import fs from "node:fs";
import path from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function text(f){return fs.readFileSync(path.join(root,f),"utf8")}
function ok(c,msg){if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)}

const html=text("index.html"),css=text("styles.css"),app=text("app.js"),sw=text("sw.js"),meta=JSON.parse(text("bridge-version.json"));
ok(/^5\.(?:[1-9]\d*\.\d+|0\.(?:[3-9]|\d{2,}))$/.test(meta.version),"release is v5.0.3 or later");
ok(html.includes('id="languageSelect"')&&html.includes('id="languageCode"'),"header has language picker beside refresh controls");
ok(html.indexOf('id="languageSelect"')<html.indexOf('id="statusRefreshBtn"'),"language picker is immediately before refresh button");
ok(html.includes('src="i18n.js"')&&html.indexOf('src="i18n.js"')<html.indexOf('src="app.js'),"i18n runtime loads before app.js");
ok(sw.includes('"./i18n.js"'),"service worker precaches i18n runtime");
ok(html.includes('id="cameraBtn" class="composerToolBtn cameraTool"')&&html.includes('id="photoBtn" class="composerToolBtn photoTool"')&&html.includes('id="voiceBtn" class="composerToolBtn voiceTool"'),"camera/photo/voice use the new unified controls");
ok(!html.includes('>📷</span>')&&!html.includes('>▣</span>')&&!html.includes('>●</span>'),"old emoji/square/dot media icons are removed");
ok((html.match(/<svg viewBox="0 0 24 24">/g)||[]).length>=3,"media controls use consistent SVG icons");
// D1 (хвиля 1): токенізація — border-radius:999px став var(--radius-pill); намір тесту незмінний:
// обчислене значення лишається 999px (доведено фінгерпринтом декларацій).
const rPill=(css.match(/--radius-pill\s*:\s*([^;}]+)/)||[])[1]||"";
ok(/\.composerToolBtn\{[^}]*(border-radius:999px|border-radius:var\(--radius-pill\))/.test(css)&&rPill.trim()==="999px","media controls are fully pill-rounded");
ok(/\.imagePreviewCard\{[^}]*border-radius:24px/.test(css),"image preview cards are strongly rounded");
ok(css.includes('.languageControl')&&css.includes('.languageSelect'),"language picker has dedicated touch styling");
ok(app.includes('I18N?.voiceLocale?.()'),"voice recognition follows selected UI language");
ok(app.includes('aibridge:languagechange'),"app rerenders dynamic UI when language changes");

const memory=new Map();
Object.defineProperty(globalThis,"navigator",{value:{language:"uk-UA"},configurable:true});
globalThis.localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v))};
globalThis.document={documentElement:{lang:""},querySelectorAll:()=>[],getElementById:()=>null};
globalThis.window={dispatchEvent:()=>{}};
globalThis.CustomEvent=class{constructor(type,init){this.type=type;this.detail=init?.detail}};
await import(pathToFileURL(path.join(root,"i18n.js")).href+"?t="+Date.now());
const i18n=globalThis.AIBridgeI18n;
ok(!!i18n,"i18n runtime exports public helper");
const langs=Object.keys(i18n.LANGUAGES);
ok(langs.length===8&&["uk","en","ru","pl","es","fr","de","pt"].every(x=>langs.includes(x)),"eight practical languages are included");
for(const lang of langs){i18n.setLanguage(lang);ok(i18n.getLanguage()===lang,`language switches to ${lang}`);ok(i18n.locale()&&i18n.voiceLocale(),`${lang} has UI/date and voice locale`)}
i18n.setLanguage("pl");
ok(memory.get("ai_bridge_lang")==="pl","selected language persists on device");
ok(i18n.t("camera")==="Aparat"&&i18n.t("voice")==="Głos","Polish UI pack resolves media controls");
i18n.setLanguage("uk");
ok(i18n.t("camera")==="Камера"&&i18n.t("voiceListening")==="Слухаю…","Ukrainian UI remains native");
console.log("AI Bridge v5.0.3 multilingual UI tests passed.");
