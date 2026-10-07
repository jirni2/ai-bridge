import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root=path.resolve(new URL("..",import.meta.url).pathname),tmp=path.join(root,"tests",`worker-v586-${process.pid}-${Date.now()}.mjs`);
fs.writeFileSync(tmp,fs.readFileSync(path.join(root,"_worker.js")));
const m=await import(pathToFileURL(tmp).href+`?t=${Date.now()}`);
const ok=(x,msg)=>{if(!x)throw Error(msg);console.log("PASS",msg)};
const prompt="Привіт! Відповідай коротко українською. Яка версія AI Bridge зараз у production? Якщо не можеш перевірити версію, скажи про це чесно.";
const irrelevant={query:prompt,provider:"bing",results:[
  {title:"Walmart Increasing Pharmacist Pay",url:"https://example.org/walmart",snippet:"Pharmacists are getting an extra ten dollars per hour for overtime, after the base hours were changed."},
  {title:"Walmart stock after leaving",url:"https://example.net/stocks",snippet:"A discussion about employee stock after leaving the store and how to find your hire date."}
]};
try{
  ok(!m.searchAnswerIsEnough(prompt,irrelevant),"unrelated Walmart snippets cannot satisfy an AI Bridge version request");
  ok(m.searchAnswerIsEnough("What is the capital of France?",{query:"What is the capital of France?",directAnswer:"Paris is the capital and largest city of France.",results:[{title:"Paris",url:"https://example.org/paris",snippet:"Paris is the capital of France."}]}),"relevant direct answers still use zero AI calls");
  const prior=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async (url)=>{
      const u=String(url);
      if(u.startsWith("https://api.duckduckgo.com/"))return new Response("{}",{headers:{"Content-Type":"application/json"}});
      if(u.startsWith("https://www.bing.com/"))return new Response(`<rss><channel><item><title>Walmart Increasing Pharmacist Pay</title><link>https://example.org/walmart</link><description>Pharmacists are getting an extra ten dollars per hour for overtime, after the base hours were changed.</description></item><item><title>Walmart stock after leaving</title><link>https://example.net/stocks</link><description>A discussion about employee stock after leaving the store and how to find your hire date.</description></item></channel></rss>`,{headers:{"Content-Type":"application/rss+xml"}});
      if(u.includes("api.groq.com")){calls++;return new Response(JSON.stringify({choices:[{message:{content:"Не можу перевірити поточну версію без доступу до сайту."}}]}),{headers:{"Content-Type":"application/json"}})}
      throw Error("Unexpected request: "+u);
    };
    const result=await m.runTeam({GROQ_API_KEY:"test"},{mode:"auto",prompt,searchFirst:true});
    ok(result.meta.searchIrrelevant===true&&result.meta.searchOnly===false&&calls===1,"irrelevant search falls back to one real provider call");
    ok(!result.final.includes("Walmart")&&!result.meta.webSearch,"irrelevant search results do not contaminate the final answer");
  }finally{globalThis.fetch=prior}
}finally{fs.unlinkSync(tmp)}
