/* v5.11.25: справжнє «редагувати і перегенерувати» + контекстні чипи продовження.
   1) Шторка editPromptSheet в index.html: textarea, кнопки збереження/скасування;
      кнопка editPromptBtn збережена (не ламаємо тест v5.9.9).
   2) saveEditedPrompt відправляє відредагований текст через sendTask (авто-перегенерація).
   3) pickFollowUpIds: рівно 3 чипи з валідного набору; довга відповідь → shorter;
      код у відповіді → simpler; коротка відповідь → detail.
   4) i18n-ключі editPromptTitle/Hint/Label/Save в en/uk/ru. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),html=R("index.html"),i18n=R("i18n.js");
let passed=0;const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);passed++;console.log("✓",m)};

/* --- 1. шторка редагування --- */
ok(/id="editPromptSheet"/.test(html),"editPromptSheet існує в index.html");
ok(/id="editPromptText"/.test(html),"textarea editPromptText існує");
ok(/id="editPromptSaveBtn"/.test(html)&&/id="editPromptCancelBtn"/.test(html),"кнопки зберегти/скасувати існують");
ok(/id="editPromptBtn"/.test(html),"кнопка editPromptBtn збережена");
ok(/function saveEditedPrompt\(\)/.test(app),"saveEditedPrompt визначена");
ok(/sendTask\(\{source:"chat",promptText:text\}\)/.test(app),"saveEditedPrompt відправляє через sendTask (авто-перегенерація)");
ok(/\$\("editPromptSaveBtn"\)\?\.addEventListener\("click",saveEditedPrompt\)/.test(app),"кнопка збереження привʼязана");

/* --- 2. i18n --- */
for(const k of ["editPromptTitle","editPromptHint","editPromptLabel","editPromptSave"])
  ok((i18n.match(new RegExp("[{,\\s]"+k+":","g"))||[]).length>=3,`i18n ${k} в en/uk/ru`);

/* --- 3. контекстні чипи: витягуємо pickFollowUpIds і ганяємо --- */
function grab(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name+" в app.js");
  return m[0];
}
const sandbox=grab(app,"pickFollowUpIds")+"\n";
const pick=(0,eval)(`${sandbox}\n;pickFollowUpIds`);
const VALID=new Set(["shorter","detail","example","simpler","check"]);
const longRun={prompt:"поясни квантові компʼютери",final:"x".repeat(2000),results:[{ok:true,provider:"groq",text:"x".repeat(2000)}]};
let ids=pick(longRun);
ok(Array.isArray(ids)&&ids.length===3,"рівно 3 чипи");
ok(ids.every(i=>VALID.has(i)),"всі чипи з валідного набору");
ok(ids.includes("shorter"),"довга відповідь → чип «Коротше»");
const codeRun={prompt:"як написати цикл",final:"ось код:\n```js\nfor(;;){}\n```",results:[{ok:true,provider:"groq",text:"ось код:\n```js\nfor(;;){}\n```"}]};
ids=pick(codeRun);
ok(ids.includes("simpler"),"код у відповіді → чип «Поясни простіше»");
const shortRun={prompt:"що таке фотосинтез",final:"процес у рослин.",results:[{ok:true,provider:"groq",text:"процес у рослин."}]};
ids=pick(shortRun);
ok(ids.includes("detail"),"коротка відповідь → чип «Детальніше»");
ok(new Set(ids).size===3,"чипи не дублюються");

console.log(`\nPASS: ${passed} перевірок`);
