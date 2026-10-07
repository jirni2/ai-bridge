import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

/* v5.10.5 regression guard: server-connection dot + interrupted Deep Scan.
   1. Connection dot (#connDot) in the topbar: green when the Bridge server is
      reachable, red when not. pingBridge probes /api/version, heartbeat every
      30s, online/offline listeners, refreshStatus hooks.
   2. Interrupted Deep Scan is SAVED to history (mode "deep-scan",
      meta.deepScan.interrupted=true, completed part notes in the answer) so a
      dropped connection never silently loses the work; a resume banner offers
      to continue from the checkpoint; history shows an interrupted badge. */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const i18n = fs.readFileSync(path.join(root, "i18n.js"), "utf8");
const ok = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("✓", msg); };

// --- 1. connection dot ---
ok(html.includes('id="connDot"'), "index.html has #connDot");
ok(/class="brand"[\s\S]{0,400}id="connDot"/.test(html), "#connDot sits inside the topbar brand area");
ok(css.includes(".connDot.on") && css.includes("#22c55e"), ".connDot.on is green");
ok(css.includes(".connDot.off") && css.includes("#ef4444"), ".connDot.off is red");
ok(app.includes("async function pingBridge()"), "pingBridge() exists");
ok(app.includes("/api/version") && app.includes("function setConn"), "pingBridge probes /api/version and setConn updates the dot");
ok(app.includes('setConn(r.ok?"on":"off")'), "refreshStatus success/failure drives the dot");
ok(app.includes('window.addEventListener("online",()=>pingBridge())'), "online event re-pings");
ok(app.includes('window.addEventListener("offline",()=>setConn("off"))'), "offline event turns the dot red");
ok(app.includes("setInterval(()=>{if(!document.hidden)pingBridge()},30000)"), "30s heartbeat while the tab is visible");
ok(app.includes("initConnDot();"), "initConnDot() is called at startup");
for (const k of ["connOnline", "connOffline", "connChecking"]) {
  ok(new RegExp(k + ':').test(i18n), "i18n has key " + k);
}

// --- 2. interrupted Deep Scan is saved ---
const start = app.indexOf("async function runDeepScan(prompt,plan){");
ok(start >= 0, "runDeepScan exists");
const tail = app.slice(start);
const nextFn = tail.slice(1).search(/\nasync function |\nfunction /);
const body = nextFn > 0 ? tail.slice(0, nextFn + 1) : tail;
ok(/catch\(e\)\{[\s\S]{0,1500}deepScan:\{parts:n,totalParts:plan\.totalParts,files:plan\.files,completedParts:done,interrupted:true\}/.test(body),
  "runDeepScan catch builds an interrupted run record with meta.deepScan.interrupted=true");
const firstSave=body.indexOf("await saveRun(currentRun)");
ok(firstSave>=0 && body.indexOf("await saveRun(currentRun)",body.indexOf("interrupted:true"))>0,
  "interrupted run is saved via saveRun (after the interrupted record)");
ok(body.includes('renderAnswer(currentRun);renderHistory();'), "interrupted run is rendered and history refreshed");
ok(app.includes('mode:"deep-scan"') || body.includes('mode:"deep-scan"'), 'interrupted run uses mode "deep-scan"');
ok(html.includes('id="deepScanBanner"'), "index.html has #deepScanBanner");
ok(app.includes("function maybeShowDeepScanBanner()"), "maybeShowDeepScanBanner() exists");
ok(app.includes("maybeShowDeepScanBanner();"), "resume banner check runs at startup");
ok(app.includes("deepScanCheckpointSignature(cc.prompt,plan)!==cc.signature"), "resume verifies the same files are attached before resuming");
ok(app.includes("interruptedBadge"), "renderHistory shows an interrupted badge");
ok(app.includes('"deep-scan":"🔍 Deep Scan"') || app.includes("'deep-scan'"), 'MODE_BADGE_LABEL has a "deep-scan" entry');
for (const k of ["deepScanInterrupted", "deepScanSavedNotes", "deepScanInterruptedTitle", "deepScanResumeBanner", "deepScanResumeBtn", "deepScanDismissBtn", "deepScanNeedFiles"]) {
  ok(new RegExp(k + ':').test(i18n), "i18n has key " + k);
}
console.log("v5.10.5 connection-dot + deep-scan-save checks passed");
