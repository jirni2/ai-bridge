/* v5.11.66 — локальне витягнення тексту з документів (PDF/DOCX/XLSX)
   + вкладення з вкладки «Файли» для делегованих завдань команди:
   1) decodeXmlEntities: іменовані/числові сутності, порядок &amp; останнім.
   2) parseDocxXml: абзаци <w:p> → \n, <w:br/> → \n, зняття тегів.
   3) parseXlsxXml: shared strings (t="s") + inlineStr + числа, колонки за r="B2".
   4) isSupportedPickedFile: .pdf/.docx/.xlsx за розширенням.
   5) fileTypeTag: PDF/DOCX/XLSX.
   6) Каркас: vendor-файли pdf.js, precache sw.js, гілки handleFiles,
      чекбокс taskSheet, i18n uk+en (V51166), supportedFiles. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=R("app.js"),i18n=R("i18n.js"),html=R("index.html"),sw=R("sw.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp("^function "+name+"\\([\\s\\S]*?\\n\\}","m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}
// isSupportedPickedFile спирається на TEXT_EXT/isTextPath з app.js — мінімальні стаби.
globalThis.TEXT_EXT=/\.(txt|md|js|mjs|cjs|ts|tsx|jsx|json|html|css|py|go|rs|java|kt|swift|php|rb|xml|yaml|yml|toml|sql|sh|csv|ini|cfg|conf)$/i;
globalThis.isTextPath=()=>false;
(0,eval)([
  grabFn(app,"decodeXmlEntities"),
  grabFn(app,"parseDocxXml"),
  grabFn(app,"colLettersToIndex"),
  grabFn(app,"parseXlsxXml"),
  grabFn(app,"isSupportedPickedFile"),
  grabFn(app,"fileTypeTag")
].join("\n"));

/* --- 1. decodeXmlEntities --- */
ok(decodeXmlEntities("&lt;div&gt;")==="<div>","&lt;/&gt; → <>");
ok(decodeXmlEntities("хліб &amp; сіль")==="хліб & сіль","&amp; → &");
ok(decodeXmlEntities("&amp;lt;")==="&lt;","&amp; декодується останнім: &amp;lt; → &lt;");
ok(decodeXmlEntities("&#65;&#x42;")==="AB","десяткові та hex сутності");
ok(decodeXmlEntities("&quot;цитата&quot;")==='"цитата"',"лапки");
ok(decodeXmlEntities("")==="","порожній рядок");

/* --- 2. parseDocxXml --- */
{
  const xml='<?xml version="1.0"?><w:document xmlns:w="urn:x"><w:body>'+
    '<w:p><w:r><w:t>Привіт</w:t></w:r><w:r><w:t xml:space="preserve">, світе &amp; друзі</w:t></w:r></w:p>'+
    '<w:p><w:r><w:t>Другий</w:t></w:r><w:br/><w:r><w:t>рядок</w:t></w:r></w:p>'+
    '</w:body></w:document>';
  ok(parseDocxXml(xml)==="Привіт, світе & друзі\nДругий\nрядок","абзаци → \\n, br → \\n, сутності");
}
ok(parseDocxXml("")==="","порожній xml → порожній текст");
ok(parseDocxXml("<w:document><w:body></w:body></w:document>")==="","без тексту → порожньо");
{
  const xml='<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p>';
  ok(parseDocxXml(xml)==="a\nb","кілька абзаців");

/* --- 3. parseXlsxXml --- */
  const ss='<sst xmlns="urn:x"><si><t>Ім&apos;я</t></si><si><t>Прізвище</t></si></sst>';
  const sheet='<worksheet><sheetData>'+
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>інлайн</t></is></c></row>'+
    '<row r="2"><c r="A2"><v>42</v></c><c r="C2" t="s"><v>1</v></c></row>'+
    '</sheetData></worksheet>';
  ok(parseXlsxXml(ss,sheet)==="Ім'я\tінлайн\n42\t\tПрізвище","shared strings + inlineStr + пропуск колонки B2");
}
ok(parseXlsxXml("","")==="","порожні входи → порожній текст");
{
  const sheet='<worksheet><sheetData><row r="1"><c r="B2"><v>7</v></c></row></sheetData></worksheet>';
  ok(parseXlsxXml("",sheet)==="\t7","зсув колонки за r=\"B2\"");
}
ok(colLettersToIndex("A")===0&&colLettersToIndex("Z")===25&&colLettersToIndex("AA")===26,"індекси колонок");

