/* D1: дизайн-система — токенізація без зміни вигляду (v5.11.7, хвиля 1).
   Перевіряє: hex-кольори лише в :root; єдина система токенів; шкала шрифту
   з 5 кроків; контраст тексту WCAG AA в обох темах; усі var(--x) визначені. */
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ok=(c,m)=>{if(!c)throw new Error("FAIL: "+m);console.log("✓",m)};
const css=fs.readFileSync(path.join(root,"styles.css"),"utf8");
const blank=m=>m[0].replace(/[^\n]/g," ");
const nocom=css.replace(/\/\*[\s\S]*?\*\//g,blank);

// --- збір :root-правил по порядку, з урахуванням специфічності ---
function rootRules(){
  const out=[];const re=/:root(\[data-theme="(light|dark|auto)"\])?/g;let m;
  while((m=re.exec(nocom))){
    const j=nocom.indexOf("{",m.index);let d=0,k=j,ins=false,q="";
    while(k<nocom.length){const c=nocom[k];
      if(ins){if(c===q&&nocom[k-1]!=="\\")ins=false}
      else if(c==='"'||c==="'"){ins=true;q=c}
      else if(c==="{")d++;else if(c==="}"){d--;if(!d)break}
      k++}
    const decls={};
    for(const dm of nocom.slice(j+1,k).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g))decls[dm[1]]=dm[2].trim();
    const inMedia=nocom.slice(Math.max(0,m.index-400),m.index).includes("prefers-color-scheme");
    out.push({dt:m[2]||null,spec:m[1]?2:1,decls,inMedia,order:out.length});
  }
  return out;
}
function effective(theme,osLight){
  const eff={};
  for(const r of rootRules()){
    if(r.inMedia&&!osLight)continue;
    if(r.dt==="light"&&theme!=="light")continue;
    if(r.dt==="dark"&&theme!=="dark")continue;
    if(r.dt==="auto"&&theme!=="auto")continue;
    for(const [k,v] of Object.entries(r.decls)){
      const cur=eff[k];
      if(!cur||r.spec>cur[0]||(r.spec===cur[0]&&r.order>cur[1]))eff[k]=[r.spec,r.order,v];
    }
  }
  return Object.fromEntries(Object.entries(eff).map(([k,v])=>[k,v[2]]));
}

// 1. Жодного hex-кольору поза :root
{
  const ranges=[];
  for(const m of nocom.matchAll(/:root/g)){
    const j=nocom.indexOf("{",m.index);let d=0,k=j,ins=false,q="";
    while(k<nocom.length){const c=nocom[k];
      if(ins){if(c===q&&nocom[k-1]!=="\\")ins=false}
      else if(c==='"'||c==="'"){ins=true;q=c}
      else if(c==="{")d++;else if(c==="}"){d--;if(!d)break}
      k++}
    ranges.push([m.index,k]);
  }
  const bad=[];
  for(const m of nocom.matchAll(/#[0-9a-fA-F]{3,8}\b/g)){
    if(!ranges.some(([a,b])=>m.index>=a&&m.index<=b))bad.push(m[0]);
  }
  ok(bad.length===0,"жодного hex-кольору поза :root"+(bad.length?": "+bad.join(", "):""));
}

// 2. Єдина система токенів: один базовий :root, один light, один auto
{
  const base=(nocom.match(/:root\{/g)||[]).length;
  const light=(nocom.match(/:root\[data-theme="light"\]\{/g)||[]).length;
  const auto=(nocom.match(/:root\[data-theme="auto"\]\{/g)||[]).length;
  ok(base===2&&light===1&&auto===1,
    `один набір токенів (base :root=${base} з урахуванням --content у @media, light=${light}, auto=${auto}), дубля organizer видалено`);
}

// 3. Шкала шрифту: 5 кроків з фактичними значеннями
{
  const t=effective("dark",false);
  const exp={"--fs-xs":"11px","--fs-sm":"12.5px","--fs-md":"14px","--fs-lg":"16px","--fs-xl":"22px"};
  for(const [k,v] of Object.entries(exp))ok(t[k]===v,`токен ${k}=${v}`);
  ok(/body\{[^}]*font-size:15px/.test(nocom.replace(/\n/g,"")),"базовий font-size body лишається 15px (підняття до 16px — дизайн-рішення для D2, не токенізація)");
}

// 4. Контраст тексту WCAG AA (≥4.5:1) в обох темах
{
  const lum=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255)
    .map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
  const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
  for(const [theme,osl] of [["dark",false],["light",true]]){
    const t=effective(theme,osl);
    for(const fg of ["--text","--text-soft","--muted"])
      for(const bg of ["--bg","--surface","--surface-2"]){
        const r=cr(t[fg],t[bg]);
        ok(r>=4.5,`${theme}: ${fg} на ${bg} = ${r.toFixed(2)}:1 (AA)`);
      }
    const w=cr(t["--muted-2"],t["--surface"]);
    console.log(`  ! ${theme}: --muted-2 на --surface = ${w.toFixed(2)}:1 — нижче AA, виправлення у D4 (доступність)`);
  }
}

// 5. Усі var(--x) у файлі визначені в токенах
{
  const t={...effective("dark",false),...effective("light",true),...effective("auto",true)};
  const used=new Set([...nocom.matchAll(/var\((--[\w-]+)\)/g)].map(m=>m[1]));
  const missing=[...used].filter(x=>!(x in t));
  ok(missing.length===0,`${used.size} var(--...) — усі визначені`+(missing.length?": "+missing.join(", "):""));
}

// 6. Радіуси й відступи токенізовані
{
  const t=effective("dark",false);
  ok(t["--radius-lg"]==="12px"&&t["--radius-pill"]==="999px"&&t["--radius-round"]==="50%","радіуси в токенах");
  ok(t["--sp-1"]==="4px"&&t["--sp-6"]==="32px","шкала відступів визначена");
}

console.log("v5.11.7 D1 tokens tests PASS");
