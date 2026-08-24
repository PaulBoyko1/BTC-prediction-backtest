import assert from 'node:assert/strict';
import { generateDemoDataset } from '../src/mockData.js';
import { runBacktest, runParameterSweep, equityDifference } from '../src/backtest.js';
import { defaultExecutionSettings, defaultRiskSettings, defaultDataSettings } from '../src/catalog.js';

const rows = generateDemoDataset(1, 123);
assert.ok(rows.length > 1000, 'demo dataset should contain enough observations');
assert.ok(rows.some((row) => row.kalshiOutcomeYes !== row.polyOutcomeYes), 'demo should contain some venue-specific settlement disagreements');

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

const risk = {
  ...defaultRiskSettings,
  sizingMode: 'fixed_pct',
  fixedTradePct: 1,
  slippageCents: 0,
  entryFeeCents: 0,
  exitFeeCents: 0,
};
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
assert.equal(sweep.length, 3, 'ascending parameter sweep should evaluate each requested threshold');
assert.ok(sweep.every((point) => Number.isFinite(point.totalReturn)), 'sweep results should be numeric');

const descendingSweep = runParameterSweep({
  rows,
  factors: [baseFactor],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings,
  factorInstanceId: 'price-1',
  fieldKey: 'value',
  start: 0.50,
  end: 0.40,
  step: 0.05,
  fillMode: 'ask',
});
assert.deepEqual(descendingSweep.map((point) => point.value), [0.5, 0.45, 0.4], 'descending parameter sweeps should work');

const difference = equityDifference(
  [
    { timestamp: '2026-01-01T00:00:00Z', equity: 100 },
    { timestamp: '2026-01-01T00:00:02Z', equity: 120 },
  ],
  [
    { timestamp: '2026-01-01T00:00:00Z', equity: 100 },
    { timestamp: '2026-01-01T00:00:01Z', equity: 90 },
    { timestamp: '2026-01-01T00:00:03Z', equity: 110 },
  ],
  100,
);
assert.deepEqual(difference.map((point) => point.equity), [0, 10, 30, 10], 'venue difference curve must forward-fill the last observed equity');

const noQuoteRows = [{
  timestamp: '2026-01-01T00:00:00Z',
  expiryTs: Date.parse('2026-01-01T00:15:00Z'),
  contractId: 'missing-quote',
  marketHorizon: '15m',
  secondsRemaining: 900,
  strike: 100000,
  btcPrice: 100000,
  compositePrice: 100000,
  realizedVolPct: 50,
  kalshiOutcomeYes: true,
}];
const noQuote = runBacktest({
  rows: noQuoteRows,
  factors: [{ ...baseFactor, values: { ...baseFactor.values, value: 0.99 } }],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings,
  fillMode: 'ask',
});
assert.equal(noQuote.metrics.trades, 0, 'missing quotes must not be replaced by an invented 50-cent price');

const crossedRows = [
  {
    timestamp: '2026-01-01T00:00:00Z', contractId: 'c1', marketHorizon: '15m', expiryTs: '2026-01-01T00:15:00Z', secondsRemaining: 900,
    strike: 100000, btcPrice: 100000, compositePrice: 100000, realizedVolPct: 50, kalshiOutcomeYes: true,
    kalshiYesBid: 0.39, kalshiYesAsk: 0.40,
  },
  {
    timestamp: '2026-01-01T00:00:01Z', contractId: 'c2', marketHorizon: '15m', expiryTs: '2026-01-01T00:15:01Z', secondsRemaining: 900,
    strike: 100000, btcPrice: 100000, compositePrice: 100000, realizedVolPct: 50, kalshiOutcomeYes: true,
    kalshiYesBid: 0.79, kalshiYesAsk: 0.80,
  },
  {
    timestamp: '2026-01-01T00:00:02Z', contractId: 'c1', marketHorizon: '15m', expiryTs: '2026-01-01T00:15:00Z', secondsRemaining: 898,
    strike: 100000, btcPrice: 100000, compositePrice: 100000, realizedVolPct: 50, kalshiOutcomeYes: true,
    kalshiYesBid: 0.59, kalshiYesAsk: 0.60,
  },
];
const crossFactor = {
  instanceId: 'cross-1',
  type: 'pm_price',
  values: { venue: 'Kalshi', side: 'YES', operator: 'crosses_up', value: 0.50, marketHorizon: '15m' },
};
const crossed = runBacktest({
  rows: crossedRows,
  factors: [crossFactor],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings,
  fillMode: 'ask',
});
assert.equal(crossed.metrics.trades, 1, 'prediction-price crossing must compare with the prior observation of the same contract');
assert.equal(crossed.trades[0].contractId, 'c1');

const venueOutcomeRows = [{
  timestamp: '2026-01-01T00:00:00Z', contractId: 'venue-outcome', marketHorizon: '15m', expiryTs: '2026-01-01T00:15:00Z', secondsRemaining: 900,
  strike: 100000, btcPrice: 100000, compositePrice: 100000, realizedVolPct: 50,
  kalshiOutcomeYes: true, polyOutcomeYes: false,
  kalshiYesBid: 0.39, kalshiYesAsk: 0.40, polyYesBid: 0.39, polyYesAsk: 0.40,
}];
for (const [venue, expectedWins] of [['Kalshi', 1], ['Polymarket', 0]]) {
  const result = runBacktest({
    rows: venueOutcomeRows,
    factors: [{ ...baseFactor, values: { ...baseFactor.values, value: 0.50 } }],
    joinMode: 'AND',
    risk,
    execution: { ...defaultExecutionSettings, tradeVenue: venue, marketHorizon: '15m' },
    dataSettings,
    fillMode: 'ask',
  });
  assert.equal(result.metrics.settlementWins, expectedWins, `${venue} must use its own settlement outcome`);
}

const missingReferenceRows = [{
  timestamp: '2026-01-01T00:00:00Z', contractId: 'missing-reference', marketHorizon: '15m', expiryTs: '2026-01-01T00:15:00Z', secondsRemaining: 900,
  strike: 100000, btcPrice: 100000, compositePrice: 100000, realizedVolPct: 50, kalshiOutcomeYes: true,
  kalshiYesBid: 0.39, kalshiYesAsk: 0.40,
}];
const referenceFactor = {
  instanceId: 'reference-1', type: 'reference_vs_spot',
  values: { reference: 'Kalshi CF BRTI 60s average', operator: 'abs<=', dollars: 0 },
};
const exactMissing = runBacktest({
  rows: missingReferenceRows,
  factors: [referenceFactor],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: { ...dataSettings, referenceMode: 'Venue rule' },
  fillMode: 'ask',
});
assert.equal(exactMissing.metrics.trades, 0, 'venue-reference mode must not silently substitute BTC spot when exact reference is absent');
const proxyAllowed = runBacktest({
  rows: missingReferenceRows,
  factors: [referenceFactor],
  joinMode: 'AND',
  risk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: { ...dataSettings, referenceMode: 'BTC spot only (diagnostic)' },
  fillMode: 'ask',
});
assert.equal(proxyAllowed.metrics.trades, 1, 'explicit BTC-spot diagnostic mode may use the selected spot proxy');

console.log(`Smoke tests passed: ${rows.length} demo rows plus regression fixtures for quotes, crossings, outcomes, references, sweeps and equity differences.`);
