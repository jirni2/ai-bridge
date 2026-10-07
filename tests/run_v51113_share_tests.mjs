/* v5.11.13 — Web Share Target + App Shortcuts.
   1) parseShareParams: чистий парсер query-параметрів title/text/url.
   2) composeShareText: збірка вставки (порожні частини пропускаються).
   3) parseShortcut: 'new'|'team'|'ask', інше → null.
   4) Статичні перевірки: share_target + 3 shortcuts у manifest.webmanifest,
      ключі shareReceived в i18n.js (uk+en), boot-обробник в app.js. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js");
const manifest=JSON.parse(R("manifest.webmanifest"));
const curVersion=JSON.parse(R("bridge-version.json")).version;

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

/* --- 1. витягуємо чисті функції з app.js --- */
function grab(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name+" в app.js");
  return m[0];
}
const sandbox=`${grab(app,"parseShareParams")}\n${grab(app,"composeShareText")}\n${grab(app,"parseShortcut")}\n`;
(0,eval)(sandbox);

/* --- 2. parseShareParams --- */
{
  ok(parseShareParams("")===null,"порожній query → null");
  ok(parseShareParams("?share=1")===null,"тільки маркер share=1 → null");
  const s1=parseShareParams("?share=1&title=%D0%97%D0%B0%D0%B3%D0%BE%D0%BB%D0%BE%D0%B2%D0%BE%D0%BA&text=hello&url=https%3A%2F%2Fex.com");
  ok(s1&&s1.title==="Заголовок"&&s1.text==="hello"&&s1.url==="https://ex.com","всі три параметри розпізнано (URL-decoded)");
  const s2=parseShareParams("?text=%20%20spaced%20%20");
  ok(s2&&s2.text==="spaced"&&s2.title===""&&s2.url==="","пробіли обрізаються, відсутні → порожні рядки");
  ok(parseShareParams("?title=%20%20")===null,"тільки пробіли → null");
  ok(parseShareParams(null)===null,"null → null");
}

/* --- 3. composeShareText --- */
{
  ok(composeShareText({title:"T",text:"X",url:"U"})==="T\nX\nU","три частини через \\n");
  ok(composeShareText({title:"",text:"X",url:""})==="X","порожні частини пропускаються");
  ok(composeShareText({title:"",text:"",url:"U"})==="U","тільки url");
}

/* --- 4. parseShortcut --- */
{
  ok(parseShortcut("?shortcut=new")==="new","shortcut=new");
  ok(parseShortcut("?shortcut=team")==="team","shortcut=team");
  ok(parseShortcut("?shortcut=ask")==="ask","shortcut=ask");
  ok(parseShortcut("?shortcut=bogus")===null,"невідоме значення → null");
  ok(parseShortcut("")===null,"порожній query → null");
  ok(parseShortcut("?share=1&text=x")===null,"share-параметри не плутаються з shortcut");
}

/* --- 5. manifest.webmanifest --- */
{
  const st=manifest.share_target;
  ok(st&&st.method==="GET","share_target присутній, метод GET");
  ok(st.params&&st.params.title==="title"&&st.params.text==="text"&&st.params.url==="url","share_target params: title/text/url");
  const sc=manifest.shortcuts||[];
  ok(sc.length===3,"3 shortcuts");
  const urls=sc.map(x=>x.url).sort();
  ok(JSON.stringify(urls)===JSON.stringify(["./?shortcut=ask","./?shortcut=new","./?shortcut=team"]),"shortcut URL: new/team/ask");
  ok(sc.every(x=>x.name&&x.url&&x.icons&&x.icons.length),"кожен shortcut має name, url, icons");
  ok(new RegExp("v"+curVersion.replace(/\./g,"\\.")).test(manifest.name),"manifest name = v"+curVersion);
}

/* --- 6. i18n ключі --- */
{
  ok(/shareReceived:"Shared content/.test(i18n),"ключ shareReceived в en");
  ok(/shareReceived:"Вміст із/.test(i18n),"ключ shareReceived в uk");
}

/* --- 7. boot-обробник в app.js --- */
{
  ok(/parseShareParams\(location\.search\)/.test(app),"boot: обробка share-параметрів");
  ok(/parseShortcut\(location\.search\)/.test(app),"boot: обробка shortcut");
  ok(/cleanLaunchQuery\(\)/.test(app),"boot: очищення query після обробки");
  ok(/showPage\("team"\)/.test(app),"shortcut team → showPage(\"team\")");
  ok(/t\("shareReceived"\)/.test(app),"toast з ключем shareReceived");
}

console.log(`\nPASS: ${passed} перевірок`);
