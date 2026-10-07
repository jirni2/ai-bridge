import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'_worker.js'),'utf8');
function assert(x,msg){if(!x)throw new Error(msg)}
assert(!/getToken\s*\(/.test(app),'app.js still calls removed getToken()');
// v5.11.26: authHeaders may carry X-UI-Lang (UI language hint for server messages) but must NOT carry auth tokens
assert(!/["']Authorization["']/.test(app.match(/function authHeaders\(\)\{[\s\S]*?\n\}/)?.[0]||""),'authHeaders must not send Authorization header');
assert(!/Bearer/.test(app.match(/function authHeaders\(\)\{[\s\S]*?\n\}/)?.[0]||""),'authHeaders must not send Bearer token');
assert(/fetch\("\/api\/run"/.test(app),'send path missing /api/run');
assert(/fetch\("\/api\/diagnostics\/providers"/.test(app),'provider diagnostics path missing');
assert(/ai_bridge_session/.test(worker),'worker session cookie support missing');
assert(/url\.pathname==="\/api\/session\/login"/.test(worker),'session login route missing');
assert(/url\.pathname==="\/api\/run"/.test(worker),'run route missing');
console.log('v4.8.1 client runtime regression tests passed');
