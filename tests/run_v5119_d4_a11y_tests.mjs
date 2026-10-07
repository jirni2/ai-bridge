/* D4: навігація і доступність (v5.11.8, хвиля 2).
   Перевіряє: права колонка-меню (drawer) по «···»; ≤5 вкладок на телефоні;
   пункти меню і кнопки ≥44px; aria-label українською; Escape/тап/свайп
   закривають меню; видимий фокус; --muted-2 ≥4.5:1 в обох темах;
   без дублювання пунктів між вкладками і колонкою. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const css=fs.readFileSync(path.join(root,"styles.css"),"utf8");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const js=fs.readFileSync(path.join(root,"app.js"),"utf8");
const i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");

// --- 1. Drawer існує і відкривається з вкладки «Більше» ---
ok(html.includes('id="navDrawer"'),"index.html: #navDrawer існує");
ok(/id="navDrawer"[^>]*role="dialog"/.test(html)||/role="dialog"[^>]*id="navDrawer"/.test(html),"#navDrawer має role=dialog");
/* 2026-10-03 (Сергій, макет v2): верхня кнопка «···» повернута в топбар.
   Намір (колонка-меню доступна) збережено: #navDrawerBtn і #moreTab → #navDrawer. */
ok(html.includes('id="navDrawerBtn"'),"верхня #navDrawerBtn («···») на місці");
ok(html.includes('id="moreTab"'),"вкладка «Більше» (#moreTab) існує");
ok(html.includes('aria-controls="navDrawer"'),"#moreTab вказує на #navDrawer");
ok(html.includes('class="sheet drawer hidden"')||html.includes('sheet drawer'),"#navDrawer — шторка-колонка (.sheet.drawer)");
ok(!html.includes('id="moreSheet"'),"старий #moreSheet видалено (без дублювання)");

