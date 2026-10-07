#!/usr/bin/env node
// Generates a VAPID P-256 keypair for AI Bridge Web Push.
// Keys are printed ONLY to stdout so you can paste them into
// `wrangler secret put` prompts. Nothing is written to disk.
import {generateKeyPairSync} from "node:crypto";

const {privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const jwk=privateKey.export({format:"jwk"}); // {kty:"EC",crv:"P-256",x,y,d}

// Uncompressed public point: 0x04 || X || Y, base64url-encoded.
const x=Buffer.from(jwk.x,"base64url");
const y=Buffer.from(jwk.y,"base64url");
const publicKeyB64u=Buffer.concat([Buffer.from([0x04]),x,y]).toString("base64url");

const privateJwkLine=JSON.stringify(jwk); // single line, no whitespace

console.log("=== AI Bridge VAPID keys ===\n");
console.log("HOW TO INSTALL (run each command, paste the value when prompted):\n");
console.log("  npx wrangler secret put VAPID_PRIVATE_KEY");
console.log("    -> paste the PRIVATE JWK below (one line):");
console.log();
console.log("    "+privateJwkLine);
console.log();
console.log("  npx wrangler secret put VAPID_PUBLIC_KEY");
console.log("    -> paste the PUBLIC key below (base64url):");
console.log();
console.log("    "+publicKeyB64u);
console.log();
console.log("  npx wrangler secret put VAPID_SUBJECT");
console.log("    -> paste your contact, e.g.:");
console.log();
console.log("    mailto:owner@example.com");
console.log();
console.log("NOTES:");
console.log("  - VAPID_PUBLIC_KEY is served by GET /api/push/vapid-key; the browser");
console.log("    converts it with urlBase64ToUint8Array() before pushManager.subscribe().");
console.log("  - VAPID_SUBJECT must be a mailto: or https: contact (RFC 8292).");
console.log("  - Keep the private key secret. This script never writes keys to files.");
