import fs from "node:fs";
import path from "node:path";
const root=path.resolve(new URL("..",import.meta.url).pathname),v="4.5.1",minor="4.5";
const edit=(f,fn)=>{const p=path.join(root,f);fs.writeFileSync(p,fn(fs.readFileSync(p,"utf8")))};
fs.writeFileSync(path.join(root,"bridge-version.json"),JSON.stringify({version:v},null,2)+"\n");
edit("_worker.js",x=>x.replace(/const VERSION="[^"]+";/,`const VERSION="${v}";`));
edit("support.html",x=>x.replace(/Bridge Review Panel v\d+\.\d+(?:\.\d+)?/g,`Bridge Review Panel v${v}`));
for(const f of ["work.html","work/index.html"])edit(f,x=>x.replace(/AI Bridge Work Controller v\d+\.\d+/g,`AI Bridge Work Controller v${minor}`));
edit("index.html",x=>x.replace(/AI Bridge v\d+\.\d+ — Work Controller/g,`AI Bridge v${minor} — Work Controller`));
const mp=path.join(root,"manifest.webmanifest"),m=JSON.parse(fs.readFileSync(mp,"utf8"));m.name=`AI Bridge v${minor} — Work Controller`;fs.writeFileSync(mp,JSON.stringify(m,null,2)+"\n");
for(const f of ["tests/run_v37_tests.mjs","tests/run_v40_packaging_tests.mjs","tests/run_v41_packaging_tests.mjs","tests/run_v42_packaging_tests.mjs","tests/run_v43_packaging_tests.mjs","tests/run_v44_packaging_tests.mjs"])
  edit(f,x=>x.replaceAll("\\.0","\\.\\d+"));
edit("tests/run_v45_packaging_tests.mjs",x=>x.replaceAll("4.5.0","4.5.1"));
console.log(`Prepared ${v}`);
