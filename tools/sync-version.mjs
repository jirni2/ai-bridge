import fs from "node:fs";import path from "node:path";
const root=path.resolve(new URL("..",import.meta.url).pathname),meta=JSON.parse(fs.readFileSync(path.join(root,"bridge-version.json"),"utf8")),v=meta.version,build=String(meta.buildSha256||"pending");
function edit(f,fn){const p=path.join(root,f);fs.writeFileSync(p,fn(fs.readFileSync(p,"utf8")))}
edit("_worker.js",x=>x.replace(/const VERSION="[^"]+";/,`const VERSION="${v}";`));
edit("_worker.js",x=>x.replace(/const BUILD_SHA256="[^"]+";/,`const BUILD_SHA256="${build}";`));

for(const f of ["app.js","work-controller.js"])edit(f,x=>x.replace(/const UI_VERSION="[^"]+"/,`const UI_VERSION="${v}"`));
for(const f of ["work.html","work/index.html"])edit(f,x=>x.replace(/AI Bridge Work Controller v\d+\.\d+(?:\.\d+)?/g,`AI Bridge Work Controller v${v}`));
edit("index.html",x=>x.replace(/<title>AI Bridge v\d+\.\d+(?:\.\d+)? — Work Controller<\/title>/,`<title>AI Bridge v${v} — Work Controller</title>`));
// v5.9.4: visible version labels (hero badge + sidebar footer) were never synced.
edit("index.html",x=>x.replace(/<span class="heroVersion">v[\d.]+<\/span>/,`<span class="heroVersion">v${v}</span>`).replace(/(<div class="sideFoot"><a href="\/work"[^>]*>Advanced Controller<\/a><span>)v[\d.]+(<\/span>)/,`$1v${v}$2`));
edit("support.html",x=>x.replace(/Bridge Review Panel v\d+\.\d+(?:\.\d+)?/g,`Bridge Review Panel v${v}`));
// v5.11.52: cache-busting query strings — оновлюються при кожному релізі, щоб PWA підтягувала новий CSS/JS.
edit("index.html",x=>x.replace(/styles\.css\?v=[\d.]+/g,`styles.css?v=${v}`).replace(/app\.js\?v=[\d.]+/g,`app.js?v=${v}`));
for(const f of ["work.html","work/index.html"])edit(f,x=>x.replace(/\/styles\.css\?v=[\d.]+/g,`/styles.css?v=${v}`));
edit("support.html",x=>x.replace(/\/styles\.css\?v=[\d.]+/g,`/styles.css?v=${v}`));
const mp=path.join(root,"manifest.webmanifest"),m=JSON.parse(fs.readFileSync(mp,"utf8"));m.name=`AI Bridge v${v} — Work Controller`;fs.writeFileSync(mp,JSON.stringify(m,null,2)+"\n");
edit("sw.js",x=>x.replace(/const CACHE="[^"]+";/,`const CACHE="ai-bridge-v${v.replaceAll(".","-")}";`));
console.log("Synced",v);
