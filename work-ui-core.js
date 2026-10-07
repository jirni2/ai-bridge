(function(g){
"use strict";
function judgeEventLabel(evt,name){
  name=String(name||"Judge");
  if(evt?.type==="judge_retry"){
    const sec=Math.round((Number(evt.retryDelayMs)||0)/1000);
    const attempt=Number(evt.attempt)||0,max=Number(evt.maxAttempts)||0,next=Number(evt.nextAttempt)||0;
    const a=attempt&&max?`attempt ${attempt}/${max}`:(attempt?`attempt ${attempt}`:"retry");
    const n=next&&max?`; next ${next}/${max}`:"";
    return `${name} Judge: ${a} failed with ${evt.status||"retry"}; чекаю ${sec}s; source: ${evt.retryDelaySource||"backoff"}${n}`;
  }
  if(evt?.type==="judge_network_attempt")return `${name} Judge: API attempt ${evt.attempt}/${evt.maxAttempts}`;
  if(evt?.type==="judge_phase"&&evt.currentPhase==="repair_request")return `${name} Judge: repairing structured JSON…`;
  if(evt?.type==="judge_start")return `${name} Judge: starting…`;
  if(evt?.type==="judge_attempt")return evt.ok?`${name} Judge: complete`:`${name} Judge: failed; trying fallback…`;
  if(evt?.type==="judge_context_ready")return `${name} Judge: verification context ready (${evt.verificationContextChars||0} chars)`;
  return "Final Judge працює…";
}
g.AIBridgeWorkUICore={judgeEventLabel};
})(globalThis);
