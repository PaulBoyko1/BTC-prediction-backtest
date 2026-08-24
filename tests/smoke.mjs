import assert from 'node:assert/strict';
import { generateDemoDataset } from '../src/mockData.js';
import { runBacktest, runParameterSweep, equityDifference } from '../src/backtest.js';
import { defaultExecutionSettings, defaultRiskSettings, defaultDataSettings } from '../src/catalog.js';

const rows = generateDemoDataset(1, 123);
assert.ok(rows.length > 1000, 'demo dataset should contain enough observations');

const baseFactor = {
  instanceId: 'price-1',
  type: 'pm_price',
  values: {
    venue: 'Trade target venue',
    side: 'Trade target side',
    operator: '<=',
    value: 0.55,
    marketHorizon: 'Trade target',
  },
};

const risk = { ...defaultRiskSettings, sizingMode: 'fixed_pct', fixedTradePct: 1 };
const dataSettings = { ...defaultDataSettings };

for (const venue of ['Kalshi', 'Polymarket']) {
  for (const fillMode of ['ask', 'last', 'midpoint']) {
    const result = runBacktest({
      rows,
      factors: [baseFactor],
      joinMode: 'AND',
      risk,
      execution: { ...defaultExecutionSettings, tradeVenue: venue, marketHorizon: '15m' },
      dataSettings,
      fillMode,
    });
    assert.ok(Number.isFinite(result.metrics.endingCapital), `${venue}/${fillMode} ending capital must be finite`);
    assert.ok(result.metrics.trades >= 0, `${venue}/${fillMode} trade count must be valid`);
    assert.ok(result.equity.length > 0, `${venue}/${fillMode} equity curve must exist`);
  }
}

const mixed = runBacktest({
  rows,
  factors: [
    baseFactor,
    {
      instanceId: 'vwap-1',
      type: 'vwap_setup',
      values: { setup: 'Bullish bias', session: 'UTC day', tolerancePct: 0.15, confirmationBars: 1 },
    },
    {
      instanceId: 'move-1',
      type: 'btc_move_gate',
      values: { lookbackSeconds: 5, operator: '<=', dollars: 250 },
    },
  ],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings,
  fillMode: 'ask',
});
assert.ok(Number.isFinite(mixed.metrics.maxDrawdown), 'mixed-factor backtest should produce metrics');

const earlyExit = runBacktest({
  rows,
  factors: [baseFactor],
  joinMode: 'AND',
  risk,
  execution: {
    ...defaultExecutionSettings,
    tradeVenue: 'Kalshi',
    marketHorizon: '15m',
    exitMode: 'target_stop',
    exitTarget: 0.60,
    stopPrice: 0.30,
  },
  dataSettings,
  fillMode: 'ask',
});
assert.ok(earlyExit.trades.every((trade) => ['target', 'stop', 'expiry'].includes(trade.exitReason)), 'early exits should have valid exit reasons');

const sweep = runParameterSweep({
  rows,
  factors: [baseFactor],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings,
  factorInstanceId: 'price-1',
  fieldKey: 'value',
  start: 0.40,
  end: 0.50,
  step: 0.05,
  fillMode: 'ask',
});
assert.equal(sweep.length, 3, 'parameter sweep should evaluate each requested threshold');
assert.ok(sweep.every((point) => Number.isFinite(point.totalReturn)), 'sweep results should be numeric');

const kalshi = runBacktest({
  rows,
  factors: [baseFactor],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings,
  fillMode: 'ask',
});
const polymarket = runBacktest({
  rows,
  factors: [baseFactor],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Polymarket', marketHorizon: '15m' },
  dataSettings,
  fillMode: 'ask',
});
const difference = equityDifference(kalshi.equity, polymarket.equity, risk.startingCapital);
assert.ok(difference.length > 0, 'equity difference curve should exist');
assert.ok(difference.every((point) => Number.isFinite(point.equity)), 'difference curve must stay finite');

console.log(`Smoke tests passed: ${rows.length} demo rows, ${kalshi.metrics.trades} Kalshi trades, ${polymarket.metrics.trades} Polymarket trades.`);
