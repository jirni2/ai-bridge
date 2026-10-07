import {DurableObject} from "cloudflare:workers";
import {BotEngine} from "./engine.mjs";
export class BinanceBot extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.engine=new BotEngine(ctx,env)}
  fetch(req){return this.engine.fetch(req)}
  alarm(){return this.engine.alarm()}
}
// Dashboard metrics contract for the Pages frontend:
//   GET /api/trade/metrics -> {ok, metrics:{winRate,profitFactor,sharpe,
//   maxDrawdown,calmar,avgWin,avgLoss,currentDrawdown,dailyPnl,dailyPnlLimit,
//   tradesToday,monthlyPnl,equityCurve,openPositions}}
// Auth is enforced by the Pages worker proxy in front of this route; this
// worker only serves the bot's own Durable Object here.
// The public Worker route has no trading API. Only the Pages DO binding can
// reach an instance. Keys stay exclusively in this Worker's secret bindings.
export default {
  async fetch(req,env){
    const u=new URL(req.url);
    if(req.method==="GET"&&u.pathname==="/api/trade/metrics"){
      const stub=env.BOT.get(env.BOT.idFromName("bot"));
      return stub.fetch(new Request("https://internal/metrics"));
    }
    return new Response("Not found",{status:404});
  }
};
