import assert from 'node:assert/strict';
import { runBacktest } from '../src/backtest.js';
import { defaultExecutionSettings, defaultRiskSettings, defaultDataSettings } from '../src/catalog.js';

const risk = {
  ...defaultRiskSettings,
  sizingMode: 'fixed_pct',
  fixedTradePct: 1,
  slippageCents: 0,
  entryFeeCents: 0,
  exitFeeCents: 0,
};
const execution = { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' };
const dataSettings = { ...defaultDataSettings };

function row(timestamp, contractId, ask, btcPrice) {
  return {
    timestamp,
    contractId,
    marketHorizon: '15m',
    expiryTs: '2026-01-01T00:15:00Z',
    secondsRemaining: 900,
    strike: 100000,
    btcPrice,
    compositePrice: btcPrice,
    binancePrice: btcPrice,
    coinbasePrice: btcPrice,
    realizedVolPct: 50,
    kalshiOutcomeYes: true,
    kalshiYesBid: ask - 0.01,
    kalshiYesAsk: ask,
    kalshiYesMid: ask - 0.005,
  };
}

const predictionRows = [
  row('2026-01-01T00:00:00Z', 'c1', 0.40, 100000),
  row('2026-01-01T00:00:05Z', 'c1', 0.45, 100005),
  row('2026-01-01T00:00:10Z', 'c1', 0.60, 100010),
];

const shortPredictionShock = runBacktest({
  rows: predictionRows,
  factors: [{
    instanceId: 'shock',
    type: 'pm_delta',
    values: { venue: 'Kalshi', lookbackSeconds: 5, operator: '>=', value: 0.18 },
  }],
  joinMode: 'AND',
  risk,
  execution,
  dataSettings,
  fillMode: 'ask',
});
const longPredictionShock = runBacktest({
  rows: predictionRows,
  factors: [{
    instanceId: 'shock',
    type: 'pm_delta',
    values: { venue: 'Kalshi', lookbackSeconds: 10, operator: '>=', value: 0.18 },
  }],
  joinMode: 'AND',
  risk,
  execution,
  dataSettings,
  fillMode: 'ask',
});
assert.equal(shortPredictionShock.metrics.trades, 0, '5-second prediction lookback should reject the final +15pt move at an 18pt threshold');
assert.equal(longPredictionShock.metrics.trades, 1, '10-second prediction lookback should qualify the final +20pt move at an 18pt threshold');

const btcRows = [
  row('2026-01-01T00:00:00Z', 'c1', 0.40, 100000),
  row('2026-01-01T00:00:05Z', 'c1', 0.42, 100090),
  row('2026-01-01T00:00:10Z', 'c1', 0.44, 100100),
];
const fiveSecondMoveGate = runBacktest({
  rows: btcRows,
  factors: [{
    instanceId: 'move',
    type: 'btc_move_gate',
    values: { lookbackSeconds: 5, operator: '<=', dollars: 20 },
  }],
  joinMode: 'AND',
  risk,
  execution,
  dataSettings,
  fillMode: 'ask',
});
const tenSecondMoveGate = runBacktest({
  rows: btcRows,
  factors: [{
    instanceId: 'move',
    type: 'btc_move_gate',
    values: { lookbackSeconds: 10, operator: '<=', dollars: 20 },
  }],
  joinMode: 'AND',
  risk,
  execution,
  dataSettings,
  fillMode: 'ask',
});
assert.equal(fiveSecondMoveGate.metrics.trades, 1, '5-second BTC move gate should qualify the +$10 final move');
assert.equal(tenSecondMoveGate.metrics.trades, 0, '10-second BTC move gate should reject the +$100 move');

console.log('Configurable prediction/BTC lookback factor tests passed.');
