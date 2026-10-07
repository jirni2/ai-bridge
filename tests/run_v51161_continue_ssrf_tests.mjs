/* v5.11.61 — Кнопка «Продовжити» + SSRF-гігієна веб-фетчу:
   1) extractFinishReason: зведення finish reason провайдерів до "length".
   2) isPrivateIpv4Octets / isPrivateIp: вектори приватних і публічних IP.
   3) dohAnswerIps: парсинг DoH-відповіді (лише A/AAAA).
   4) Каркас: noteFinishReason у 6 провайдерів, out.truncated у runOne,
      meta.truncated у tag(), DNS-перевірка в safeDownload.
   5) app.js: continueAnswer, чип data-continue, конверт <bridge_continue>;
      i18n: continueBtn/continuePrompt/continueInstruction в uk+en. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const R=p=>fs.readFileSync(path.join(root,p),"utf8");
const worker=R("_worker.js"),app=R("app.js"),i18n=R("i18n.js");

let passed=0;
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);passed++;console.log("✓",msg)}

function grabFn(src,name){
  const m=src.match(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`,"m"));
  if(!m)throw new Error("FAIL: не знайдено function "+name);
  return m[0];
}
(0,eval)(grabFn(worker,"extractFinishReason"));
(0,eval)(grabFn(worker,"isPrivateIpv4Octets"));
(0,eval)(grabFn(worker,"isPrivateIp"));
(0,eval)(grabFn(worker,"dohAnswerIps"));

/* --- 1. extractFinishReason --- */
ok(extractFinishReason({choices:[{finish_reason:"length"}]})==="length","openai length → length");
ok(extractFinishReason({choices:[{finish_reason:"stop"}]})==="stop","openai stop → stop");
ok(extractFinishReason({candidates:[{finishReason:"MAX_TOKENS"}]})==="length","gemini MAX_TOKENS → length");
ok(extractFinishReason({candidates:[{finishReason:"STOP"}]})==="stop","gemini STOP → stop");
ok(extractFinishReason({stop_reason:"max_tokens"})==="length","claude max_tokens → length");
ok(extractFinishReason({stop_reason:"end_turn"})==="end_turn","claude end_turn → end_turn");
ok(extractFinishReason({})==="","порожня відповідь → ''");
ok(extractFinishReason(null)==="","null → ''");
ok(extractFinishReason({choices:[{}]})==="","без finish_reason → ''");

/* --- 2. приватні IPv4 --- */
for(const ip of ["127.0.0.1","10.5.6.7","192.168.1.1","172.16.0.1","172.31.255.255",
  "169.254.169.254","100.64.0.1","198.18.0.1","192.0.2.1","198.51.100.1",
  "203.0.113.1","0.0.0.0","224.0.0.1","240.0.0.1"])
  ok(isPrivateIp(ip)===true,`приватний ${ip} → true`);
for(const ip of ["8.8.8.8","1.1.1.1","142.250.0.1","93.184.216.34"])
  ok(isPrivateIp(ip)===false,`публічний ${ip} → false`);
ok(isPrivateIpv4Octets([8,8,8,8])===false,"isPrivateIpv4Octets публічний → false");
ok(isPrivateIpv4Octets([10,0,0,1])===true,"isPrivateIpv4Octets приватний → true");
ok(isPrivateIpv4Octets("x")===true,"isPrivateIpv4Octets сміття → true (безпечно)");

/* --- IPv6 --- */
ok(isPrivateIp("::1")===true,"::1 → true");
ok(isPrivateIp("fc00::1")===true,"fc00::1 (unique local) → true");
ok(isPrivateIp("fd12:3456::1")===true,"fd12:: (unique local) → true");
ok(isPrivateIp("fe80::1")===true,"fe80::1 (link-local) → true");
ok(isPrivateIp("::ffff:127.0.0.1")===true,"::ffff:127.0.0.1 (mapped loopback) → true");
ok(isPrivateIp("::ffff:8.8.8.8")===false,"::ffff:8.8.8.8 (mapped public) → false");
ok(isPrivateIp("2001:4860:4860::8888")===false,"2001:4860::8888 (google public) → false");
ok(isPrivateIp("not-an-ip")===true,"не IP → true (безпечно)");

