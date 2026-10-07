import fs from "node:fs";
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8");
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
function ok(v,m){if(!v)throw new Error("FAIL: "+m);console.log("✓",m)}
ok(html.includes('id="chooseFilesBtn"'),"explicit Choose Files button exists");
ok(html.includes('id="fileInput"')&&html.includes('type="file"'),"native file input exists");
ok(!css.includes('.uploadBox input{display:none}'),"file input is not display:none");
ok(css.includes('.nativeFileInput{position:fixed'),"file input remains mounted/available to iOS");
ok(app.includes('function openNativeFilePicker(trigger)')&&app.includes('fileInput.click();')&&app.includes('$("chooseFilesBtn").onclick=()=>openNativeFilePicker($("chooseFilesBtn"))'),"button synchronously opens native picker in user gesture");
ok(app.includes('fileDropZone.addEventListener("drop"'),"drag/drop is wired");
ok(app.includes('document.addEventListener("paste"'),"paste files is wired");
ok(app.includes('navigator.clipboard?.read'),"explicit clipboard paste button is wired");
console.log("v4.8.4 file-picker regression tests passed");
