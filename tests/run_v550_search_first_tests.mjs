import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import path from "node:path";

const root=path.resolve(new URL("..",import.meta.url).pathname),tmp=path.join(root,"tests",`worker-v550-${Date.now()}.mjs`);
fs.writeFileSync(tmp,fs.readFileSync(path.join(root,"_worker.js")));
const mod=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
let passed=0;const ok=(value,message)=>{assert.ok(value,message);passed++};

ok(mod.searchFirstCandidate("What is the capital of Canada?"),"simple factual questions use Search First");
ok(mod.searchFirstCandidate("Яка столиця Канади?"),"Ukrainian factual questions use Search First");
ok(!mod.searchFirstCandidate("Привіт"),"greetings still use a real AI provider path");
ok(!mod.searchFirstCandidate("Переклади цей текст англійською"),"transformative tasks do not get misrouted to search");
ok(!mod.searchFirstCandidate("What is my api_key=sk-supersecret123456789?"),"potential secrets are never sent to search engines");
ok(!mod.searchAnswerIsEnough("Порадь медичне лікування?",{directAnswer:"Long enough direct result",results:[]}),"high-stakes questions require AI review rather than a search-only answer");

// v5.10.3: one weak substring must not count as relevance.
const bankSpam={query:"capital of France",results:[
  {title:"Capital Bank — personal banking",url:"https://example-bank.example/",snippet:"Capital Bank is a member of the Allpoint Network. Get convenient, FREE access to your cash where you need it most — in Target, CVS, Walgreens and Kroger stores."},
  {title:"Capital Bank branches",url:"https://example-bank.example/branches",snippet:"Find a Capital Bank branch near you. Capital Bank offers checking accounts, savings accounts and business loans in your neighborhood."}
]};
ok(!mod.searchEvidenceRelevant("What is the capital of France? Answer in one short sentence.",bankSpam),"single weak term (capit in Capital Bank) is not relevance — falls back to AI");
const parisOk={query:"capital of France",results:[
  {title:"Paris — Wikipedia",url:"https://en.wikipedia.org/wiki/Paris",snippet:"Paris is the capital and largest city of France. With an estimated population of 2 million, Paris is the fourth-largest city in the European Union."},
  {title:"France country profile",url:"https://example.com/france",snippet:"France, officially the French Republic, is a country in Western Europe. Its capital is Paris, a major European city of art, fashion and culture."}
]};
ok(mod.searchEvidenceRelevant("What is the capital of France?",parisOk),"two distinct terms (capit + franc) count as relevant evidence");
ok(mod.searchEvidenceRelevant("Napoleon",{query:"napoleon",results:[{title:"Napoleon — Wikipedia",url:"https://en.wikipedia.org/wiki/Napoleon",snippet:"Napoleon Bonaparte was a French military commander and emperor."}]}),"single-term queries still work with one matching term");

const yandexXml=`<yandexsearch><response><results><grouping><group><doc><title>AI Bridge result</title><url>https://example.com/result</url><passages><passage>Verified snippet from Yandex.</passage></passages></doc></group></grouping></results></response></yandexsearch>`;
const parsed=mod.parseYandexSearchXml(yandexXml);
ok(parsed.length===1&&parsed[0].engine==="yandex"&&parsed[0].snippet.includes("Verified snippet"),"official Yandex XML results are parsed safely");

const realFetch=globalThis.fetch;
try{
  let calls=0;
  globalThis.fetch=async url=>{calls++;assert.match(String(url),/^https:\/\/api\.duckduckgo\.com\//);return new Response(JSON.stringify({Heading:"Canada",AbstractText:"Ottawa is the capital city of Canada.",AbstractURL:"https://www.canada.ca/en.html"}),{status:200,headers:{"Content-Type":"application/json"}})};
  const direct=await mod.runTeam({}, {mode:"auto",prompt:"What is the capital of Canada?",displayPrompt:"What is the capital of Canada?",searchFirst:true});
  ok(direct.meta.searchOnly===true&&direct.selectedProviders.length===0,"a sufficient search answer returns without any AI provider");
  ok(calls===1&&direct.final.includes("Ottawa")&&direct.meta.webSearch.results[0].url.startsWith("https://"),"search-only answers retain a visible HTTPS source");

  // M3 (v5.11.9 wave 2): поведінка навмисно змінилась — після AI-відповіді Bridge
  // робить ОДИН обмежений виклик Judge з рубрикою (видно за <answer_to_score>
  // у промпті). Намір тесту збережено: відповідь генерується рівно 1 раз,
  // жодних петель повторів.
  let aiCalls=0,judgeCalls=0,capturedPrompt="";
  globalThis.fetch=async (url,init={})=>{
    const target=String(url);
    if(target.startsWith("https://api.duckduckgo.com/"))return new Response(JSON.stringify({}),{status:200,headers:{"Content-Type":"application/json"}});
    if(target.startsWith("https://html.duckduckgo.com/"))return new Response(`<a class="result__a" href="https://example.com/evidence">Bridge evidence status</a>`,{status:200,headers:{"Content-Type":"text/html"}});
    if(target.startsWith("https://api.groq.com/")){const bodyText=String(JSON.parse(init.body).messages.at(-1).content);if(bodyText.includes("<answer_to_score>")){judgeCalls++;return new Response(JSON.stringify({choices:[{message:{content:'{"accuracy":5,"completeness":5,"language":5,"sources":5}'}}]}),{status:200,headers:{"Content-Type":"application/json"}})}aiCalls++;capturedPrompt=bodyText;return new Response(JSON.stringify({choices:[{message:{content:"AI reviewed the web source and completed the answer."}}]}),{status:200,headers:{"Content-Type":"application/json"}})}
    throw new Error(`Unexpected URL ${target}`);
  };
  const fallback=await mod.runTeam({GROQ_API_KEY:"test-key"},{mode:"auto",prompt:"What is the current Bridge evidence status?",displayPrompt:"What is the current Bridge evidence status?",searchFirst:true});
  ok(fallback.meta.searchFirst===true&&fallback.meta.searchOnly===false&&aiCalls===1&&judgeCalls===1,"insufficient web evidence falls back to AI exactly once + one bounded M3 quality-judge call");
  ok(fallback.meta.qualityScore&&fallback.meta.qualityScore.avg===5&&fallback.meta.qualityScore.retried===false,"M3: quality score attached to the fallback answer");
  ok(capturedPrompt.includes("<web_search_context")&&capturedPrompt.includes("https://example.com/evidence"),"AI fallback receives bounded web evidence and its source URL");
}finally{globalThis.fetch=realFetch;fs.unlinkSync(tmp)}

const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),html=fs.readFileSync(path.join(root,"index.html"),"utf8"),css=fs.readFileSync(path.join(root,"styles.css"),"utf8");
ok(html.includes('id="searchFirst"')&&html.includes('id="webSources"'),"Search First control and source surface are present in the UI");
ok(app.includes("renderWebSources")&&app.includes("searchFirst:$"),"Chat sends Search First preference and renders source cards");
ok(css.includes(".searchFirstToggle")&&css.includes(".webSourceCard"),"Search First interface has responsive production styling");

console.log(`v5.5.0 Search First tests passed (${passed} assertions).`);
