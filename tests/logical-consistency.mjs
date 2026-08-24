import assert from 'node:assert/strict';
import { contractPrice, runBacktest } from '../src/backtest.js';
import { defaultExecutionSettings, defaultRiskSettings, defaultDataSettings } from '../src/catalog.js';

const baseRisk = {
  ...defaultRiskSettings,
  sizingMode: 'fixed_pct',
  fixedTradePct: 1,
  maxTradePct: 100,
  maxExposurePct: 100,
  slippageCents: 0,
  entryFeeCents: 0,
  exitFeeCents: 0,
};
const baseData = { ...defaultDataSettings };

function baseRow(overrides = {}) {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    expiryTs: '2026-01-01T00:15:00.000Z',
    contractId: 'c1',
    marketHorizon: '15m',
    secondsRemaining: 900,
    strike: 100000,
    compositePrice: 100000,
    btcPrice: 100000,
    binancePrice: 100000,
    coinbasePrice: 100000,
    compositeVwap: 99900,
    binanceVwap: 99900,
    coinbaseVwap: 99900,
    compositeEmaFast: 100010,
    compositeEmaSlow: 100000,
    binanceEmaFast: 100010,
    binanceEmaSlow: 100000,
    coinbaseEmaFast: 100010,
    coinbaseEmaSlow: 100000,
    compositeYesterdayHigh: 101000,
    binanceYesterdayHigh: 101000,
    coinbaseYesterdayHigh: 101000,
    compositeYesterdayLow: 99000,
    binanceYesterdayLow: 99000,
    coinbaseYesterdayLow: 99000,
    compositeYesterdayClose: 99500,
    binanceYesterdayClose: 99500,
    coinbaseYesterdayClose: 99500,
    compositePriorWeekAvgClose: 99000,
    binancePriorWeekAvgClose: 99000,
    coinbasePriorWeekAvgClose: 99000,
    compositePriorWeekHigh: 102000,
    binancePriorWeekHigh: 102000,
    coinbasePriorWeekHigh: 102000,
    compositePriorWeekLow: 98000,
    binancePriorWeekLow: 98000,
    coinbasePriorWeekLow: 98000,
    compositePriorWeekClose: 99500,
    binancePriorWeekClose: 99500,
    coinbasePriorWeekClose: 99500,
    compositeRealizedVolPct: 50,
    binanceRealizedVolPct: 50,
    coinbaseRealizedVolPct: 50,
    realizedVolPct: 50,
    kalshiOutcomeYes: true,
    polyOutcomeYes: true,
    kalshiYesBid: 0.39,
    kalshiYesAsk: 0.41,
    kalshiYesMid: 0.40,
    polyYesBid: 0.39,
    polyYesAsk: 0.41,
    polyYesMid: 0.40,
    ...overrides,
  };
}

function alwaysFactor(venue = 'Trade target venue', side = 'Trade target side') {
  return {
    instanceId: 'always',
    type: 'pm_price',
    values: { venue, side, operator: '<=', value: 0.99, marketHorizon: '15m' },
  };
}

// Polymarket NO is a distinct token/book. Explicit NO quotes must be preferred
// instead of blindly inferring 1 - YES.
const polyNoRow = baseRow({
  polyYesBid: 0.39,
  polyYesAsk: 0.41,
  polyNoBid: 0.53,
  polyNoAsk: 0.55,
  polyNoMid: 0.54,
  polyNoLast: 0.545,
});
assert.equal(contractPrice(polyNoRow, 'Polymarket', 'NO', 'ask', 'buy'), 0.55);
assert.equal(contractPrice(polyNoRow, 'Polymarket', 'NO', 'ask', 'sell'), 0.53);
assert.equal(contractPrice(polyNoRow, 'Polymarket', 'NO', 'midpoint', 'buy'), 0.54);
assert.equal(contractPrice(polyNoRow, 'Polymarket', 'NO', 'last', 'buy'), 0.545);

