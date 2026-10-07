import fs from "node:fs";
import assert from "node:assert/strict";

const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../_worker.js",import.meta.url),"utf8");
let passed=0;
function ok(value,message){assert.ok(value,message);passed++}

ok(app.includes('submittedImages.length?t("taskAnalyzingPhoto"):context?t("taskAnalyzingFile"):t("working")'),"plain chat must not claim that a file is being analyzed");
ok(worker.includes("A delegate/helper answer is advice, not proof"),"Agent Core distinguishes helper advice from verification evidence");
ok(worker.includes("clearly name anything that was not actually tested"),"Agent Core must disclose unverified parts");

console.log(`v5.3.9 truthful progress tests passed (${passed} assertions).`);
