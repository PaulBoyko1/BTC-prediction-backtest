import assert from 'node:assert/strict';
import { runBacktest } from '../src/backtest.js';
import { generateDemoDataset } from '../src/mockData.js';
import { defaultExecutionSettings, defaultRiskSettings, defaultDataSettings } from '../src/catalog.js';

const risk = {
  ...defaultRiskSettings,
  sizingMode: 'fixed_contracts',
  fixedContracts: 100,
  maxTradePct: 100,
  maxExposurePct: 100,
  slippageCents: 0,
  entryFeeCents: 0,
  exitFeeCents: 0,
};
const dataSettings = { ...defaultDataSettings };
const autoExecution = { ...defaultExecutionSettings, tradeSide: 'AUTO', tradeVenue: 'Kalshi', marketHorizon: '15m' };
const priceFactor = {
  instanceId: 'price', type: 'pm_price',
  values: { venue: 'Trade target venue', side: 'Trade target side', operator: '<=', value: 0.45, marketHorizon: 'Trade target' },
};

function row(overrides = {}) {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    expiryTs: '2026-01-01T00:15:00Z',
    contractId: 'c1',
    marketHorizon: '15m',
    secondsRemaining: 900,
    strike: 100000,
    compositePrice: 100000,
    btcPrice: 100000,
    compositeRealizedVolPct: 50,
    realizedVolPct: 50,
    kalshiOutcomeYes: true,
    kalshiYesBid: 0.55,
    kalshiYesAsk: 0.57,
    kalshiYesMid: 0.56,
    ...overrides,
  };
}

// YES 57c / inferred NO ask 45c -> AUTO must buy NO.
const autoNo = runBacktest({ rows: [row()], factors: [priceFactor], joinMode: 'AND', risk, execution: autoExecution, dataSettings, fillMode: 'ask' });
assert.equal(autoNo.metrics.trades, 1);
assert.equal(autoNo.trades[0].side, 'NO');
assert.ok(Math.abs(autoNo.trades[0].rawEntryPrice - 0.45) < 1e-12);
assert.ok(Math.abs(autoNo.trades[0].shares - 100) < 1e-9, 'fixed-contract sizing should buy the requested contract count');

// YES ask 45c / NO ask 57c -> AUTO must buy YES.
const autoYes = runBacktest({ rows: [row({ kalshiYesBid: 0.43, kalshiYesAsk: 0.45, kalshiYesMid: 0.44 })], factors: [priceFactor], joinMode: 'AND', risk, execution: autoExecution, dataSettings, fillMode: 'ask' });
assert.equal(autoYes.metrics.trades, 1);
assert.equal(autoYes.trades[0].side, 'YES');
assert.ok(Math.abs(autoYes.trades[0].rawEntryPrice - 0.45) < 1e-12);

// Price-band semantics: “buy at 45c” can mean near 45c, not every cheaper contract.
const bandFactor = {
  instanceId: 'band', type: 'pm_price',
  values: { venue: 'Trade target venue', side: 'Trade target side', operator: 'within', value: 0.45, tolerance: 0.01, marketHorizon: 'Trade target' },
};
const bandNo = runBacktest({ rows: [row()], factors: [bandFactor], joinMode: 'AND', risk, execution: autoExecution, dataSettings, fillMode: 'ask' });
assert.equal(bandNo.metrics.trades, 1);
assert.equal(bandNo.trades[0].side, 'NO');
const tooCheapYes = runBacktest({ rows: [row({ kalshiYesBid: 0.18, kalshiYesAsk: 0.20, kalshiYesMid: 0.19 })], factors: [bandFactor], joinMode: 'AND', risk, execution: autoExecution, dataSettings, fillMode: 'ask' });
assert.equal(tooCheapYes.metrics.trades, 0, '20c YES / 82c NO should not count as “near 45c”');

// Product convention: when AUTO has no price rule to choose a side, it defaults to YES / UP.
const btcOnly = runBacktest({
  rows: [row({ compositePrice: 100020 })],
  factors: [{ instanceId: 'round', type: 'round_level', values: { rounding: '$1,000', distance: 100 } }],
  joinMode: 'AND', risk, execution: autoExecution, dataSettings, fillMode: 'ask',
});
assert.equal(btcOnly.metrics.trades, 1);
assert.equal(btcOnly.trades[0].side, 'YES');
assert.ok(btcOnly.metrics.autoYesFallbacks >= 1);
assert.ok(btcOnly.warnings.some((w) => w.includes('defaulted to YES / UP')));

// The synthetic demo must not contain the old persistent manufactured 45c edge.
const edges = [];
for (let seed = 1; seed <= 6; seed += 1) {
  const demo = generateDemoDataset(1, seed);
  const result = runBacktest({
    rows: demo,
    factors: [priceFactor],
    joinMode: 'AND',
    risk,
    execution: autoExecution,
    dataSettings,
    fillMode: 'midpoint',
  });
  edges.push(result.metrics.empiricalEdge);
}
const meanEdge = edges.reduce((a, b) => a + b, 0) / edges.length;
assert.ok(Math.abs(meanEdge) < 0.015, `synthetic 45c demo edge should average near zero; got ${(meanEdge * 100).toFixed(2)} pts`);
assert.ok(edges.some((e) => e > 0) && edges.some((e) => e < 0), 'demo seeds should not all point in the same profitable direction');

// Compounding remains available, but the engine must flag its interpretation.
const compoundDemo = generateDemoDataset(1, 7);
const compounded = runBacktest({
  rows: compoundDemo,
  factors: [priceFactor],
  joinMode: 'AND',
  risk: { ...risk, sizingMode: 'fixed_pct', fixedTradePct: 2 },
  execution: autoExecution,
  dataSettings,
  fillMode: 'midpoint',
});
assert.ok(compounded.metrics.trades >= 500);
assert.ok(compounded.warnings.some((w) => w.includes('compounds position size')));

console.log(`AUTO-side + demo-calibration tests passed; mean six-seed midpoint edge ${(meanEdge * 100).toFixed(2)} pts.`);
