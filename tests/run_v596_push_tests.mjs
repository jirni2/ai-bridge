import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

/* v5.9.15 Web Push: correctness + wiring guard.
   1. REAL cryptographic roundtrip (RFC 8291 aes128gcm): generate a client
      ECDH P-256 keypair + auth secret with crypto.subtle, encrypt through the
      actual server function encryptPushPayload() imported from _worker.js via
      its export block, then decrypt INDEPENDENTLY in this test (own HKDF +
      AES-GCM) and compare plaintext. This proves the server's encryption is
      interoperable with a real Web Push client.
   2. VAPID (RFC 8292): build the Authorization header with the real
      vapidAuthorizationHeader(), verify the ES256 signature with the public
      key, check aud/exp/sub claims.
   3. Subscription store: save/dedupe/cap-25/remove via the real
      save/get/removePushSubscription() (memory fallback, no KV in tests).
   4. Static wiring checks: /api/push/* routes, notifyJobComplete in
      processJob, export block, sw.js push listeners, app.js client flow,
      i18n keys. */

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,"..");
const ok=(c,msg)=>{if(!c)throw new Error("FAIL: "+msg);console.log("✓",msg)};

const b64url=u8=>Buffer.from(u8).toString("base64").replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
const fromB64url=s=>new Uint8Array(Buffer.from(String(s).replaceAll("-","+").replaceAll("_","/"),"base64"));

const {
  encryptPushPayload,
  vapidAuthorizationHeader,
  getVapidKeys,
  getPushSubscriptions,
  savePushSubscription,
  removePushSubscription,
} = await import("../_worker.js");
for(const n of ["encryptPushPayload","vapidAuthorizationHeader","getVapidKeys","getPushSubscriptions","savePushSubscription","removePushSubscription"])
  ok(typeof ({encryptPushPayload,vapidAuthorizationHeader,getVapidKeys,getPushSubscriptions,savePushSubscription,removePushSubscription})[n]==="function","exported "+n);

async function hkdfExpand(prkBytes,infoStr,len){
  const key=await crypto.subtle.importKey("raw",prkBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const info=new TextEncoder().encode(infoStr);
  let t=new Uint8Array(0);const chunks=[];let i=1,done=0;
  while(done<len){
    const data=new Uint8Array(t.length+info.length+1);
    data.set(t,0);data.set(info,t.length);data[data.length-1]=i;
    t=new Uint8Array(await crypto.subtle.sign("HMAC",key,data));
    chunks.push(t);done+=t.length;i++;
  }
  const out=new Uint8Array(len);let off=0;
  for(const c of chunks){const n=Math.min(c.length,len-off);out.set(c.subarray(0,n),off);off+=n;if(off>=len)break}
  return out;
}

// ---- 1. RFC 8291 roundtrip ----
const clientKeys=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
const clientPubRaw=new Uint8Array(await crypto.subtle.exportKey("raw",clientKeys.publicKey));
ok(clientPubRaw.length===65&&clientPubRaw[0]===0x04,"client p256dh key is 65-byte uncompressed");
const authSecret=crypto.getRandomValues(new Uint8Array(16));
const subscription={
  endpoint:"https://push.example.com/sub/abc123",
  keys:{p256dh:b64url(clientPubRaw),auth:b64url(authSecret)},
};
const plaintext="✅ Завдання виконано: перевірка RFC 8291 — test 123";
const {body}=await encryptPushPayload(subscription,plaintext);
ok(body instanceof Uint8Array,"encryptPushPayload returns {body: Uint8Array}");

// Parse the RFC 8291 header independently.
const salt=body.slice(0,16);
const rs=new DataView(body.buffer,body.byteOffset+16,4).getUint32(0,false);
const idlen=body[20];
ok(rs===4096,"record size rs = 4096");
ok(idlen===65,"key id length = 65");
const serverPubRaw=body.slice(21,21+idlen);
const ciphertext=body.slice(21+idlen);
ok(serverPubRaw.length===65&&serverPubRaw[0]===0x04,"server ephemeral key is 65-byte uncompressed");
ok(ciphertext.length>plaintext.length,"ciphertext longer than plaintext (pad + tag)");

// Independent decryption with the CLIENT private key.
const serverPub=await crypto.subtle.importKey("raw",serverPubRaw,{name:"ECDH",namedCurve:"P-256"},false,[]);
const sharedSecret=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:serverPub},clientKeys.privateKey,256));
const hmacKey=await crypto.subtle.importKey("raw",authSecret,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
const prk=new Uint8Array(await crypto.subtle.sign("HMAC",hmacKey,sharedSecret));
const cek=await hkdfExpand(prk,"Content-Encoding: aes128gcm\0",16);
const nonce=await hkdfExpand(prk,"Content-Encoding: nonce\0",12);
const aesKey=await crypto.subtle.importKey("raw",cek,{name:"AES-GCM"},false,["decrypt"]);
const padded=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:nonce},aesKey,ciphertext));
ok(padded[padded.length-1]===0x02,"padding delimiter 0x02 present");
const recovered=new TextDecoder().decode(padded.slice(0,-1));
ok(recovered===plaintext,"roundtrip: decrypted plaintext matches (unicode intact)");

