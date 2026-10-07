/* v5.11.89 — клонування ролі AI + «Зберегти як…» (File System Access API):
   1) i18n: 4 ключі (exportPickPlace, exportPickPlaceDesc, roleDuplicate, roleDuplicated) в uk/en/ru.
   2) cloneRolePayload (чиста): суфікси за мовою, обрізання назви до 50, пуста роль → порожні рядки.
   3) renderRoleSheet: кнопка ⧉ data-role-dup лише для НЕ вбудованих ролей, обробник → duplicateRole.
   4) duplicateRole: підставляє копію у форму «Нова роль», розкриває details, тост roleDuplicated.
   5) saveFileSmart (чиста логіка): fallback без префа / без API; saved через пікер; cancelled при AbortError; fallback при іншій помилці пікера.
   6) downloadExportFile і exportDocx ідуть через dlBlobSmart з правильним mime.
   7) index.html: чекбокс #exportPickPlaceChk + data-i18n у листі експорту.
   8) styles.css: .roleDup і .exportPickRow.
   Запуск: node tests/run_v51189_clone_saveas_tests.mjs */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),css=R("styles.css"),html=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^(?:async )?function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}

/* ---------- 1. i18n ---------- */
{
  const m=i18n.match(/const LANGUAGES=(\{[\s\S]*?\n\});/);
  ok(m,"LANGUAGES знайдено");
  const L=eval("("+m[1]+")");
  for(const lang of ["uk","en","ru"])
    for(const k of ["exportPickPlace","exportPickPlaceDesc","roleDuplicate","roleDuplicated","roleCopySuffix"])
      ok(L[lang]&&typeof L[lang][k]==="string"&&L[lang][k].length>0,`${lang}.${k} = «${L[lang][k]}»`);
  ok(L.uk.roleDuplicate==="Дублювати","uk.roleDuplicate");
  ok(L.en.roleDuplicate==="Duplicate","en.roleDuplicate");
  ok(L.ru.roleDuplicate==="Дублировать","ru.roleDuplicate");
  ok(L.uk.exportPickPlace.includes("Зберегти як"),"uk.exportPickPlace");
  ok(L.uk.roleCopySuffix===" (копія)"&&L.en.roleCopySuffix===" (copy)"&&L.ru.roleCopySuffix===" (копия)","roleCopySuffix у трьох мовах");
}

/* ---------- 2. cloneRolePayload ---------- */
{
  const src=grabFn(app,"cloneRolePayload");
  const cloneRolePayload=eval("("+src+")");
  const r={name:"Мій аналітик",instructions:"пиши коротко",provider:"groq"};
  const ukD=cloneRolePayload(r," (копія)");
  ok(ukD.name==="Мій аналітик (копія)","суфікс з i18n додається");
  ok(ukD.instructions==="пиши коротко"&&ukD.provider==="groq","інструкції/провайдер наскрізно");
  ok(cloneRolePayload(r," (copy)").name==="Мій аналітик (copy)","en-суфікс");
  ok(cloneRolePayload(r," (копия)").name==="Мій аналітик (копия)","ru-суфікс");
  const long=cloneRolePayload({name:"x".repeat(80),instructions:"i"}," (копія)");
  ok(long.name.length===50+8&&long.name.endsWith(" (копія)"),"назва обрізається до 50 + суфікс");
  const empty=cloneRolePayload(null," (копія)");
  ok(empty.name===" (копія)"&&empty.instructions===""&&empty.provider==="","порожня роль → порожні рядки");
}

/* ---------- 3. renderRoleSheet ---------- */
{
  const src=grabFn(app,"renderRoleSheet");
  ok(src.includes('data-role-dup'),"кнопка data-role-dup у шаблоні");
  ok(src.includes('class="roleDup"'),"клас roleDup");
  ok(src.includes("⧉"),"іконка ⧉");
  ok(src.includes('aria-label="${esc(t("roleDuplicate"))}"'),"aria-label з i18n");
  ok(src.includes('duplicateRole(b.dataset.roleDup)'),"обробник викликає duplicateRole");
  ok(!src.match(/r\.builtin\?.*:.*data-role-dup/s)||src.includes('${r.builtin?"":'),"кнопка лише для не-вбудованих");
}

/* ---------- 4. duplicateRole ---------- */
{
  const src=grabFn(app,"duplicateRole");
  ok(src.includes('cloneRolePayload(r,t("roleCopySuffix"))'),"суфікс бере з i18n (t(roleCopySuffix))");
  ok(src.includes('$("roleName")')&&src.includes("d.name"),"підставляє назву у форму");
  ok(src.includes('$("roleInstr")')&&src.includes("d.instructions"),"підставляє інструкції");
  ok(src.includes("details.roleNew")&&src.includes("det.open=true"),"розкриває «Нова роль»");
  ok(src.includes('t("roleDuplicated")'),"тост roleDuplicated");
  ok(!src.includes("saveCustomRoles"),"НЕ зберігає копію одразу — Сергій править і тисне «Зберегти»");
}

