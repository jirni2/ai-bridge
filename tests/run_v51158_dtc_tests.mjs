/* v5.11.58 — База кодів помилок авто + VIN-декодер:
   1) DTC_CODES: ≥250 кодів (P/B/C/U generic + P1xxx manufacturer).
   2) dtcLookup: існуючий код → дані укр.; неіснуючий → null.
   3) dtcSearch: пошук за текстом (мін. 3 символи), ліміт 30.
   4) dtcDecodeVin: валідний VIN → make/country/year; короткий → invalid;
      I/O/Q → invalid; невірна контрольна цифра → invalid.
   5) API-роути в handleDtc: /api/dtc/lookup, /search, /vin, /stats.
   6) UI: пункт меню navDtc, сторінка #page-dtc, i18n ключі uk/en. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js"),index=R("index.html");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const marker="function "+name+"(";
  const i=src.indexOf(marker);
  if(i<0)throw new Error("FAIL: не знайдено function "+name);
  const bi=src.indexOf("{",i);
  let depth=0,j=bi;
  for(;j<src.length;j++){
    const ch=src[j];
    if(ch==="{")depth++;
    else if(ch==="}"){
      depth--;
      if(depth===0){j++;break;}
    }
  }
  return src.slice(i,j);
}

/* --- 1. База кодів --- */
const dataStart=worker.indexOf("/*__DTC_DATA_START__*/");
const dataEnd=worker.indexOf("/*__DTC_DATA_END__*/");
ok(dataStart>0&&dataEnd>dataStart,"DTC-дані інжектовано в _worker.js");
const dataBlock=worker.slice(dataStart,dataEnd);
const codeMatches=dataBlock.match(/\{c:"[PBUC][0-9A-F]{4}"/g)||[];
ok(codeMatches.length>=250,`Кодів у базі: ${codeMatches.length} (≥250)`);
const pCodes=codeMatches.filter(c=>c.startsWith('{c:"P0')).length;
const bCodes=codeMatches.filter(c=>c.startsWith('{c:"B')).length;
const cCodes=codeMatches.filter(c=>c.startsWith('{c:"C')).length;
const uCodes=codeMatches.filter(c=>c.startsWith('{c:"U')).length;
const p1Codes=codeMatches.filter(c=>c.startsWith('{c:"P1')).length;
ok(pCodes>=100,`P0xxx: ${pCodes} (≥100)`);
ok(bCodes>=15,`B0xxx: ${bCodes} (≥15)`);
ok(cCodes>=15,`C0xxx: ${cCodes} (≥15)`);
ok(uCodes>=15,`U0xxx: ${uCodes} (≥15)`);
ok(p1Codes>=100,`P1xxx manufacturer: ${p1Codes} (≥100)`);
/* WMI */
const wmiCount=(dataBlock.match(/"[A-Z0-9]{2}":\{make/g)||[]).length;
ok(wmiCount>=60,`WMI записів: ${wmiCount} (≥60)`);

/* --- 2-4. Функції --- */
function grabConst(src,name){
  const marker="const "+name+"=";
  const i=src.indexOf(marker);
  if(i<0)throw new Error("FAIL: не знайдено const "+name);
  const semi=src.indexOf(";",i);
  return src.slice(i,semi+1);
}
const evalSrc=dataBlock
  +"\n"+grabConst(worker,"DTC_VIN_WEIGHTS")
  +"\n"+grabConst(worker,"DTC_VIN_VALUES")
  +"\n"+grabFn(worker,"dtcLookup")
  +"\n"+grabFn(worker,"dtcSearch")
  +"\n"+grabFn(worker,"dtcDecodeVin")
  +"\n;return {dtcLookup,dtcSearch,dtcDecodeVin,DTC_COUNT,DTC_WMI};";
const {dtcLookup,dtcSearch,dtcDecodeVin,DTC_COUNT}=new Function(evalSrc)();

ok(DTC_COUNT>=250,`DTC_COUNT=${DTC_COUNT}`);

const p0301=dtcLookup("P0301");
ok(p0301&&p0301.code==="P0301","lookup P0301 знайдено");
ok(p0301.title_uk&&p0301.title_uk.length>5,"P0301 має український заголовок");
ok(p0301.desc_uk&&p0301.desc_uk.length>10,"P0301 має український опис");
ok(Array.isArray(p0301.causes_uk)&&p0301.causes_uk.length>=2,"P0301 має ≥2 причини");
ok(["critical","warning","info"].includes(p0301.severity),"P0301 має валідний severity");
ok(dtcLookup("p0301")!==null,"lookup нечутливий до регістру");
ok(dtcLookup("P0420")!==null,"lookup P0420 (каталізатор)");
ok(dtcLookup("U0100")!==null,"lookup U0100 (CAN)");
ok(dtcLookup("B0001")!==null,"lookup B0001 (подушка)");
ok(dtcLookup("C0031")!==null,"lookup C0031 (ABS)");
ok(dtcLookup("XXXX")===null,"lookup неіснуючого коду → null");
ok(dtcLookup("")===null,"lookup порожнього → null");

const sRes=dtcSearch("каталізатор");
ok(sRes.length>=2,`search "каталізатор": ${sRes.length} результатів`);
ok(sRes.length<=30,"search ліміт 30");
ok(dtcSearch("ab").length===0,"search <3 символів → []");
ok(dtcSearch("P030").length>=1,'search "P030" знаходить коди');

/* VIN */
const honda=dtcDecodeVin("1HGCM82633A004352");
ok(honda.valid===true,"валідний VIN Honda проходить");
ok(honda.make==="Honda"&&honda.country==="США","Honda/США розпізнано");
ok(honda.year===2003,"рік 2003 з коду 3");
const toyota=dtcDecodeVin("JTDBR32E612012345");
ok(toyota.valid===true&&toyota.make==="Toyota","валідний VIN Toyota");
ok(toyota.country==="Японія","країна Японія");
const short=dtcDecodeVin("ABC123");
ok(short.valid===false,"короткий VIN → invalid");
const badChar=dtcDecodeVin("JTDBR32EI12012345");
ok(badChar.valid===false,"VIN з літерою I → invalid");
const badCheck=dtcDecodeVin("JTDBR32E812012345");
ok(badCheck.valid===false&&badCheck.error.includes("контрольна"),"невірна контрольна цифра → invalid");
const unknownWmi=dtcDecodeVin("ZZ9BR32EX12012345");
ok(unknownWmi.valid===true&&unknownWmi.make==="Невідомий виробник","невідомий WMI не ламає декодер");

/* --- 5. API роути --- */
ok(worker.includes('if(url.pathname.startsWith("/api/dtc"))return handleDtc'),"роут /api/dtc зареєстровано");
ok(worker.includes('p==="/api/dtc/lookup"'),"ендпоїнт /api/dtc/lookup");
ok(worker.includes('p==="/api/dtc/search"'),"ендпоїнт /api/dtc/search");
ok(worker.includes('p==="/api/dtc/vin"'),"ендпоїнт /api/dtc/vin");
ok(worker.includes('p==="/api/dtc/stats"'),"ендпоїнт /api/dtc/stats");

/* --- 6. UI + i18n --- */
ok(index.includes('data-more-page="dtc"'),"пункт меню АвтоКоди");
ok(index.includes('id="page-dtc"'),"сторінка #page-dtc");
ok(index.includes('id="dtcCodeInput"')&&index.includes('id="dtcVinInput"'),"поля вводу коду і VIN");
ok(app.includes("function dtcDoLookup")&&app.includes("function dtcDoVin"),"JS-логіка DTC");
ok(app.includes('if(name==="dtc")dtcInitTabs()'),"хук showPage для dtc");
for(const k of ["navDtc","moreDtc","dtcTitle","dtcDesc","dtcTabCode","dtcTabVin","dtcFind","dtcDecode","dtcCauses","dtcSevCritical","dtcSevWarning","dtcSevInfo","dtcMake","dtcCountry","dtcYear"]){
  ok(i18n.includes(k+':"')||i18n.includes(k+':\u0022'),"i18n ключ "+k);
}

console.log(`\nPASS: ${passed} перевірок`);
