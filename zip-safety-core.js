(function(g){
"use strict";
const DEFAULTS={maxEntries:512,maxEntryDeclared:2000000,maxTotalDeclared:16000000,maxCompressionRatio:120};
function findEOCD(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--)if(dv.getUint32(i,true)===0x06054b50)return i;
  return -1;
}
function scanZipMeta(u8,opts={}){
  const c={...DEFAULTS,...opts},eocd=findEOCD(u8);
  if(eocd<0)throw new Error("ZIP structure not found.");
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),entries=dv.getUint16(eocd+10,true),cdOffset=dv.getUint32(eocd+16,true);
  if(entries>c.maxEntries)throw new Error(`ZIP has too many entries (${entries}). Max ${c.maxEntries}.`);
  let p=cdOffset,totalDeclared=0,seen=0;const suspicious=[];
  for(let i=0;i<entries;i++){
    if(p+46>u8.length||dv.getUint32(p,true)!==0x02014b50)throw new Error("Invalid ZIP central directory.");
    const compSize=dv.getUint32(p+20,true),uncomp=dv.getUint32(p+24,true);
    const nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true);
    const next=p+46+nameLen+extraLen+commentLen;
    if(next>eocd)throw new Error("Invalid ZIP central directory entry length.");
    // v5.9.1: with skipSuspicious, one oversized or extremely compressible
    // entry (a repetitive log, fixture or lockfile) is skipped and reported
    // instead of rejecting the whole project. The real decompressed bytes are
    // still bounded by inflateRawBounded(); default behaviour stays strict.
    const tooBig=uncomp>c.maxEntryDeclared,ratio=compSize>0?uncomp/compSize:0,tooCompressed=compSize>0&&ratio>c.maxCompressionRatio;
    if((tooBig||tooCompressed)&&c.skipSuspicious){suspicious.push({index:i,reason:tooBig?"declared_size":"compression_ratio",uncomp,ratio:Math.round(ratio*10)/10});p=next;seen++;continue}
    if(tooBig)throw new Error(`ZIP entry declared size too large (${uncomp}).`);
    if(tooCompressed)throw new Error(`ZIP compression ratio too high (${ratio.toFixed(1)}).`);
    totalDeclared+=uncomp;
    if(totalDeclared>c.maxTotalDeclared)throw new Error(`ZIP declared total size too large (${totalDeclared}).`);
    p=next;seen++;
  }
  if(p!==eocd)throw new Error("Invalid ZIP central directory size.");
  return {entries:seen,totalDeclared,cdOffset,suspicious};
}
async function inflateRawBounded(bytes,maxBytes){
  if(!("DecompressionStream" in g))throw new Error("Browser ZIP decompression is unavailable.");
  const ds=new g.DecompressionStream("deflate-raw"),reader=new g.Blob([bytes]).stream().pipeThrough(ds).getReader(),chunks=[];let total=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel("decompressed limit exceeded");throw new Error("ZIP entry exceeds decompressed byte limit.");}
      chunks.push(value);
    }
  }finally{try{reader.releaseLock()}catch(e){}}
  const out=new Uint8Array(total);let off=0;for(const c of chunks){out.set(c,off);off+=c.byteLength}return out;
}
// v5.8.0 nested-path safety: normalize attacker-controlled entry names.
function normalizeEntryName(value){
  const raw=String(value||""),parts=raw.replace(/\\/g,"/").replace(/[\u0000-\u001f\u007f]/g,"").replace(/^[A-Za-z]:/,"").split("/").filter(x=>x&&x!=="."&&x!=="..");
  return parts.join("/").slice(0,240)+(raw.endsWith("/")&&parts.length?"/":"");
}
function isEncryptedEntry(dv,centralOffset){return (dv.getUint16(centralOffset+8,true)&1)===1}
g.ZipSafetyCore={DEFAULTS,findEOCD,scanZipMeta,inflateRawBounded,normalizeEntryName,isEncryptedEntry};
})(globalThis);
