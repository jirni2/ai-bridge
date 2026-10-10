const CACHE="ai-bridge-v5-11-109";
// v5.9.15: Web Push — "task ready" notifications.
self.addEventListener("push",e=>{
  let data={};
  try{data=e.data?e.data.json():{}}catch(_){data={}}
  const title=data.title||"AI Bridge";
  e.waitUntil(self.registration.showNotification(title,{
    body:data.body||"",
    tag:data.tag||"ai-bridge",
    icon:"icon-192.png",
    badge:"icon-192.png",
    data:{url:data.url||"./"}
  }));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||"./";
  e.waitUntil((async()=>{
    const wins=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const w of wins){if("focus"in w)return w.focus()}
    return self.clients.openWindow(url);
  })());
});
const ASSETS=["./index.html","./styles.css","./app.js","./crew.js","./i18n.js","./markdown.js","./core.js","./theme-boot.js","./zip-safety-core.js","./zip-worker.js","./vendor/pdfjs/pdf.min.mjs","./vendor/pdfjs/pdf.worker.min.mjs","./trade/","./trade/trade.js","./trade/bot-ui.js","./trade/metrics.js","./trade/trade.css","./trade-core.mjs","./manifest.webmanifest","./icon-180.png","./icon-192.png","./icon-512.png"];
// v5.10.0: cache each asset separately — a single 404 (e.g. a missing icon)
// must no longer kill the whole precache (and with it push + offline).
// The SW always activates; failures are only logged.
self.addEventListener("install",e=>e.waitUntil((async()=>{
  const c=await caches.open(CACHE);
  const failed=[];
  await Promise.all(ASSETS.map(async url=>{
    try{
      const r=await fetch(url,{cache:"no-store"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      await c.put(url,r);
    }catch(err){failed.push(`${url} (${err&&err.message||err})`)}
  }));
  if(failed.length)console.warn("[ai-bridge-sw] precache skipped:",failed.join(", "));
  else console.info("[ai-bridge-sw] precache ok:",ASSETS.length,"assets");
  await self.skipWaiting();
})()));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin)return;
  const sensitive=u.pathname.startsWith("/api/")||u.pathname.startsWith("/oauth/")||u.pathname.startsWith("/.well-known/")||u.pathname==="/mcp";
  if(sensitive){e.respondWith(fetch(e.request));return}
  // 2026-10-01: навігації йдуть повз HTTP-кеш браузера. Інакше браузер може
  // віддати SW застарілий index.html з власного кешу, і застосунок «застряє»
  // на старій версії навіть при network-first стратегії.
  const netReq=e.request.mode==="navigate"?new Request(e.request,{cache:"no-store"}):e.request;
  e.respondWith(fetch(netReq).then(r=>{
    const cc=(r.headers.get("cache-control")||"").toLowerCase();
    if(r.ok&&r.type==="basic"&&!/(?:^|,)\s*no-store\b/.test(cc)){
      const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone)).catch(()=>{});
    }
    return r;
  }).catch(async()=>{
    // BUG FIX (v5.9.0): offline, a missing script/stylesheet used to be
    // answered with index.html, which the browser then tried to run as
    // JavaScript/CSS. Only page navigations fall back to the app shell.
    const hit=await caches.match(e.request);if(hit)return hit;
    if(e.request.mode==="navigate")return (await caches.match("./index.html"))||Response.error();
    return Response.error();
  }));
});