/* --- 3. dohAnswerIps --- */
{
  const sample={Status:0,Answer:[
    {name:"example.com.",type:1,TTL:300,data:"93.184.216.34"},
    {name:"example.com.",type:28,TTL:300,data:"2606:2800:220:1:248:1893:25c8:1946"},
    {name:"example.com.",type:5,TTL:300,data:"alias.example."},
    {name:"example.com.",type:1,TTL:300,data:"93.184.216.34."},
  ]};
  const ips=dohAnswerIps(sample);
  ok(ips.length===3,"dohAnswerIps: 3 IP (CNAME пропущено)");
  ok(ips.includes("93.184.216.34"),"dohAnswerIps: A-запис");
  ok(ips.includes("2606:2800:220:1:248:1893:25c8:1946"),"dohAnswerIps: AAAA-запис");
  ok(!ips.some(x=>x.endsWith(".")),"dohAnswerIps: кінцева крапка знята");
  ok(dohAnswerIps(null).length===0,"dohAnswerIps(null) → []");
  ok(dohAnswerIps({}).length===0,"dohAnswerIps({}) → []");
}

/* --- 4. каркас у _worker.js --- */
for(const [fn,id] of [["callOpenAI","openai"],["callClaude","claude"],["callGemini","gemini"],["callOpenRouter","openrouter"]])
  ok(worker.includes(`noteFinishReason("${id}",j)`),`${fn}: noteFinishReason("${id}")`);
ok((worker.match(/noteUsage\(env,providerId,mdl,j\);noteFinishReason\(providerId,j\)/g)||[]).length===2,"callOpenAICompat + callGroqCompat: noteFinishReason(providerId,j)");
ok(worker.includes('if(takeFinishReason(id,start)==="length")out.truncated=true'),"runOne: out.truncated=true");
ok(worker.includes("r.truncated&&r.text&&fin.includes(String(r.text).slice(0,160))"),"tag(): meta.truncated з обірваного результату");
ok(worker.includes("await assertPublicDnsResolution(target.hostname)"),"safeDownload: DNS-перевірка кожного хопа");
ok(worker.includes("code:\"ssrf_dns_blocked\""),"SSRF: код помилки ssrf_dns_blocked");
ok(worker.includes("function assertPublicDnsResolution"),"assertPublicDnsResolution існує");
ok(worker.includes("cloudflare-dns.com/dns-query"),"DoH через cloudflare-dns.com");

/* --- 5. app.js: кнопка «Продовжити» --- */
ok(app.includes("function continueAnswer()"),"app.js: continueAnswer()");
ok(app.includes('data-continue="1"'),"app.js: чип data-continue");
ok(app.includes("continueBtn"),"app.js: t(\"continueBtn\")");
ok(app.includes("continuePrompt"),"app.js: t(\"continuePrompt\")");
ok(app.includes("continueInstruction"),"app.js: t(\"continueInstruction\")");
ok(app.includes("<bridge_continue>"),"app.js: конверт <bridge_continue>");
ok(app.includes("<truncated_answer>"),"app.js: <truncated_answer> з хвостом відповіді");
ok(app.includes("currentRun.continueRoot=continueFrom.question"),"app.js: склейка продовження + continueRoot");
ok(app.includes("run.meta?.truncated&&run.final"),"app.js: чип лише при meta.truncated");

/* --- i18n uk+en --- */
for(const k of ["continueBtn","continuePrompt","continueInstruction"]){
  const c=(i18n.match(new RegExp(`\\b${k}:`,"g"))||[]).length;
  ok(c>=2,`i18n: ключ ${k} в uk+en (${c})`);
}
ok(/continueBtn:"▶ Продовжити"/.test(i18n),"i18n uk: continueBtn");
ok(/continueBtn:"▶ Continue"/.test(i18n),"i18n en: continueBtn");

console.log(`\nУсі v5.11.61 тести пройдено: ${passed} перевірок.`);
