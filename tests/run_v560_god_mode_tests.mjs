import fs from 'node:fs';
let pass=0;const ok=(c,m)=>{if(!c)throw new Error(`FAIL: ${m}`);pass++;console.log(`PASS: ${m}`)};
const worker=fs.readFileSync('_worker.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const i18n=fs.readFileSync('i18n.js','utf8');
ok(worker.includes('const GOD_MODE_DOCTRINE='),'God Mode has a bounded mentor doctrine');
ok(worker.includes('"god"].includes(body?.mode)')||worker.includes('"god"].includes(body.mode)'),'Worker recognizes god mode');
ok(worker.includes('mode==="god"'),'God Mode has a dedicated runtime branch');
ok(worker.includes('agentVerifyDraft(env'),'God Mode performs independent draft verification');
ok(worker.includes('mentor_revision'),'God Mode can revise after verifier criticism');
ok(worker.includes('free/reliable providers first')||worker.includes('Use free/reliable providers first'),'Mentor doctrine keeps free-first routing');
ok(worker.includes('Never expose API keys, tokens, cookies, passwords'),'Mentor doctrine forbids secret disclosure');
ok(worker.includes('Do not autonomously mutate production'),'Mentor doctrine forbids uncontrolled production mutation');
ok(html.includes('<option value="god"'),'God Mode is selectable in Team UI');
ok(app.includes('GOD_MODE_BOOT_KEY="ai_bridge_god_mode_boot_v560"'),'God Mode is enabled once on upgrade');
ok(app.includes('localStorage.setItem("ai_bridge_mode","god")'),'God Mode becomes the persisted mode on first v5.6 boot');
ok(i18n.includes('modeGod:"God Mode')&&i18n.includes('godPickHelp:'),'God Mode has localized UI copy');

const mod=await import(new URL('../_worker.js',import.meta.url).href+`?runtime=${Date.now()}`);
const oldFetch=globalThis.fetch;
try{
  const calls=[];let groqCall=0;
  globalThis.fetch=async (url,opts={})=>{
    const u=String(url);calls.push(u);
    if(u.includes('api.groq.com')){
      groqCall++;
      const text=groqCall===1
        ? '{"action":"finish","answer":"God Mode runtime completed."}'
        : 'NO_CRITICAL_ISSUES';
      return new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    throw new Error(`unexpected URL ${u}`);
  };
  const out=await mod.runTeam({GROQ_API_KEY:'test-key'},{prompt:'Check this simple task carefully.',displayPrompt:'Check this simple task carefully.',mode:'god',providers:[],synthesize:false,judge:'auto',searchFirst:false});
  ok(out.final==='God Mode runtime completed.','God Mode returns the Agent Core answer when verifier finds no critical issue');
  ok(out.meta?.godMode===true&&out.meta?.independentVerification===true,'God Mode runtime metadata records independent verification');
  ok(out.meta?.verifiedBy==='groqfree','God Mode verifier uses the available free-first helper');
  ok(calls.every(x=>x.includes('api.groq.com')),'God Mode test does not touch paid providers when Groq succeeds');
} finally {globalThis.fetch=oldFetch}

console.log(`AI Bridge v5.6.0 God Mode tests passed (${pass}).`);
