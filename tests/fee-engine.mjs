import assert from 'node:assert/strict';
import { runBacktest } from '../src/backtest.js';
import { defaultExecutionSettings, defaultRiskSettings, defaultDataSettings } from '../src/catalog.js';
import { cloneFeeSettings, defaultFeeSettings, sampleVenueFee, calculateVenueFee } from '../src/fees.js';

const fees = cloneFeeSettings(defaultFeeSettings);
assert.equal(sampleVenueFee(fees, 'Kalshi', 100, 0.45, 'taker'), 1.74, 'Kalshi current BTC15m taker preset should match official 100@45c table');
assert.equal(sampleVenueFee(fees, 'Kalshi', 100, 0.45, 'maker'), 0, 'Kalshi BTC15m maker multiplier defaults to zero in current general schedule');
assert.equal(sampleVenueFee(fees, 'Polymarket', 100, 0.45, 'taker'), 1.7325, 'Polymarket crypto taker formula should be 100*.07*.45*.55');
assert.equal(sampleVenueFee(fees, 'Polymarket', 100, 0.45, 'maker'), 0, 'Polymarket makers are fee-free');

const custom = cloneFeeSettings(defaultFeeSettings);
custom.profiles.Polymarket.formula = 'rate*C';
custom.profiles.Polymarket.takerRatePct = 2;
custom.profiles.Polymarket.rounding = 'none';
assert.equal(calculateVenueFee({ settings: custom, venue: 'Polymarket', contracts: 100, price: 0.45, liquidity: 'taker', direction: 'buy', phase: 'entry' }), 2);
custom.enabled = false;
assert.equal(sampleVenueFee(custom, 'Polymarket', 100, 0.45, 'taker'), 0, 'master fee switch must disable formula fees');

function row(timestamp, bid, ask, outcome = true) {
  return {
    timestamp,
    contractId: 'fee-fixture',
    marketHorizon: '15m',
    expiryTs: '2026-01-01T00:15:00.000Z',
    secondsRemaining: Math.max(1, Math.round((Date.parse('2026-01-01T00:15:00.000Z') - Date.parse(timestamp))/1000)),
    strike: 100000,
    compositePrice: 100000,
    btcPrice: 100000,
    binancePrice: 100000,
    coinbasePrice: 100000,
    compositeRealizedVolPct: 50,
    realizedVolPct: 50,
    kalshiOutcomeYes: outcome,
    polyOutcomeYes: outcome,
    kalshiYesBid: bid,
    kalshiYesAsk: ask,
    kalshiYesMid: (bid+ask)/2,
    polyYesBid: bid,
    polyYesAsk: ask,
    polyYesMid: (bid+ask)/2,
  };
}
const factor = { instanceId:'price', type:'pm_price', values:{ venue:'Trade target venue', side:'Trade target side', operator:'<=', value:0.45, tolerance:0.01, marketHorizon:'15m' } };
const risk = { ...defaultRiskSettings, sizingMode:'fixed_contracts', fixedContracts:100, maxTradePct:100, maxExposurePct:100, slippageCents:0, entryFeeCents:0, exitFeeCents:0 };
const dataSettings = { ...defaultDataSettings };
const execution = { ...defaultExecutionSettings, tradeVenue:'Kalshi', tradeSide:'YES', marketHorizon:'15m', exitMode:'expiry' };

const expiry = runBacktest({ rows:[row('2026-01-01T00:00:00.000Z',0.44,0.45,true)], factors:[factor], joinMode:'AND', risk, execution, dataSettings, feeSettings:fees, fillMode:'ask' });
assert.equal(expiry.metrics.trades, 1);
assert.equal(expiry.trades[0].entryFee, 1.74);
assert.equal(expiry.trades[0].exitFee, 0, 'ordinary binary settlement should not charge a trading exit fee');
assert.ok(Math.abs(expiry.trades[0].pnl - 53.26) < 1e-9);
assert.equal(expiry.metrics.totalFees, 1.74);

const early = runBacktest({ rows:[row('2026-01-01T00:00:00.000Z',0.44,0.45,false),row('2026-01-01T00:00:10.000Z',0.55,0.56,false)], factors:[factor], joinMode:'AND', risk, execution:{...execution,exitMode:'target',exitTarget:0.55}, dataSettings, feeSettings:fees, fillMode:'ask' });
assert.equal(early.metrics.trades, 1);
assert.equal(early.trades[0].entryFee, 1.74);
assert.equal(early.trades[0].exitFee, 1.74);
assert.ok(Math.abs(early.trades[0].pnl - 6.52) < 1e-9, '45c -> 55c cycle must subtract both taker fees');
assert.ok(Math.abs(early.trades[0].grossPnlBeforeFees - 10) < 1e-9);

const off = cloneFeeSettings(fees); off.enabled = false;
const noFee = runBacktest({ rows:[row('2026-01-01T00:00:00.000Z',0.44,0.45,true)], factors:[factor], joinMode:'AND', risk, execution, dataSettings, feeSettings:off, fillMode:'ask' });
assert.equal(noFee.metrics.totalFees, 0);
assert.ok(Math.abs(noFee.trades[0].pnl - 55) < 1e-9);

console.log('Fee-engine tests passed: official presets, master OFF, custom formula, entry/exit cash fees, settlement behavior.');
