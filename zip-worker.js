/* AI Bridge ZIP extraction worker: keeps inflate/decoding off the mobile UI thread. */
"use strict";
importScripts("./zip-safety-core.js");

const MAX_FILE_CHARS=180000;
const ZIP_FILE_SAMPLE_CHARS=180000;
const ZIP_EXTRACT_MAX_CHARS=8000000;
const ZIP_MAX_ENTRIES=512;
const ZIP_MAX_ENTRY_DECOMPRESSED=2_000_000;
const ZIP_MAX_TOTAL_DECOMPRESSED=16_000_000;
const ZIP_MAX_COMPRESSION_RATIO=120;
const TEXT_EXT=/\.(txt|md|js|mjs|cjs|ts|tsx|jsx|json|html|css|py|go|rs|java|kt|swift|php|rb|xml|yaml|yml|toml|sql|sh|csv|ini|cfg|conf|env\.example)$/i;
const SKIP_PATH=/(^|\/)(node_modules|\.git|dist|build|coverage|\.next|vendor|Pods|DerivedData)(\/|$)/i;

function isTextPath(name){return TEXT_EXT.test(name)||/^(README|LICENSE|Dockerfile|Makefile|Procfile)(\.|$)/i.test(name.split("/").pop()||"")}
function priorityPath(name){
  const n=name.toLowerCase();let p=0;
  if(/(?:^|\/)(?:_?worker|app|server|main|index|work-controller)\.(?:js|mjs|cjs|ts|tsx|jsx|py|html)$/.test(n))p+=90;
  if(/package\.json|manifest|wrangler|tsconfig|vite\.config|next\.config|cloudflare/.test(n))p+=70;
  if(/\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|php|rb|html|css|json|yaml|yml|toml|sql|sh)$/.test(n))p+=40;
  if(/(?:^|\/)(?:src|lib|server|api|functions|workers?)\//.test(n))p+=25;
  if(/(?:^|\/)(?:test|tests|spec|specs)\//.test(n)||/\.(?:test|spec)\./.test(n))p+=15;
  if(/readme|security|submission_checklist|review_findings/.test(n))p+=10;
  if(/changelog/.test(n))p-=20;
  // v5.9.1: files that crowd out real sources or get quoted back by models
  // instead of answering (service worker boilerplate, bundles, lockfiles,
  // full copies of _worker.js kept as test fixtures) go to the end.
  if(/(?:^|\/)tests?\/worker-v[\w.-]+\.m?js$/.test(n))p-=300;
  if(/\.min\.(?:js|css)$|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(n))p-=200;
  if(/(?:^|\/)(?:sw|service-worker)\.js$/.test(n))p-=60;
  if(/(?:^|\/)i18n\.js$|(?:^|\/)locales?\//.test(n))p-=25;
  if(SKIP_PATH.test(n))p-=1000;
  return p;
}
function sampleLargeFileText(text,maxChars=MAX_FILE_CHARS){
  const src=String(text||"").replace(/\0/g,"");
  if(src.length<=maxChars)return {text:src,truncated:false,originalChars:src.length};
  const markerBudget=1200,each=Math.max(12000,Math.floor((maxChars-markerBudget)/3));
  const alignStart=i=>{const n=src.lastIndexOf("\n",Math.max(0,i));return n>=0?n+1:0};
  const alignEnd=i=>{const n=src.indexOf("\n",Math.min(src.length,i));return n>=0?n:src.length};
  const headEnd=alignEnd(each),midCenter=Math.floor(src.length/2),midStart=alignStart(midCenter-Math.floor(each/2)),midEnd=alignEnd(midStart+each),tailStart=alignStart(src.length-each);
  const lineAt=i=>1+(src.slice(0,Math.max(0,i)).match(/\n/g)||[]).length;
  const sampled=[src.slice(0,headEnd),`\n[AI BRIDGE: LARGE FILE SAMPLE — omitted lines between ${lineAt(headEnd)} and ${Math.max(lineAt(midStart)-1,lineAt(headEnd))}; middle excerpt starts at line ${lineAt(midStart)}]\n`,src.slice(midStart,midEnd),`\n[AI BRIDGE: LARGE FILE SAMPLE — omitted lines between ${lineAt(midEnd)} and ${Math.max(lineAt(tailStart)-1,lineAt(midEnd))}; tail excerpt starts at line ${lineAt(tailStart)}]\n`,src.slice(tailStart),`\n[TRUNCATED LARGE FILE: original ${src.length.toLocaleString()} chars; head + middle + tail preserved]`].join("");
  return {text:sampled.slice(0,maxChars+markerBudget),truncated:true,originalChars:src.length};
}

self.onmessage=async event=>{
  try{
    const u8=new Uint8Array(event.data?.buffer);
    if(!u8.byteLength)throw new Error("ZIP file is empty.");
    const meta=self.ZipSafetyCore.scanZipMeta(u8,{maxEntries:ZIP_MAX_ENTRIES,maxEntryDeclared:ZIP_MAX_ENTRY_DECOMPRESSED,maxTotalDeclared:ZIP_MAX_TOTAL_DECOMPRESSED,maxCompressionRatio:ZIP_MAX_COMPRESSION_RATIO,skipSuspicious:true});
    const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),eocd=self.ZipSafetyCore.findEOCD(u8),candidates=[];let p=meta.cdOffset;
    const stats={entries:0,text:0,extracted:0,skippedVendor:0,skippedBinary:0,skippedLarge:0,skippedEncrypted:0,failed:0,overBudget:0};
    for(let i=0;i<meta.entries;i++){
      if(p+46>u8.length||dv.getUint32(p,true)!==0x02014b50)throw new Error("Invalid ZIP central directory.");
      const method=dv.getUint16(p+10,true),compSize=dv.getUint32(p+20,true),uncomp=dv.getUint32(p+24,true),nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true);
      const name=self.ZipSafetyCore.normalizeEntryName(new TextDecoder().decode(u8.slice(p+46,p+46+nameLen))),ratioOK=!(compSize>0&&uncomp/compSize>ZIP_MAX_COMPRESSION_RATIO),encrypted=self.ZipSafetyCore.isEncryptedEntry(dv,p);
      if(name&&!name.endsWith("/")){stats.entries++;if(encrypted)stats.skippedEncrypted++;else if(SKIP_PATH.test(name))stats.skippedVendor++;else if(!isTextPath(name))stats.skippedBinary++;else if(uncomp>ZIP_MAX_ENTRY_DECOMPRESSED||!ratioOK)stats.skippedLarge++}
      if(name&&!encrypted&&!name.endsWith("/")&&!SKIP_PATH.test(name)&&isTextPath(name)&&uncomp<=ZIP_MAX_ENTRY_DECOMPRESSED&&ratioOK&&local+30<=u8.length&&dv.getUint32(local,true)===0x04034b50){
        const ln=dv.getUint16(local+26,true),le=dv.getUint16(local+28,true),start=local+30+ln+le,end=start+compSize;
        if(end<=u8.length)candidates.push({name,method,compSize,uncomp,start,end,priority:priorityPath(name)});
      }
      p+=46+nameLen+extraLen+commentLen;
    }
    if(eocd<0)throw new Error("ZIP structure not found.");
    candidates.sort((a,b)=>b.priority-a.priority||a.name.localeCompare(b.name));
    let used=0,totalDecompressed=0,processed=0,skipped=0;const out=[];
    self.postMessage({type:"progress",done:0,total:candidates.length});
    for(const c of candidates){
      if(used>=ZIP_EXTRACT_MAX_CHARS||totalDecompressed>=ZIP_MAX_TOTAL_DECOMPRESSED)break;
      try{
        const perLimit=Math.min(ZIP_MAX_ENTRY_DECOMPRESSED,ZIP_MAX_TOTAL_DECOMPRESSED-totalDecompressed);
        let raw;if(c.method===0)raw=c.compSize<=perLimit?u8.slice(c.start,c.end):null;else if(c.method===8)raw=await self.ZipSafetyCore.inflateRawBounded(u8.slice(c.start,c.end),perLimit);else raw=null;
        if(raw){totalDecompressed+=raw.byteLength;const decoded=new TextDecoder("utf-8",{fatal:false}).decode(raw).replace(/\0/g,""),prepared=sampleLargeFileText(decoded,ZIP_FILE_SAMPLE_CHARS),remain=ZIP_EXTRACT_MAX_CHARS-used,txt=prepared.text.slice(0,remain);out.push({name:c.name,text:txt,size:c.uncomp,priority:c.priority,truncated:prepared.truncated||txt.length<prepared.text.length,originalChars:prepared.originalChars});used+=txt.length;stats.extracted++}else{skipped++;stats.failed++}
      }catch(e){skipped++;stats.failed++}
      processed++;if(processed%4===0)self.postMessage({type:"progress",done:processed,total:candidates.length});
    }
    // Keep the complete safe text-file inventory even when only a bounded
    // subset of contents fits in the AI context window.
    stats.text=candidates.length;stats.overBudget=Math.max(0,candidates.length-processed);
    self.postMessage({type:"done",files:out,manifestNames:candidates.map(c=>c.name),processed,total:candidates.length,skipped,stats});
  }catch(e){self.postMessage({type:"error",error:String(e?.message||e)})}
};
