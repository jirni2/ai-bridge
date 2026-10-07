import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(/^(?:4\.[3-9]\.\d+|[5-9]\.\d+\.\d+)$/.test(JSON.parse(read("bridge-version.json")).version),"central version is v4.3+");
ok(/const VERSION="(?:4\.[3-9]\.\d+|[5-9]\.\d+\.\d+)";/.test(read("_worker.js")),"Worker version is v4.3+");
ok(read("_worker.js").includes("const JUDGE_RESPONSE_SCHEMA="),"Gemini Judge schema remains defined");
ok(read("work.html").includes("/work-ui-core.js"),"work page loads UI core");
ok(!read("sw.js").includes("./work-ui-core.js"),"SW avoids precaching runtime UI core");
console.log("All v4.3 packaging tests passed.");