// If a specific BTC source is selected, missing source data must not silently
// fall back to generic/composite BTC.
const missingBinance = runBacktest({
  rows: [baseRow({ binancePrice: undefined })],
  factors: [{
    instanceId: 'round', type: 'round_level', values: { rounding: '$1,000', distance: 100 },
  }],
  joinMode: 'AND',
  risk: baseRisk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: { ...baseData, btcSource: 'Binance' },
  fillMode: 'ask',
});
assert.equal(missingBinance.metrics.trades, 0, 'explicit Binance selection must fail closed when Binance price is missing');

// Source-specific technical features must follow the selected BTC venue.
const sourceRow = baseRow({
  compositePrice: 100100,
  compositeVwap: 100000,
  binancePrice: 99900,
  binanceVwap: 100000,
});
const vwapFactor = {
  instanceId: 'vwap', type: 'vwap_setup',
  values: { setup: 'Bullish bias', session: 'UTC day', tolerancePct: 0, confirmationBars: 0 },
};
const compositeVwap = runBacktest({
  rows: [sourceRow], factors: [vwapFactor], joinMode: 'AND', risk: baseRisk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: { ...baseData, btcSource: 'Composite (Binance + Coinbase)' }, fillMode: 'ask',
});
const binanceVwap = runBacktest({
  rows: [sourceRow], factors: [vwapFactor], joinMode: 'AND', risk: baseRisk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: { ...baseData, btcSource: 'Binance' }, fillMode: 'ask',
});
assert.equal(compositeVwap.metrics.trades, 1);
assert.equal(binanceVwap.metrics.trades, 0, 'Binance VWAP test must not reuse composite VWAP/spot');

// BTC crossing factors must use a prior *time* observation, not another contract
// snapshot sharing the same timestamp.
const sameTimestampRows = [
  baseRow({ timestamp: '2026-01-01T00:00:00.000Z', contractId: 'old', compositePrice: 99900, compositeYesterdayHigh: 100000, kalshiYesAsk: 0.4 }),
  baseRow({ timestamp: '2026-01-01T00:00:01.000Z', contractId: 'other', compositePrice: 100100, compositeYesterdayHigh: 100000, kalshiYesAsk: 0.4 }),
  baseRow({ timestamp: '2026-01-01T00:00:01.000Z', contractId: 'target', compositePrice: 100100, compositeYesterdayHigh: 100000, kalshiYesAsk: 0.4 }),
];
const dayCross = {
  instanceId: 'day-cross', type: 'prior_day_level',
  values: { level: 'High', operator: 'crosses_up', tolerancePct: 0.15 },
};
const crossing = runBacktest({
  rows: sameTimestampRows,
  factors: [dayCross],
  joinMode: 'AND',
  risk: baseRisk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m', reentryMode: 'repeat' },
  dataSettings: baseData,
  fillMode: 'ask',
});
assert.ok(crossing.trades.some((trade) => trade.contractId === 'target'), 'same-timestamp unrelated contract must not erase a valid BTC cross');

// Re-entry cooldown is a per-contract control: activity in one contract must not
// suppress another contract firing during the same global interval.
const cooldownRows = [
  baseRow({ timestamp: '2026-01-01T00:00:00.000Z', contractId: 'a', expiryTs: '2026-01-01T00:15:00Z' }),
  baseRow({ timestamp: '2026-01-01T00:00:01.000Z', contractId: 'b', expiryTs: '2026-01-01T00:15:01Z' }),
  baseRow({ timestamp: '2026-01-01T00:00:02.000Z', contractId: 'a', expiryTs: '2026-01-01T00:15:00Z' }),
];
const cooldownResult = runBacktest({
  rows: cooldownRows,
  factors: [alwaysFactor()],
  joinMode: 'AND',
  risk: baseRisk,
  execution: {
    ...defaultExecutionSettings,
    tradeVenue: 'Kalshi', marketHorizon: '15m', reentryMode: 'repeat', entryCooldownSeconds: 10,
  },
  dataSettings: baseData,
  fillMode: 'ask',
});
assert.equal(cooldownResult.trades.filter((t) => t.contractId === 'a').length, 1, 'same contract must respect cooldown');
assert.equal(cooldownResult.trades.filter((t) => t.contractId === 'b').length, 1, 'different contract must not be blocked by another contract cooldown');