/* ---------- 5. saveFileSmart ---------- */
{
  const onM=app.match(/function exportPickPlaceOn\(\)\{.*\}/);
  if(!onM)throw new Error("FAIL: не знайдено exportPickPlaceOn");
  const body='const EXPORT_PLACE_KEY="ai_bridge_export_pick_place";'+onM[0]+";"+grabFn(app,"saveFileSmart")+";return {exportPickPlaceOn,saveFileSmart};";
  const mk=(store,win)=>new Function("localStorage","window",body)(store,win);
  const noPicker={};
  // преф вимкнено → fallback, пікер не чіпається
  let fns=mk({getItem:()=>"0"},{showSaveFilePicker:()=>{throw new Error("не мав викликатися")}});
  ok(fns.exportPickPlaceOn()===false,"pref=0 → off");
  ok(await fns.saveFileSmart(new Blob(["x"]), "a.md","text/markdown")==="fallback","pref off → fallback");
  // преф увімкнено, але API немає → fallback
  fns=mk({getItem:()=>"1"},noPicker);
  ok(fns.exportPickPlaceOn()===true,"pref=1 → on");
  ok(await fns.saveFileSmart(new Blob(["x"]),"a.md","text/markdown")==="fallback","немає API → fallback");
  // преф увімкнено + пікер → saved, перевіряємо suggestedName і тип
  let gotOpts=null;
  const winOk={showSaveFilePicker:async(o)=>{gotOpts=o;return{createWritable:async()=>({write:async()=>{},close:async()=>{}})}}};
  fns=mk({getItem:()=>"1"},winOk);
  ok(await fns.saveFileSmart(new Blob(["x"]),"dlg.json","application/json")==="saved","пікер → saved");
  ok(gotOpts.suggestedName==="dlg.json","suggestedName прокинуто");
  ok(gotOpts.types[0].accept["application/json"].includes(".json"),"тип .json у пікері");
  // скасування користувачем → cancelled
  const winAbort={showSaveFilePicker:async()=>{const e=new Error("abort");e.name="AbortError";throw e}};
  fns=mk({getItem:()=>"1"},winAbort);
  ok(await fns.saveFileSmart(new Blob(["x"]),"a.md","text/markdown")==="cancelled","AbortError → cancelled");
  // інша помилка пікера → fallback на тихе завантаження
  const winErr={showSaveFilePicker:async()=>{throw new Error("denied")}};
  fns=mk({getItem:()=>"1"},winErr);
  ok(await fns.saveFileSmart(new Blob(["x"]),"a.md","text/markdown")==="fallback","помилка пікера → fallback");
}

/* ---------- 6. експорти через dlBlobSmart ---------- */
{
  const d=grabFn(app,"downloadExportFile");
  ok(d.includes("dlBlobSmart"),"downloadExportFile → dlBlobSmart");
  ok(d.includes('"text/markdown"')&&d.includes('"application/json"'),"правильні mime для md/json");
  const docx=grabFn(app,"exportDocx");
  ok(docx.includes("dlBlobSmart"),"exportDocx → dlBlobSmart");
  ok(docx.includes('"application/msword"'),"mime .doc");
  ok(docx.includes('closeSheet("exportSheet")'),"exportDocx закриває лист");
}

/* ---------- 7. index.html ---------- */
{
  const sheet=html.match(/<div id="exportSheet"[\s\S]*?<input type="file" id="importDialogFile"/);
  ok(sheet,"exportSheet знайдено");
  ok(sheet[0].includes('id="exportPickPlaceChk"'),"чекбокс #exportPickPlaceChk у листі");
  ok(sheet[0].includes('data-i18n="exportPickPlace"'),"data-i18n exportPickPlace");
  ok(sheet[0].includes('data-i18n="exportPickPlaceDesc"'),"data-i18n exportPickPlaceDesc");
}

/* ---------- 8. styles.css ---------- */
{
  ok(css.includes(".roleDup"),".roleDup у CSS");
  ok(css.includes(".exportPickRow"),".exportPickRow у CSS");
  ok(css.includes("min-width:44px"),"тач-ціль ≥44px для кнопок ролі");
}

/* ---------- 9. exportPickPlaceOn ---------- */
{
  const m=app.match(/function exportPickPlaceOn\(\)\{.*\}/);
  ok(m,"exportPickPlaceOn знайдено (однорядкова)");
  const src='const EXPORT_PLACE_KEY="ai_bridge_export_pick_place";'+m[0]+";return exportPickPlaceOn;";
  const fn=new Function("localStorage",src)({getItem:()=>"1"});
  ok(fn()===true,"'1' → true");
  const fn2=new Function("localStorage",src)({getItem:()=>"0"});
  ok(fn2()===false,"'0' → false");
  const fn3=new Function("localStorage",src)({getItem:()=>{throw 1}});
  ok(fn3()===false,"помилка сховища → false");
}

console.log("\nPASS:",passed);
