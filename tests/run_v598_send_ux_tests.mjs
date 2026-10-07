/* v5.9.8: after Send the keyboard hides, the page scrolls to live AI progress, and a step log is kept. */
import fs from "node:fs";import path from "node:path";import vm from "node:vm";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const app=fs.readFileSync(path.join(root,"app.js"),"utf8"),html=fs.readFileSync(path.join(root,"index.html"),"utf8"),css=fs.readFileSync(path.join(root,"styles.css"),"utf8"),i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
const send=app.slice(app.indexOf("async function sendTask("),app.indexOf("\n}\n",app.indexOf("async function sendTask("))+3);
ok(send.length>50&&!/\$\("prompt"\)\.focus\(\)/.test(send)&&send.includes("dismissKeyboard()"),"Chat send no longer refocuses the input (keyboard stays hidden)");
const agent=app.slice(app.indexOf("async function runAgentPage("),app.indexOf("async function runAgentPage(")+4000);
ok(/input\.value="";(saveComposerDrafts\(\);)?dismissKeyboard\(\)/.test(agent)&&agent.includes('revealWork($("agentRunStatus"))'),"Agent send hides the keyboard and scrolls to the live status");
const busy=app.slice(app.indexOf("function setBusy("),app.indexOf("function setBusy(")+600);
ok(busy.includes("startActivity()")&&busy.includes("dismissKeyboard()")&&busy.includes('revealWork($("runProgress"))')&&busy.includes("stopActivity()"),"a run start scrolls to the progress card and starts the activity log");
ok(/id="progressLog"/.test(html)&&/id="progressElapsed"/.test(html)&&/id="activitySummary"/.test(html),"page has the live log, the timer and the 'what the AI did' summary");
ok(/body\.aiRunning #page-chat\{padding-bottom:70vh\}/.test(css)&&/\.agentMsg\{scroll-margin-top:84px\}/.test(css),"layout leaves room to scroll the progress card to the top");
for(const k of ["secShort","activityDone","activitySummary"])ok((i18n.match(new RegExp(k+":","g"))||[]).length>=3,`i18n key ${k} exists in en/uk/ru`);
// functional: the log de-duplicates, caps and renders with elapsed time
const start=app.indexOf("const activity={"),end=app.indexOf("function setBusy(");
const els={progressLog:{innerHTML:"",scrollTop:0,scrollHeight:10}};
const ctx={document:{activeElement:{tagName:"TEXTAREA",blurred:0,blur(){this.blurred++}}},Date,setTimeout,clearTimeout,setInterval,clearInterval,MutationObserver:class{observe(){}disconnect(){}},
  $:id=>els[id]||null,t:(k,v)=>k==="secShort"?"s":k,esc:s=>String(s).replace(/</g,"&lt;")};
vm.runInNewContext(app.slice(start,end)+";globalThis.api={activity,logActivity,dismissKeyboard,fmtElapsed}",ctx);
const a=ctx.api;a.activity.started=Date.now();
a.logActivity("Вебпошук");a.logActivity("Вебпошук");a.logActivity("<b>x</b>");
ok(a.activity.items.length===2,"repeated progress lines are logged once");
ok(!els.progressLog.innerHTML.includes("<b>"),"log text is escaped");
for(let i=0;i<60;i++)a.logActivity("step "+i);ok(a.activity.items.length<=40,"log is capped");
ok(a.fmtElapsed(5000)==="5 s"&&a.fmtElapsed(75000)==="1:15","elapsed time formats as seconds, then m:ss");
a.dismissKeyboard();ok(ctx.document.activeElement.blurred===1,"dismissKeyboard blurs a focused text field");
console.log("v5.9.8 send UX tests PASS");
