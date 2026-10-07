// Spot paper trading only. Pure functions shared by browser and regression tests.
export const DEFAULTS=Object.freeze({capital:100,allocation:0.10,stop:0.03,take:0.06,dailyLoss:0.03,maxTrades:5,fee:0.001});
export function candles(raw){
  if(!Array.isArray(raw))throw new Error("Invalid market data");
  return raw.map(row=>({time:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),closedAt:Number(row[6])})).filter(c=>Number.isSafeInteger(c.time)&&[c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
}
export function sma(values,n){return values.length<n?null:values.slice(-n).reduce((a,b)=>a+b,0)/n}
export function rsi(values,n=14){
  if(values.length<n+1)return null;
  let gain=0,loss=0;for(let i=values.length-n;i<values.length;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d)}
  if(loss===0)return gain===0?50:100;
  return 100-100/(1+gain/loss);
}
export function signal(history){
  if(history.length<22)return "hold";
  const closes=history.map(c=>c.close),prev=closes.slice(0,-1),fast=sma(closes,9),slow=sma(closes,21),beforeFast=sma(prev,9),beforeSlow=sma(prev,21),momentum=rsi(closes);
  if(beforeFast<=beforeSlow&&fast>slow&&momentum>=40&&momentum<=70)return "buy";
  if(beforeFast>=beforeSlow&&fast<slow)return "sell";
  return "hold";
}
export function newPaper(config=DEFAULTS){
  const capital=Number(config.capital);if(!Number.isFinite(capital)||capital<10||capital>1000000)throw new Error("Capital must be $10–$1,000,000");
  return {cash:capital,initial:capital,position:null,trades:[],lastCandle:0,day:"",dayStart:capital,dayTrades:0,paused:true};
}
export function paperStep(state,history,price,config=DEFAULTS){
  if(!state||!Array.isArray(history)||history.length<22||!Number.isFinite(price)||price<=0)throw new Error("Invalid paper trade input");
  const c=history.at(-1),day=new Date(c.time).toISOString().slice(0,10);
  if(c.time<=state.lastCandle)return {...state};
  let s={...state,trades:[...state.trades],lastCandle:c.time};
  if(s.day!==day){s.day=day;s.dayStart=s.cash+(s.position?.qty||0)*price;s.dayTrades=0}
  const decision=signal(history),fee=config.fee;
  if(s.position){
    const p=s.position;
    let reason=price<=p.entry*(1-config.stop)?"stop":price>=p.entry*(1+config.take)?"take":decision==="sell"?"signal":null;
    if(reason){const proceeds=p.qty*price*(1-fee),pnl=proceeds-p.cost;s.cash+=proceeds;s.position=null;s.trades.push({time:c.time,side:"sell",price,qty:p.qty,fee:p.qty*price*fee,pnl,reason});}
  }else if(decision==="buy"&&s.dayTrades<config.maxTrades&&s.cash>=10){
    const equity=s.cash,loss=s.dayStart-equity;
    if(loss<config.dailyLoss*s.dayStart){
      const spend=Math.min(s.cash,Math.min(s.initial*config.allocation,equity*config.allocation));
      if(spend>=5){const qty=spend/(price*(1+fee));s.cash-=spend;s.position={qty,entry:price,cost:spend};s.dayTrades++;s.trades.push({time:c.time,side:"buy",price,qty,fee:qty*price*fee,reason:"signal"});}
    }
  }
  s.trades=s.trades.slice(-500);return s;
}
export function backtest(raw,config=DEFAULTS){
  const data=candles(raw),cut=Math.max(22,Math.floor(data.length*0.7));
  if(data.length<60)throw new Error("At least 60 valid candles needed");
  let state=newPaper(config),trainingEquity=null;for(let i=22;i<data.length;i++){
    // Signal sees only candles closed BEFORE the simulated fill at next open.
    state=paperStep(state,data.slice(0,i),data[i].open,config);
    if(i===cut-1)trainingEquity=state.cash+(state.position?.qty||0)*data[i].close;
  }
  return {candles:data.length,training:data[cut-1].time,validation:data.length-cut,trainingEquity,initial:state.initial,equity:state.cash+(state.position?.qty||0)*data.at(-1).close,trades:state.trades,openPosition:!!state.position,warning:"Historical simulation, not a forecast. The final 30% is an out-of-sample period; this strategy was not optimized on it."};
}
