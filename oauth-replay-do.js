export class OAuthReplayGuard {
  constructor(state, env){ this.state=state; this.env=env; }
  async fetch(req){
    const url=new URL(req.url);
    if(req.method!=="POST"||url.pathname!=="/consume")return new Response("Not found",{status:404});
    let body;try{body=await req.json()}catch(e){return new Response("Bad JSON",{status:400})}
    const jti=String(body.jti||""),ttl=Math.max(60,Math.min(90*86400,Number(body.ttlSec||300)));
    if(!jti)return new Response("Missing jti",{status:400});
    const key="jti:"+jti,now=Date.now(),expiresAt=now+ttl*1000;
    return this.state.storage.transaction(async txn=>{
      const old=await txn.get(key);
      if(old&&Number(old)>now)return new Response("Already used",{status:409});
      await txn.put(key,expiresAt);
      return new Response("Consumed",{status:200});
    });
  }
}
export default {async fetch(){return new Response("OAuthReplayGuard Worker")}};