// Spread/exit friction must hit marked equity immediately after entry rather than
// appearing only on the next market observation.
const spreadResult = runBacktest({
  rows: [baseRow({ kalshiYesBid: 0.30, kalshiYesAsk: 0.40 })],
  factors: [alwaysFactor()], joinMode: 'AND', risk: baseRisk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: baseData, fillMode: 'ask',
});
assert.ok(spreadResult.metrics.maxDrawdown > 0, 'entry spread must be visible in equity/max drawdown immediately');

// Fees alter cost/breakeven but are not a market probability; calibration metrics
// should therefore remain unchanged when only fixed fee allowance changes.
const calibrationRow = baseRow({ kalshiYesBid: 0.49, kalshiYesAsk: 0.51, kalshiYesMid: 0.50 });
const noFeeCalibration = runBacktest({
  rows: [calibrationRow], factors: [alwaysFactor()], joinMode: 'AND', risk: baseRisk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: baseData, fillMode: 'ask',
});
const feeCalibration = runBacktest({
  rows: [calibrationRow], factors: [alwaysFactor()], joinMode: 'AND',
  risk: { ...baseRisk, entryFeeCents: 10 },
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: baseData, fillMode: 'ask',
});
assert.equal(noFeeCalibration.metrics.brier, feeCalibration.metrics.brier, 'fees must not change Brier probability calibration');
assert.ok(feeCalibration.metrics.avgEntry > noFeeCalibration.metrics.avgEntry, 'fees must increase all-in breakeven cost');

// Combined rows may carry a legacy generic outcome. If a venue-specific outcome
// is absent, the generic label must not leak across venues.
const ambiguousOutcome = baseRow({ polyOutcomeYes: undefined, outcomeYes: true, polyYesAsk: 0.4, polyYesBid: 0.39 });
const polyAmbiguous = runBacktest({
  rows: [ambiguousOutcome], factors: [alwaysFactor()], joinMode: 'AND', risk: baseRisk,
  execution: { ...defaultExecutionSettings, tradeVenue: 'Polymarket', marketHorizon: '15m' },
  dataSettings: baseData, fillMode: 'ask',
});
assert.equal(polyAmbiguous.metrics.trades, 0, 'generic outcome must not be borrowed across a combined Kalshi/Polymarket row');

// All-in cost can exceed $1 after explicit friction. It must not be clamped below
// the binary payout ceiling, because that would fabricate economic value.
const expensive = runBacktest({
  rows: [baseRow({ kalshiYesAsk: 0.99, kalshiYesBid: 0.98, kalshiYesMid: 0.985, kalshiOutcomeYes: true })],
  factors: [alwaysFactor()], joinMode: 'AND',
  risk: { ...baseRisk, entryFeeCents: 5 },
  execution: { ...defaultExecutionSettings, tradeVenue: 'Kalshi', marketHorizon: '15m' },
  dataSettings: baseData, fillMode: 'ask',
});
assert.ok(expensive.trades[0].entryPrice > 1, 'all-in cost above $1 should remain above $1');
assert.ok(expensive.trades[0].pnl < 0, 'a winning binary contract can still lose money when all-in unit cost exceeds $1');

