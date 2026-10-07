import fs from "node:fs";
import vm from "node:vm";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const from=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end));
const source=`const MAX_CONTEXT_CHARS=350000; let attachments=[
  {name:"project.zip",kind:"zip",files:[{name:"src/large.js",text:"X".repeat(350000),truncated:true}],manifestNames:["src/large.js","src/missing.js"],chars:350000},
  {name:"urgent.txt",kind:"text",files:[{name:"urgent.txt",text:"SECOND_TASK_CANARY"}],chars:18}
];
const safeFileLabel=s=>String(s).replace(/[<>"']/g,"_");
const neutralizeEmbeddedFileTags=s=>String(s).replace(/<\\/?user_task/g,"<safe_user_task");
${from("function enforceContextLimit(){","// BUG FIX (v4.5.9")}
${from("function buildFileContext(){","async function readApiJson")}
enforceContextLimit();
({attachments,context:buildFileContext()});`;
const result=vm.runInNewContext(source,{console});
const ok=(value,message)=>{if(!value)throw Error(message);console.log("PASS",message)};
ok(result.attachments.length===2&&result.attachments[1].files[0].text==="SECOND_TASK_CANARY","adding files does not permanently discard later attachments");
ok(result.context.includes('path="urgent.txt"')&&result.context.includes("SECOND_TASK_CANARY"),"request context allocates space to a later task file");
ok(result.context.includes("src/missing.js")&&result.context.includes("1/2 file excerpts included"),"model sees full ZIP file inventory and explicit partial coverage");
ok(result.context.length<375000,"manifest and excerpts stay within the bounded provider context");
