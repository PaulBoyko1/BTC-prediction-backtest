import assert from 'node:assert/strict';
import { runBacktest, contractPrice } from '../src/backtest.js';

const risk = {
  startingCapital: 10000,
  sizingMode: 'fixed_pct', fixedTradePct: 10,
  kellyFraction: 1, kellyLookback: 1, kellyPriorWins: 1, kellyPriorLosses: 1,
  maxTradePct: 100, maxExposurePct: 100, minEdgePct: 0,
  slippageCents: 0, entryFeeCents: 0, exitFeeCents: 0,
};
const data = { btcSource: 'Composite (Binance + Coinbase)', referenceMode: 'Venue rule' };
const execution = {
  tradeVenue: 'Kalshi', tradeSide: 'YES', marketHorizon: '15m',
  entryObservation: 'ask', reentryMode: 'repeat', maxEntriesPerContract: 10,
  entryCooldownSeconds: 0, exitMode: 'target', exitTarget: 0.55,
  stopPrice: 0.30, exitSecondsRemaining: 30,
};
const factor = { instanceId:'f', type:'pm_price', values:{ venue:'Kalshi', side:'YES', operator:'<=', value:0.45, marketHorizon:'15m' } };
function row(t, id='c', overrides={}) {
  return {
    timestamp: `2026-01-01T00:00:${String(t).padStart(2,'0')}.000Z`,
    expiryTs: '2026-01-01T00:15:00.000Z', contractId:id, marketHorizon:'15m', secondsRemaining:900-t,
    strike:100000, compositePrice:100000, realizedVolPct:50, compositeRealizedVolPct:50,
    kalshiOutcomeYes:false, kalshiYesBid:.44, kalshiYesAsk:.45, kalshiYesMid:.445,
    ...overrides,
  };
}

// A target is based on executable sell price (bid), not the visible ask.
{
  const rows=[row(0), row(10,'c',{kalshiYesBid:.54,kalshiYesAsk:.61,kalshiYesMid:.575}), row(20,'c',{kalshiYesBid:.55,kalshiYesAsk:.61,kalshiYesMid:.58})];
  const r=runBacktest({rows,factors:[factor],risk,execution,dataSettings:data,fillMode:'ask'});
  assert.equal(r.trades.length,1);
  assert.equal(r.trades[0].exitTs, Date.parse('2026-01-01T00:00:20.000Z'));
  assert.equal(r.trades[0].exitPrice,.55);
}

// Final settlement direction must not change a completed early-exit P/L.
{
  const yesRows=[row(0,'yes',{kalshiOutcomeYes:true}), row(10,'yes',{kalshiOutcomeYes:true,kalshiYesBid:.56,kalshiYesAsk:.57})];
  const noRows=[row(0,'no',{kalshiOutcomeYes:false}), row(10,'no',{kalshiOutcomeYes:false,kalshiYesBid:.56,kalshiYesAsk:.57})];
  const a=runBacktest({rows:yesRows,factors:[factor],risk,execution,dataSettings:data,fillMode:'ask'}).trades[0];
  const b=runBacktest({rows:noRows,factors:[factor],risk,execution,dataSettings:data,fillMode:'ask'}).trades[0];
  assert.equal(a.pnl,b.pnl);
  assert.ok(a.pnl>0 && b.pnl>0);
}

// Explicit NO book must win over 1-YES reconstruction.
{
  const r=row(0,'n',{kalshiYesBid:.30,kalshiYesAsk:.40,kalshiNoBid:.57,kalshiNoAsk:.59,kalshiNoMid:.58});
  assert.equal(contractPrice(r,'Kalshi','NO','ask','buy'),.59);
  assert.equal(contractPrice(r,'Kalshi','NO','ask','sell'),.57);
}

// IMPORTANT USER-INTENT TEST: repeat means another low->high cycle after the
// prior position closes, not pyramiding multiple concurrent positions while the
// same low-price condition remains true.
{
  const rows=[
    row(0,'cycle',{kalshiYesBid:.43,kalshiYesAsk:.45}),
    row(1,'cycle',{kalshiYesBid:.43,kalshiYesAsk:.45}),
    row(10,'cycle',{kalshiYesBid:.56,kalshiYesAsk:.57}),
  ];
  const r=runBacktest({rows,factors:[factor],risk,execution,dataSettings:data,fillMode:'ask'});
  assert.equal(r.trades.length,1,'repeat cycle should not stack concurrent same-contract positions');
}

// A target exit and a new entry must not happen from the exact same snapshot.
{
  const always={instanceId:'always',type:'pm_price',values:{venue:'Kalshi',side:'YES',operator:'<=',value:.99,marketHorizon:'15m'}};
  const rows=[
    row(0,'sameTick',{kalshiYesBid:.44,kalshiYesAsk:.45}),
    row(10,'sameTick',{kalshiYesBid:.56,kalshiYesAsk:.57}),
    row(11,'sameTick',{kalshiYesBid:.56,kalshiYesAsk:.57}),
  ];
  const r=runBacktest({rows,factors:[always],risk,execution,dataSettings:data,fillMode:'ask'});
  assert.equal(r.trades.length,2,'first target exit plus one later re-entry that settles; no same-snapshot churn');
  assert.equal(r.trades[0].exitTs,Date.parse('2026-01-01T00:00:10.000Z'));
  assert.equal(r.trades[1].timestamp,'2026-01-01T00:00:11.000Z');
}

// Kelly history with a finite lookback must be ordered by resolution/expiry,
// not by original entry array order when several contracts settle between ticks.
{
  const kRisk={...risk,sizingMode:'kelly',kellyFraction:1,kellyLookback:1,fixedTradePct:10};
  const kExec={...execution,reentryMode:'once',exitMode:'expiry'};
  const always={instanceId:'a',type:'pm_price',values:{venue:'Kalshi',side:'YES',operator:'<=',value:.99,marketHorizon:'15m'}};
  const rows=[
    row(0,'A',{expiryTs:'2026-01-01T00:00:30.000Z',secondsRemaining:30,kalshiOutcomeYes:false,kalshiYesAsk:.20,kalshiYesBid:.19,kalshiYesMid:.195}),
    row(1,'B',{expiryTs:'2026-01-01T00:00:20.000Z',secondsRemaining:19,kalshiOutcomeYes:true,kalshiYesAsk:.20,kalshiYesBid:.19,kalshiYesMid:.195}),
    row(35,'C',{expiryTs:'2026-01-01T00:00:50.000Z',secondsRemaining:15,kalshiOutcomeYes:true,kalshiYesAsk:.20,kalshiYesBid:.19,kalshiYesMid:.195}),
  ];
  const r=runBacktest({rows,factors:[always],risk:kRisk,execution:kExec,dataSettings:data,fillMode:'ask'});
  const c=r.trades.find(x=>x.contractId==='C');
  assert.ok(c,'C should enter');
  const eqBefore=c.before;
  const expected=eqBefore/6;
  assert.ok(Math.abs(c.allocation-expected)<1e-6,`C allocation ${c.allocation} should equal expiry-ordered Kelly ${expected}`);
}

console.log('all adversarial assertions passed');
