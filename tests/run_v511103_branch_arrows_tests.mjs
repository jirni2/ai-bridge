/* v5.11.103: regression — branch arrows (стрілки гілок діалогу).
   forkRun must link the clone to its parent (forkFrom), and the chat page must
   render a ◀ ▶ navigator over the branch family (parent + its forks) so Serhii
   can jump between branches without digging through history. */
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(new URL("..",import.meta.url).pathname);
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
let passed=0;
function ok(value,message){if(!value)throw new Error("FAIL: "+message);passed++;console.log("PASS:",message)}
const app=read("app.js"),html=read("index.html"),css=read("styles.css"),i18n=read("i18n.js");

/* 1. forkRun stamps the parent link on the clone. */
ok(/clone\.forkFrom=run\.id/.test(app),"forkRun sets clone.forkFrom = parent run id");
ok(/clone\.forkFromPeer=peerIndex/.test(app),"forkRun keeps the peer fork point (forkFromPeer)");

/* 2. Branch family helpers exist and are used by the answer renderer. */
for(const fn of ["branchParentOf","branchFamilyOf","renderBranchBadge"])
  ok(new RegExp(`function ${fn}\\(`).test(app),`app.js defines ${fn}()`);
ok(app.includes("renderBranchBadge(run);"),"renderAnswer calls renderBranchBadge(run)");
ok(/id="branchBadge"/.test(html),"index.html has the #branchBadge element in ansBadges");
ok(css.includes(".branchBadge"),"styles.css styles .branchBadge");
ok(css.includes(".branchArrow"),"styles.css styles .branchArrow (44px-ish touch targets via 24px+padding)");

// 3. i18n keys exist in both languages.
for(const k of ["branchNav","branchPrev","branchNext","branchOf"]){
  ok(new RegExp(`${k}:"[^"]+"`).test(i18n),`i18n has key "${k}" (en+uk)`);
}
ok(/branchOf:"Гілка \{i\} з \{n\}"/.test(i18n),"branchOf has the Ukrainian plural template");

/* 4. Family logic: extract the pure helpers and run them against fake runs. */
const grab=name=>{const m=app.match(new RegExp("function "+name+"\\([\\s\\S]*?\\n\\}"));if(!m)throw new Error("cannot extract "+name);return m[0]};
const sandboxSrc=grab("branchParentOf")+"\n"+grab("branchFamilyOf");
const mkRuns=()=>[
  {id:"p1",title:"Сайдинг",created:100},
  {id:"f1",title:"Сайдинг (fork)",forkFrom:"p1",created:200},
  {id:"f2",title:"Сайдинг (fork)",forkFrom:"p1",created:300},
  {id:"legacy",title:"Покрівля (fork)",created:150},   // pre-v5.11.103 fork: no forkFrom
  {id:"p2",title:"Покрівля",created:50},
  {id:"other",title:"Відео",created:400}
];
const runLogic=(runs,runId)=>{
  const fn=new Function("runs","run","list",`${sandboxSrc};return branchFamilyOf(run,list);`);
  const run=runs.find(x=>x.id===runId);
  return fn(runs,run,runs);
};
{
  const runs=mkRuns();
  const fam1=runLogic(runs,"f1");
  ok(fam1.fam.length===3&&fam1.fam[0].id==="p1","family of a fork = [parent, f1, f2] ordered by created");
  ok(fam1.idx===1,"current fork reports index 1");
  const famP=runLogic(runs,"p1");
  ok(famP.idx===0&&famP.fam.length===3,"parent sees its own family with index 0");
  const famL=runLogic(runs,"legacy");
  ok(famL.fam.length===2&&famL.fam[0].id==="p2","legacy '(fork)' title suffix resolves the parent by title");
  const famO=runLogic(runs,"other");
  ok(famO.fam.length===1,"dialog without branches has a one-item family (badge stays hidden)");
}

/* 5. Navigation wraps around and targets siblings, not the current run. */
ok(/\(idx\+d\+fam\.length\)%fam\.length/.test(app),"arrow navigation wraps around the family");
ok(/currentRun=target;resetConvId\(\);/.test(app),"arrow click opens the sibling run like history does");

console.log(`AI Bridge v5.11.103 branch-arrows tests passed (${passed} assertions).`);