/* --- 4. isSupportedPickedFile --- */
ok(isSupportedPickedFile({name:"звіт.pdf"})===true,".pdf за розширенням");
ok(isSupportedPickedFile({name:"Документ.DOCX"})===true,".DOCX великими літерами");
ok(isSupportedPickedFile({name:"таблиця.xlsx",type:""})===true,".xlsx без MIME (мобайл)");
ok(isSupportedPickedFile({name:"proj.zip"})===true,".zip як раніше");
ok(isSupportedPickedFile({name:"вірус.exe"})===false,".exe відхиляється");

/* --- 5. fileTypeTag --- */
ok(fileTypeTag("звіт.pdf")==="PDF","тег PDF");
ok(fileTypeTag("doc.docx")==="DOCX","тег DOCX");
ok(fileTypeTag("sheet.xlsx")==="XLSX","тег XLSX");

/* --- 6. каркас --- */
ok(fs.existsSync(path.join(root,"vendor/pdfjs/pdf.min.mjs")),"vendor/pdfjs/pdf.min.mjs існує");
ok(R("vendor/pdfjs/pdf.min.mjs").includes("4.10.38"),"pdf.min.mjs — pdfjs-dist 4.10.38");
ok(fs.statSync(path.join(root,"vendor/pdfjs/pdf.worker.min.mjs")).size>1000000,"pdf.worker.min.mjs > 1MB");
ok(sw.includes('"./vendor/pdfjs/pdf.min.mjs"')&&sw.includes('"./vendor/pdfjs/pdf.worker.min.mjs"'),"sw.js precache містить обидва vendor-файли");
ok(app.includes('lowerName.endsWith(".pdf")')&&app.includes('lowerName.endsWith(".docx")')&&app.includes('lowerName.endsWith(".xlsx")'),"handleFiles: гілки pdf/docx/xlsx");
ok(app.includes('kind:"doc"'),"атачмент kind:\"doc\"");
ok(app.includes('workerSrc="./vendor/pdfjs/pdf.worker.min.mjs"'),"workerSrc — відносна same-origin адреса");
ok(app.includes("PasswordException"),"захищений PDF → чесна помилка");
ok(!/cdn\.jsdelivr|unpkg\.com|cdnjs/.test(app),"жодних CDN у коді витягнення");
ok(app.includes('word/document.xml')&&app.includes('xl/sharedStrings.xml')&&app.includes('xl/worksheets/sheet1.xml'),"docx/xlsx: шляхи entries");
ok(app.includes('id="taskIncludeFiles"')||html.includes('id="taskIncludeFiles"'),"чекбокс у шиті завдань");
ok(html.includes('data-i18n="taskIncludeFiles"'),"чекбокс має data-i18n");
ok(app.includes("taskSheetFileContext")&&app.includes("taskFilesTruncated"),"додавання контексту файлів до input завдання");
const pack=(i18n.match(/const V51166=\{[\s\S]*?\n\};/)||[])[0]||"";
for(const k of ["docExtracting","docPdfLocked","docNoText","docBroken","taskIncludeFiles","taskFilesTruncated"]){
  const enPart=pack.split("uk:{")[0],ukPart=pack.split("uk:{")[1]||"";
  ok(enPart.includes(k+":"),`V51166 en: ${k}`);
  ok(ukPart.includes(k+":"),`V51166 uk: ${k}`);
}
ok(pack.includes("{name}")&&pack.includes("{fmt}")&&pack.includes("{n}"),"плейсхолдери {name}/{fmt}/{n}");
ok(i18n.includes('supportedFiles:"Code, TXT, MD, JSON, HTML, CSS, Python, ZIP projects, PDF, DOCX, XLSX"'),"en supportedFiles + PDF/DOCX/XLSX");
ok(i18n.includes('supportedFiles:"Код, TXT, MD, JSON, HTML, CSS, Python, ZIP-проєкти, PDF, DOCX, XLSX"'),"uk supportedFiles + PDF/DOCX/XLSX");

console.log(`\nPASS: ${passed} перевірок v5.11.66`);
