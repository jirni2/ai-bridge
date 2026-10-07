import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const worker=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
const work=fs.readFileSync(path.join(root,"work-controller.js"),"utf8");

assert.ok(app.includes('$("prompt").addEventListener("keydown"'),"Chat registers a keyboard submit handler");
assert.ok(app.includes('e.key==="Enter"&&!e.shiftKey&&!e.isComposing'),"Enter sends while Shift+Enter remains available for a newline");
assert.ok(html.includes('<option value="1">1</option>')&&html.includes('<option value="4" selected>4</option>'),"Agent UI offers the required 1–4 step range");
assert.ok(worker.includes('const AGENT_MAX_STEPS=4;'),"server enforces a maximum of four Agent steps");
assert.ok(worker.includes('timeoutSignal(12000)')&&worker.includes('probeTimeout.done()'),"each live provider probe has a bounded server timeout");
assert.ok(app.includes('controller.abort(),20000')&&app.includes('Provider diagnostics timed out after 20 seconds'),"provider diagnostics cannot leave the UI busy forever");
assert.ok(worker.includes('workTimeout=timeoutSignal(30000)')&&worker.includes('workTimeout.done()'),"background Work provider jobs have a bounded runtime");
assert.ok(work.includes('controller=new AbortController()')&&work.includes('signal:controller.signal')&&work.includes('Provider diagnostics timed out after 20 seconds.'),"Work Controller diagnostics also recover from stalled provider probes");

console.log("AI Bridge v5.3.6 interaction and timeout regression tests passed.");
