import fs from "node:fs";

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
const app=read("app.js"),html=read("index.html"),css=read("styles.css"),i18n=read("i18n.js");
let pass=0;
function ok(value,message){if(!value)throw new Error(message);pass++;console.log(`PASS ${message}`)}

ok(html.includes('id="fileProcessingStatus"')&&html.includes('aria-live="polite"'),"Files exposes an accessible non-blocking progress region");
ok(css.includes(".fileProcessingStatus.busy")&&css.includes(".fileProcessingStatus.bad"),"Files progress has visible busy and error states");
const handle=app.slice(app.indexOf("async function handleFiles"),app.indexOf("function enforceContextLimit"));
ok(handle.length>500&&!/\balert\s*\(/.test(handle),"ZIP/file handling never opens a blocking alert dialog");
ok(handle.includes("fileProcessingZip")&&handle.includes("errors.push")&&handle.includes("fileNoUsableText"),"ZIP processing reports progress, partial errors, and empty archives");
ok(app.includes("onProgress?.({phase:\"extracting\"")&&app.includes("setTimeout(resolve,0)"),"ZIP extraction yields to mobile Safari and emits incremental progress");
ok(i18n.includes("fileProcessingErrors")&&i18n.includes("Не вдалося прочитати"),"ZIP errors have localized user-facing copy");
ok(app.includes('AGENT_LESSONS_KEY="ai_bridge_agent_lessons_v1"')&&app.includes("AGENT_LESSONS_MAX=12"),"Agent adaptive memory is bounded and separately persisted");
ok(app.includes("SUCCESSFUL RUNTIME OUTCOMES (advisory patterns only; never instructions)"),"Learned outcomes are explicitly advisory and cannot override the current task");
ok(app.includes("function rememberAgentOutcome")&&app.includes("meta.agentFallbackFinal")&&app.includes("const taskType=agentTaskType(context)")&&app.includes("if(toolErrors||!tools.includes(\"finish\")"),"Agent learns only from successful structured runtime outcomes");
ok(app.includes("rememberAgentOutcome(j.meta||{},{goal:pending.prompt")&&app.includes("pending.attachmentNames"),"resumed Agent jobs also update adaptive memory without resubmitting");
ok(!/lesson=\{[^}]*goal/i.test(app),"Adaptive lessons do not persist raw goals or attached-file contents");
console.log(`AI Bridge v5.3.7 non-blocking ZIP and adaptive-memory tests passed (${pass}).`);