// --- 2. ≤5 вкладок видно на телефоні ---
const tabs=[...html.matchAll(/<button class="tab[^"]*"[^>]*data-page="([^"]+)"/g)];
const visible=tabs.filter(m=>!/navExtra/.test(m[0]));
ok(visible.length<=4,"на телефоні видно ≤4 вкладки сторінок (решта — у меню)");
const phoneTabs=[...html.matchAll(/<button class="tab[^>]*>/g)].filter(m=>!/navExtra/.test(m[0]));
ok(phoneTabs.length===5,"на телефоні рівно 5 елементів навігації (4 вкладки + «Більше»): "+phoneTabs.length);

// --- 3. Без дублювання: пункти колонки ≠ видимі вкладки ---
const drawerPages=[...html.matchAll(/data-more-page="([^"]+)"/g)].map(m=>m[1]);
const visPages=visible.map(m=>m[1]);
const dup=drawerPages.filter(p=>visPages.includes(p));
ok(dup.length===0,"пункти колонки не дублюють видимі вкладки: "+(dup.join(",")||"ок"));
ok(drawerPages.includes("crew"),"«Команда агентів» (crew) — у колонці-меню");

// --- 4. Розміри ≥44px ---
const px=(re)=>{const m=css.match(re);return m?parseFloat(m[1]):null};
ok(px(/\.tab\{[^}]*min-height:(\d+)px/)>=44,".tab ≥44px по висоті");
ok(px(/\.roundBtn\{[^}]*min-width:(\d+)px/)>=44&&px(/\.roundBtn\{[^}]*height:(\d+)px/)>=44,".roundBtn ≥44×44px");
ok(px(/\.tinyBtn\{[^}]*min-height:(\d+)px/)>=44,".tinyBtn ≥44px по висоті");
ok(px(/\.drawerItem\{[^}]*min-height:(\d+)px/)>=44,".drawerItem ≥44px по висоті");

// --- 5. Ширина колонки ≤80% екрана ---
ok(/\.sheet\.drawer \.sheetPanel\{[^}]*width:min\(320px,80%\)/.test(css),"ширина колонки min(320px,80%)");
ok(/\.sheet\.drawer \.sheetPanel\{[^}]*max-width:80%/.test(css),"max-width колонки 80%");

// --- 6. Закриття: Escape, тап поза колонкою, свайп вправо ---
ok(/\.sheet:not\(\.hidden\)/.test(js)&&/Escape/.test(js),"Escape закриває всі відкриті шторки (колонка має .sheet)");
ok(html.includes('class="sheetBackdrop" data-sheet-close')||/navDrawer[\s\S]{0,400}data-sheet-close/.test(html),"тап поза колонкою закриває її (backdrop data-sheet-close)");
ok(js.includes('closeSheet("navDrawer")'),"showPage() закриває колонку");
ok(/touchstart[\s\S]{0,600}touchend[\s\S]{0,200}closeSheet\("navDrawer"\)/.test(js),"свайп вправо закриває колонку");
ok(js.includes('openSheet("navDrawer")'),"«···» і «Більше» відкривають колонку");

// --- 7. aria-label українською (uk-пак = EN + усі uk-фрагменти) ---
const ukFrags=[...i18n.matchAll(/^  uk:\{/gm)].map(m=>{
  const s0=i18n.indexOf("{",m.index);let d=0,k=s0;
  for(;k<i18n.length;k++){const c=i18n[k];if(c==="{")d++;else if(c==="}"){d--;if(!d)break}}
  return i18n.slice(s0,k+1);
});
const ukHas=key=>ukFrags.some(f=>new RegExp("\\b"+key+':"[^"]+"').test(f));
for(const k of ["navChat","navTeam","navCrew","navFiles","navHistory","navBrain","navAgent","navConnect","navStudio","navMore","navMenu","navMenuBtn","closeMenu"])
  ok(ukHas(k),"uk: "+k+" присутній");
const tabAria=[...html.matchAll(/<button class="tab[^>]*>/g)];
ok(tabAria.every(b=>/data-i18n-aria="nav\w+"|aria-label="/.test(b[0])),"усі вкладки мають aria (data-i18n-aria)");
const drawerBtns=[...html.matchAll(/class="drawerItem"[^>]*>/g)];
ok(drawerBtns.length>=6&&drawerBtns.every(b=>/data-i18n-aria="[^"]+"|aria-label="[^"]+"/.test(b[0])),"усі пункти колонки мають aria-label ("+drawerBtns.length+")");
// без російської у нових рядках колонки
const drawerHtml=html.slice(html.indexOf('id="navDrawer"'),html.indexOf('id="roleSheet"'));
ok(!/[ыэъЁ]/u.test(drawerHtml),"у колонці-меню немає російських літер");

// --- 8. Видимий фокус клавіатури ---
ok(/:focus-visible\{[^}]*outline:/.test(css),"є видима рамка фокусу (:focus-visible з outline)");

// --- 9. --muted-2 контраст ≥4.5:1 в обох темах ---
const lum=h=>{h=h.replace("#","");const c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
const darkM2=(css.match(/--text:#f5f5f7;--text-soft:#c9c9cf;--muted:#a1a1a6;--muted-2:(#[0-9a-f]{6})/)||[])[1];
const lightM2=(css.match(/--text:#131316;--text-soft:#33333a;--muted:#5c5c64;--muted-2:(#[0-9a-f]{6})/)||[])[1];
ok(darkM2&&cr(darkM2,"#0b0b0d")>=4.5,`--muted-2 темна ${darkM2}: ${cr(darkM2,"#0b0b0d").toFixed(2)}:1 ≥4.5`);
ok(lightM2&&cr(lightM2,"#f7f7f8")>=4.5,`--muted-2 світла ${lightM2}: ${cr(lightM2,"#f7f7f8").toFixed(2)}:1 ≥4.5`);

console.log("\nD4 a11y: усі перевірки пройдено.");
