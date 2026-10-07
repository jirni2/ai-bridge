#!/usr/bin/env node
/* Injects dtc-data.js into _worker.js at the __DTC_DATA__ placeholder.
   Run before fingerprint-build: node tools/inject-dtc.mjs
   _worker.js is a single-file Cloudflare Worker (no imports), so data must be inlined. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const dataPath = path.join(root, "dtc-data.js");
const workerPath = path.join(root, "_worker.js");
const PLACEHOLDER = "/*__DTC_DATA__*/";

const data = fs.readFileSync(dataPath, "utf8");
let worker = fs.readFileSync(workerPath, "utf8");

if (!worker.includes(PLACEHOLDER)) {
  console.error("inject-dtc: placeholder not found in _worker.js");
  process.exit(1);
}
// Replace any previously injected block (between markers) or the bare placeholder.
const startMark = "/*__DTC_DATA_START__*/";
const endMark = "/*__DTC_DATA_END__*/";
const blockRe = new RegExp(
  startMark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "[\\s\\S]*?" +
    endMark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
);
const block = `${startMark}\n${data}\n${endMark}`;
if (blockRe.test(worker)) {
  worker = worker.replace(blockRe, () => block);
} else {
  worker = worker.replace(PLACEHOLDER, () => block);
}
fs.writeFileSync(workerPath, worker);
console.log(`inject-dtc: injected ${data.length} bytes into _worker.js`);
