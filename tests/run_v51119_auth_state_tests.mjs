/* v5.11.19 — стан авторизації видно одразу і назавжди.
   v5.11.22 — ВИПРАВЛЕННЯ БАГА: setupRequired (сервер без токена) більше НЕ
   малює зелене «Авторизовано»; зелене — тільки після підтвердженого сервером
   входу. Галочку прибрано: просто «Авторизовано». */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),css=R("styles.css"),i18n=R("i18n.js"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. renderAuthState --- */
ok(/function renderAuthState\(ok\)/.test(app),"renderAuthState існує");
ok(/btn\.classList\.toggle\("authorized",!!ok\)/.test(app),"кнопка отримує/втрачає клас authorized");
ok(/btn\.textContent=ok\?t\("deviceAuthorized"\):t\("authorizeDevice"\)/.test(app),"успіх → «Авторизовано» без галочки; нейтраль → «Підключити»");
ok(/inp\.classList\.toggle\("hidden",!!ok\)/.test(app),"поле токена ховається після входу");
ok(/forget\.classList\.toggle\("hidden",!ok\)/.test(app),"кнопка «забути» видна лише авторизованим");

/* --- 2. вхід без «мертвого» зникнення --- */
ok(!/setTimeout\(\(\)=>\$\("saveTokenBtn"\)\.textContent=t\("authorizeDevice"\),1200\)/.test(app),"немає повернення кнопки через 1.2с");
ok(/toast\(t\("deviceAuthorized"\),"ok"\)/.test(app),"успіх підтверджується тостом");
ok(/toast\(authFriendlyError\(e\),"bad"\)/.test(app),"помилка — помітним тостом, не дрібним статусом");
ok(/if\(!token\)\{toast\(t\("enterAccessToken"\),"bad"\)/.test(app),"порожній токен — тост-підказка");

/* --- 3. дружні помилки --- */
ok(/function authFriendlyError\(e\)/.test(app),"authFriendlyError існує");
ok(/not configured/i.test(app)&&/authNoServerToken/.test(app),"503 (токен не налаштовано на сервері) → зрозумілий текст");
ok(/authTooMany/.test(app),"429 → «забагато спроб»");
ok(/authBadToken/.test(app),"401 → «невірний токен»");

/* --- 4. стан підтягується при старті --- */
ok(/r\.status===401\)\{[^}]*?renderAuthState\(false\)/.test(app),"401 у refreshStatus → неавторизований стан");
ok(/j\.setupRequired\)\{[^}]*?renderAuthState\(false\)/.test(app),"setupRequired (сервер без токена) → НЕ зелений, нейтральний стан");
ok(!/j\.setupRequired\)\{\s*\n?\s*(\/\/[^\n]*\n\s*)?renderAuthState\(true\)/.test(app),"setupRequired більше не малює «Авторизоване»");
ok(/renderAuthState\(true\)/.test(app),"успішний статус → авторизований стан");

/* --- 5. i18n --- */
for(const k of ["authBadToken","authTooMany","authNoServerToken"]){
  ok(i18n.includes(k+':"'),`ключ ${k} у i18n`);
  ok(new RegExp(k+':"[^"]*[А-Яа-яІіЇїЄє]').test(i18n),`ключ ${k} має український текст`);
}
/* v5.11.22: жодних галочок у текстах авторизації */
ok(!/deviceAuthorized:"[^"]*✓/.test(i18n),"deviceAuthorized без ✓ у всіх локалях");
ok(/deviceAuthorized:"Авторизовано"/.test(i18n),'uk deviceAuthorized = «Авторизовано»');
ok(/deviceAuthorized:"Authorized"/.test(i18n),'en deviceAuthorized = «Authorized»');
ok(/authorizeDevice:"Підключити"/.test(i18n),'uk authorizeDevice = «Підключити»');
ok(/accessPlaceholder:"Введи токен авторизації"/.test(i18n),'uk accessPlaceholder = «Введи токен авторизації»');

/* --- 6. CSS --- */
ok(/#saveTokenBtn\.authorized\{[^}]*var\(--green\)/.test(css)&&!/#[0-9a-fA-F]{3,8}\b/.test(css.match(/#saveTokenBtn\.authorized\{[^}]*\}/)[0]),"зелений стиль авторизованої кнопки (тільки токени)");
ok(html.includes('id="saveTokenBtn"'),"кнопка в HTML на місці");

console.log(`\nPASS: ${passed} перевірок`);
