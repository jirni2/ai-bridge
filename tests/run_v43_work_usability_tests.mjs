import fs from "node:fs";
const c=fs.readFileSync(new URL("../work-controller.js",import.meta.url),"utf8");function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
ok(!c.includes('alert("Введи BRIDGE_ACCESS_TOKEN.")'),"token check has no blocking alert");ok(c.includes("/api/session/login"),"Work UI uses HttpOnly Bridge session login");ok(!c.includes('alert("Введи завдання.")'),"task check has no blocking alert");ok(c.includes("AIBridgeWorkUICore"),"production client uses tested UI core");
console.log("All v4.3 Work usability tests passed.");
