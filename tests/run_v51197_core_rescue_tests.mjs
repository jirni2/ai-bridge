/* v5.11.97: Ядро підхоплює запит, коли хмарні моделі відмовили + зрозумілі пояснення. */
import fs from "node:fs";import path from "node:path";import vm from "node:vm";
const root=path.resolve(new URL("..",import.meta.url).pathname);
let pass=0,fail=0;const ok=(n,c,d)=>{if(c){pass++;console.log("PASS",n)}else{fail++;console.log("FAIL",n,d===undefined?"":JSON.stringify(d))}};
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),worker=fs.readFileSync(path.join(root,"_worker.js"),"utf8"),i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
/* вирізаємо функцію і виконуємо її з підставними залежностями */
const a=app.indexOf("const FAIL_FIX_KEYS="),b=app.indexOf("function providerErrorLabel(kind){");
const labelEnd=app.indexOf("\n",b);
const src=app.slice(a,labelEnd);
function mk(coreReply){
  const ctx={PROVIDERS:{openai:{name:"OpenAI"},claude:{name:"Claude"},gemini:{name:"Gemini"}},t:k=>"<"+k+">",askCore:()=>{if(coreReply==="throw")throw new Error("x");return coreReply}};
  vm.createContext(ctx);vm.runInContext(src+";this.f=providersFailedReport",ctx);return ctx.f;
}
const J={results:[{provider:"openai",ok:false,errorKind:"invalid_api_key",status:401},{provider:"gemini",ok:false,errorKind:"invalid_api_key",status:400},{provider:"claude",ok:false,errorKind:"billing_or_quota",status:400},{provider:"x",ok:false,cancelled:true,status:499}]};
{
  const r=mk({handled:true,text:"**4**",intent:"math"})(J,502,"2+2",{tryCore:true});
  ok("Ядро відповіло — його текст перший, позначено rescued",r.rescued&&r.final.indexOf("**4**")<r.final.indexOf("<errProvidersFailed>")&&r.final.startsWith("**<coreRescueTitle>**")&&r.coreIntent==="math",r);
  ok("причини згруповано: ключі разом, баланс окремо",/\*\*OpenAI, Gemini\*\* — <fixInvalidKey>/.test(r.final)&&/\*\*Claude\*\* — <fixBilling>/.test(r.final),r.final);
  ok("скасовані (499) не показуються як помилка",!/\bx\b/.test(r.final.replace(/<[^>]+>/g,"")));
  ok("технічний рядок лишився",/<fixTech>: OpenAI INVALID API KEY 401/.test(r.final));
}
{
  const r=mk({handled:false,escalate:true,text:"не знаю",intent:"unknown"})(J,502,"напиши код",{tryCore:true});
  ok("Ядро не знає — чесно сказано, без вигаданої відповіді",!r.rescued&&/<coreRescueNone>/.test(r.final)&&!/не знаю/.test(r.final),r.final);
}
ok("Ядро кинуло виняток — звіт усе одно є",(()=>{const r=mk("throw")(J,502,"q",{tryCore:true});return r&&!r.rescued&&/<fixInvalidKey>/.test(r.final)})());
ok("без tryCore (файли, зображення) Ядро не викликається",(()=>{let called=0;const ctx={PROVIDERS:{},t:k=>k,askCore:()=>{called++;return null}};vm.createContext(ctx);vm.runInContext(src+";this.f=providersFailedReport",ctx);const r=ctx.f(J,502,"q",{});return called===0&&r&&!/coreRescueNone/.test(r.final)})());
for(const st of [401,404,503])ok("HTTP "+st+" — це не відмова провайдерів, старий шлях",mk(null)(J,st,"q",{tryCore:true})===null);
ok("немає невдалих результатів — null",mk(null)({results:[{provider:"openai",ok:true}]},500,"q",{tryCore:true})===null&&mk(null)({},500,"q",{})===null);
ok("невідома причина → fixOther",/<fixOther>/.test(mk(null)({results:[{provider:"openai",ok:false,errorKind:"request_failed",status:400}]},502,"q",{}).final));
/* інтеграція */
ok("app: чат використовує звіт і лише для тексту без зображень",/providersFailedReport\(j,run\.status,prompt,\{tryCore:source==="chat"&&!submittedImages\.length\}\)/.test(app));
ok("app: заголовок не «Помилка», якщо Ядро відповіло",/failReport\?\.rescued\?t\("coreRescueShort"\):t\("error"\)/.test(app));
ok("app: звіт рендериться з розміткою, інші помилки — простим текстом",/run\.meta\?\.error&&!run\.meta\?\.richError\)renderLinkedText/.test(app));
/* worker: класифікація */
{
  const s=worker.indexOf("function isModelCompatibilityError(e){"),e=worker.indexOf("function constantTimeEqual(");
  const ctx={};vm.createContext(ctx);vm.runInContext(worker.slice(s,e)+";this.k=providerErrorKind",ctx);
  const k=(status,message)=>ctx.k({status,message});
  ok("worker: Gemini 400 «API key not valid» → invalid_api_key",k(400,"API key not valid. Please pass a valid API key.")==="invalid_api_key");
  ok("worker: xAI 400 «Incorrect API key provided» → invalid_api_key",k(400,"Incorrect API key provided: xa***")==="invalid_api_key");
  ok("worker: звичайний 400 лишився request_failed",k(400,"messages: field required")==="request_failed");
  ok("worker: 400 про баланс лишився billing",k(400,"Your credit balance is too low")==="billing_or_quota");
  ok("worker: 401 / 429 / 500 без змін",k(401,"x")==="invalid_api_key"&&k(429,"x")==="rate_limited"&&k(500,"x")==="provider_unavailable");
  ok("worker: 400 «model not found» лишився model_unavailable",k(404,"model gpt-x not found")==="model_unavailable");
}
for(const key of ["coreRescueTitle","coreRescueShort","coreRescueNone","fixTech","fixInvalidKey","fixBilling","fixRate","fixPermission","fixModel","fixTimeout","fixDown","fixOther"])ok("i18n "+key+" (en/uk/ru)",(i18n.match(new RegExp("[{,]"+key+":","g"))||[]).length>=3);
console.log(`\n${pass} passed, ${fail} failed`);if(fail)process.exit(1);