// Mean-reversion / defined-price-cycle idea: buy at or below 45c and sell only
// once an executable bid reaches 55c. The realized early-exit profit is logically
// independent of whether the contract would eventually settle YES.
const meanReversionRows = [
  baseRow({
    timestamp: '2026-01-01T00:00:00.000Z', contractId: 'mean-revert', kalshiOutcomeYes: false,
    kalshiYesBid: 0.44, kalshiYesAsk: 0.45, kalshiYesMid: 0.445,
  }),
  baseRow({
    timestamp: '2026-01-01T00:00:10.000Z', contractId: 'mean-revert', secondsRemaining: 890, kalshiOutcomeYes: false,
    kalshiYesBid: 0.56, kalshiYesAsk: 0.57, kalshiYesMid: 0.565,
  }),
];
const buyLowFactor = {
  instanceId: 'buy-low', type: 'pm_price',
  values: { venue: 'Kalshi', side: 'YES', operator: '<=', value: 0.45, marketHorizon: '15m' },
};
const meanReversion = runBacktest({
  rows: meanReversionRows,
  factors: [buyLowFactor],
  joinMode: 'AND',
  risk: baseRisk,
  execution: {
    ...defaultExecutionSettings,
    tradeVenue: 'Kalshi', marketHorizon: '15m', exitMode: 'target', exitTarget: 0.55,
  },
  dataSettings: baseData,
  fillMode: 'ask',
});
assert.equal(meanReversion.metrics.trades, 1, '45c -> 55c mean-reversion cycle should produce one trade');
assert.equal(meanReversion.trades[0].exitReason, 'target');
assert.equal(meanReversion.trades[0].settlementWon, false, 'fixture intentionally loses at final settlement');
assert.ok(meanReversion.trades[0].pnl > 0, 'profitable early exit must remain profitable even when final settlement would lose');

// Volatility-harvesting idea: repeat the same low->high cycle inside one contract.
// After a target exit, a later return to <=45c can open a new position; final
// binary direction is not the payoff driver for those completed cycles.
const harvestRows = [
  baseRow({ timestamp: '2026-01-01T00:00:00.000Z', contractId: 'harvest', kalshiOutcomeYes: false, kalshiYesBid: 0.43, kalshiYesAsk: 0.45, kalshiYesMid: 0.44 }),
  baseRow({ timestamp: '2026-01-01T00:00:10.000Z', contractId: 'harvest', secondsRemaining: 890, kalshiOutcomeYes: false, kalshiYesBid: 0.56, kalshiYesAsk: 0.58, kalshiYesMid: 0.57 }),
  baseRow({ timestamp: '2026-01-01T00:00:20.000Z', contractId: 'harvest', secondsRemaining: 880, kalshiOutcomeYes: false, kalshiYesBid: 0.42, kalshiYesAsk: 0.44, kalshiYesMid: 0.43 }),
  baseRow({ timestamp: '2026-01-01T00:00:30.000Z', contractId: 'harvest', secondsRemaining: 870, kalshiOutcomeYes: false, kalshiYesBid: 0.55, kalshiYesAsk: 0.57, kalshiYesMid: 0.56 }),
];
const harvested = runBacktest({
  rows: harvestRows,
  factors: [buyLowFactor],
  joinMode: 'AND',
  risk: baseRisk,
  execution: {
    ...defaultExecutionSettings,
    tradeVenue: 'Kalshi', marketHorizon: '15m', exitMode: 'target', exitTarget: 0.55,
    reentryMode: 'repeat', entryCooldownSeconds: 0,
  },
  dataSettings: baseData,
  fillMode: 'ask',
});
assert.equal(harvested.metrics.trades, 2, 'repeat low->high harvesting should support two cycles in one contract');
assert.ok(harvested.trades.every((trade) => trade.exitReason === 'target'));
assert.ok(harvested.trades.every((trade) => trade.pnl > 0));
assert.ok(harvested.trades.every((trade) => trade.settlementWon === false));

console.log('Logical-consistency cases passed: NO books, source integrity, BTC crossings, cooldowns, marking, calibration, outcomes, all-in cost, mean reversion and volatility harvesting.');
