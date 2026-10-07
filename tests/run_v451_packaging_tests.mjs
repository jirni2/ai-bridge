import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const version=JSON.parse(read("bridge-version.json")).version;
ok(/^(?:4\.(?:8|9)\.\d+|[5-9]\.\d+\.\d+)$/.test(version),"central version is v4.8+ including later major versions");
ok(read("_worker.js").includes(`const VERSION="${version}";`),"Worker version is synchronized");
ok(read("support.html").includes(`Bridge Review Panel v${version}`),"support version is synchronized");
ok(read("index.html").includes(`AI Bridge v${version} — Work Controller`),"static version is synchronized");
ok(JSON.parse(read("manifest.webmanifest")).name.includes(`v${version}`),"manifest version is synchronized");
console.log("All v4.5.3 packaging tests passed.");