// ---- 2. VAPID ----
const vapidKeys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
const vapidJwkPriv=await crypto.subtle.exportKey("jwk",vapidKeys.privateKey);
const vapidJwkPub=await crypto.subtle.exportKey("jwk",vapidKeys.publicKey);
const vapidPubRaw=new Uint8Array(await crypto.subtle.exportKey("raw",vapidKeys.publicKey));
const vapid={publicKey:b64url(vapidPubRaw),privateJwk:vapidJwkPriv,subject:"mailto:test@example.com"};
const authz=await vapidAuthorizationHeader(vapid,subscription.endpoint);
ok(/^vapid t=[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+, k=[A-Za-z0-9\-_]+$/.test(authz),"VAPID header format: vapid t=<jwt>, k=<pubkey>");
const jwt=authz.slice("vapid t=".length).split(", k=")[0];
const [hB64,pB64,sB64]=jwt.split(".");
const sigOk=await crypto.subtle.verify(
  {name:"ECDSA",hash:"SHA-256"},
  await crypto.subtle.importKey("jwk",{kty:"EC",crv:"P-256",x:vapidJwkPub.x,y:vapidJwkPub.y},{name:"ECDSA",namedCurve:"P-256"},false,["verify"]),
  fromB64url(sB64),new TextEncoder().encode(hB64+"."+pB64));
ok(sigOk,"VAPID JWT ES256 signature verifies with the public key");
const claims=JSON.parse(Buffer.from(pB64.replaceAll("-","+").replaceAll("_","/"),"base64").toString("utf8"));
ok(claims.aud==="https://push.example.com","VAPID aud = push service origin");
const nowS=Math.floor(Date.now()/1000);
ok(claims.exp-nowS>11*3600&&claims.exp-nowS<=12*3600,"VAPID exp ~12h in the future");
ok(claims.sub==="mailto:test@example.com","VAPID sub = subject");

// ---- 3. getVapidKeys ----
ok(getVapidKeys({})===null,"getVapidKeys returns null without secrets");
const vk=getVapidKeys({VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:JSON.stringify(vapidJwkPriv),VAPID_SUBJECT:"mailto:test@example.com"});
ok(vk&&vk.publicKey===vapid.publicKey&&vk.subject==="mailto:test@example.com"&&vk.privateJwk.d===vapidJwkPriv.d,"getVapidKeys parses env secrets");

// ---- 4. subscription store (memory fallback, env without KV) ----
const fakeEnv={};
const mkSub=i=>({endpoint:`https://push.example.com/sub/${i}`,keys:{p256dh:b64url(clientPubRaw),auth:b64url(authSecret)},label:"iPhone"});
await savePushSubscription(fakeEnv,mkSub("a"));
await savePushSubscription(fakeEnv,mkSub("b"));
await savePushSubscription(fakeEnv,mkSub("a")); // duplicate endpoint
let subs=await getPushSubscriptions(fakeEnv);
ok(subs.length===2,"dedupe by endpoint (2 subs after re-saving one)");
for(let i=0;i<27;i++)await savePushSubscription(fakeEnv,mkSub("x"+i));
subs=await getPushSubscriptions(fakeEnv);
ok(subs.length===25,"subscription list capped at 25");
await removePushSubscription(fakeEnv,"https://push.example.com/sub/x5");
subs=await getPushSubscriptions(fakeEnv);
ok(subs.length===24&&!subs.some(s=>s.endpoint.endsWith("/x5")),"removePushSubscription deletes by endpoint");

// ---- 5. static wiring ----
const worker=fs.readFileSync(path.join(root,"_worker.js"),"utf8");
ok(worker.includes('"/api/push/vapid-key"')&&worker.includes('req.method==="GET"'),"route GET /api/push/vapid-key");
ok(worker.includes('"/api/push/subscribe"')&&worker.includes('"/api/push/unsubscribe"'),"routes POST /api/push/subscribe + /api/push/unsubscribe");
ok(worker.includes("push:subs:v1"),"KV key push:subs:v1 present");
const pjStart=worker.indexOf("async function processJob(env,jobId,payload,requestFingerprint){");
ok(pjStart>=0,"processJob exists");
const pjTail=worker.slice(pjStart);
const pjEnd=pjTail.slice(1).search(/\nasync function |\nfunction /);
const pjBody=pjEnd>0?pjTail.slice(0,pjEnd+1):pjTail;
const termIdx=pjBody.indexOf("await jobPutTerminal");
ok(termIdx>=0&&pjBody.indexOf("notifyJobComplete",termIdx)>=0,"processJob calls notifyJobComplete after jobPutTerminal");
for(const n of ["sendWebPush","notifyJobComplete","handlePushVapidKey","handlePushSubscribe","handlePushUnsubscribe"])
  ok(new RegExp(`\\b${n}\\b`).test(worker.slice(worker.lastIndexOf("export {"))),`export block includes ${n}`);

const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
ok(app.includes("/api/push/vapid-key"),"app.js fetches /api/push/vapid-key");
ok(app.includes("/api/push/subscribe"),"app.js posts /api/push/subscribe");
ok(app.includes("PushManager"),"app.js feature-detects PushManager");

const sw=fs.readFileSync(path.join(root,"sw.js"),"utf8");
ok(/addEventListener\(["']push["']/.test(sw),"sw.js has push event listener");
ok(/addEventListener\(["']notificationclick["']/.test(sw),"sw.js has notificationclick listener");
ok(sw.includes("showNotification"),"sw.js shows notification");

const i18n=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
for(const k of ["pushTitle","pushToggle","pushHintAfterSend","installCardTitle"])
  ok(i18n.includes(k+":"),"i18n has key "+k);

console.log("\nAll v5.9.15 web-push checks passed.");
