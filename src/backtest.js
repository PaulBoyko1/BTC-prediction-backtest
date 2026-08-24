import { calculateVenueFee } from './fees.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function compare(value, operator, threshold, previousValue = null) {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(threshold))) return false;
  if (operator === '<=') return value <= threshold;
  if (operator === '>=') return value >= threshold;
  if (operator === '<') return value < threshold;
  if (operator === '>') return value > threshold;
  if (operator === 'abs>=') return Math.abs(value) >= threshold;
  if (operator === 'abs<=') return Math.abs(value) <= threshold;
  const hasPrevious = previousValue !== null && previousValue !== undefined && Number.isFinite(Number(previousValue));
  if (operator === 'crosses_up') return hasPrevious && previousValue < threshold && value >= threshold;
  if (operator === 'crosses_down') return hasPrevious && previousValue > threshold && value <= threshold;
  return false;
}

function nearestRound(price, label) {
  const step = Number(String(label).replace(/[^0-9]/g, '')) || 1000;
  return Math.round(price / step) * step;
}

function resolveVenue(value, execution) {
  if (!value || value === 'Trade target venue') return execution.tradeVenue;
  return value;
}

function resolveSide(value, execution) {
  if (!value || value === 'Trade target side') return execution.tradeSide;
  return value;
}

function resolveHorizon(value, execution) {
  if (!value || value === 'Trade target') return execution.marketHorizon;
  return value;
}

function quoteOrFallback(row, primaryKey, fallbackKey) {
  const primary = finiteNumber(row?.[primaryKey]);
  if (Number.isFinite(primary)) return primary;
  return finiteNumber(row?.[fallbackKey]);
}

function quotedSidePrice(row, venue, side, mode = 'ask', action = 'buy') {
  const prefix = venue === 'Polymarket' ? 'poly' : 'kalshi';
  const sideName = side === 'NO' ? 'No' : 'Yes';
  const genericKey = `${prefix}${sideName}`;
  if (mode === 'last') return quoteOrFallback(row, `${prefix}${sideName}Last`, genericKey);
  if (mode === 'midpoint') {
    const explicit = finiteNumber(row?.[`${prefix}${sideName}Mid`]);
    if (Number.isFinite(explicit)) return explicit;
    const bid = quoteOrFallback(row, `${prefix}${sideName}Bid`, genericKey);
    const ask = quoteOrFallback(row, `${prefix}${sideName}Ask`, genericKey);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return Number.NaN;
    return (bid + ask) / 2;
  }
  return quoteOrFallback(row, `${prefix}${sideName}${action === 'sell' ? 'Bid' : 'Ask'}`, genericKey);
}

export function contractPrice(row, venue, side = 'YES', mode = 'ask', action = 'buy') {
  const explicit = quotedSidePrice(row, venue, side, mode, action);
  if (Number.isFinite(explicit)) return clamp(explicit, 0.001, 0.999);
  if (side === 'YES') return Number.NaN;
  const yes = quotedSidePrice(row, venue, 'YES', mode, action);
  if (mode === 'last' || mode === 'midpoint') {
    return Number.isFinite(yes) ? clamp(1 - yes, 0.001, 0.999) : Number.NaN;
  }
  const complementaryYes = quotedSidePrice(row, venue, 'YES', 'ask', action === 'buy' ? 'sell' : 'buy');
  return Number.isFinite(complementaryYes) ? clamp(1 - complementaryYes, 0.001, 0.999) : Number.NaN;
}

function selectedSpot(row, btcSource = 'Composite (Binance + Coinbase)') {
  if (!row) return Number.NaN;
  if (btcSource === 'Binance') return finiteNumber(row.binancePrice);
  if (btcSource === 'Coinbase') return finiteNumber(row.coinbasePrice);
  return finiteNumber(row.compositePrice ?? row.btcPrice);
}

function sourceFeature(row, baseKey, btcSource = 'Composite (Binance + Coinbase)') {
  if (!row) return Number.NaN;
  const capitalized = `${baseKey.charAt(0).toUpperCase()}${baseKey.slice(1)}`;
  if (btcSource === 'Binance') return finiteNumber(row[`binance${capitalized}`]);
  if (btcSource === 'Coinbase') return finiteNumber(row[`coinbase${capitalized}`]);
  const explicitComposite = finiteNumber(row[`composite${capitalized}`]);
  return Number.isFinite(explicitComposite) ? explicitComposite : finiteNumber(row[baseKey]);
}

function rowTimeMs(row) {
  const value = Date.parse(row?.timestamp);
  return Number.isFinite(value) ? value : Number.NaN;
}

function findAtOrBefore(rows, targetMs, maxIndex = rows.length - 1) {
  let low = 0;
  let high = Math.min(maxIndex, rows.length - 1);
  let found = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const time = rowTimeMs(rows[middle]);
    if (!Number.isFinite(time)) {
      high = middle - 1;
      continue;
    }
    if (time <= targetMs) {
      found = rows[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function lookbackContractRow(context, seconds) {
  const currentMs = rowTimeMs(context.currentRow);
  if (!Number.isFinite(currentMs)) return null;
  return findAtOrBefore(context.contractHistory || [], currentMs - Math.max(0, Number(seconds)) * 1000);
}

function lookbackGlobalRow(context, milliseconds) {
  const currentMs = rowTimeMs(context.currentRow);
  if (!Number.isFinite(currentMs)) return null;
  return findAtOrBefore(context.historyRows || [], currentMs - Math.max(0, Number(milliseconds)), context.rowIndex - 1);
}

function previousTimeRow(context) {
  const currentMs = rowTimeMs(context.currentRow);
  if (!Number.isFinite(currentMs)) return null;
  return findAtOrBefore(context.historyRows || [], currentMs - 1, context.rowIndex - 1);
}

function referencePrice(row, reference, execution, dataSettings = {}) {
  if (dataSettings.referenceMode === 'BTC spot only (diagnostic)') {
    return selectedSpot(row, dataSettings.btcSource);
  }
  let choice = reference;
  if (!choice || choice === 'Auto by trade venue') {
    choice = execution.tradeVenue === 'Kalshi' ? 'Kalshi CF BRTI 60s average' : 'Polymarket Chainlink Data Stream';
  }
  if (choice.includes('Kalshi')) return finiteNumber(row?.kalshiReferencePrice);
  if (choice.includes('Polymarket')) return finiteNumber(row?.polyReferencePrice);
  return Number.NaN;
}

function parseOutcome(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'up'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'down'].includes(normalized)) return false;
  }
  return null;
}

function venueOutcomeYes(row, venue) {
  const venueKey = venue === 'Polymarket' ? 'polyOutcomeYes' : 'kalshiOutcomeYes';
  const venueOutcome = parseOutcome(row?.[venueKey]);
  if (venueOutcome !== null) return venueOutcome;
  const rowVenue = String(row?.venue || '').toLowerCase();
  if (rowVenue && rowVenue !== venue.toLowerCase()) return null;
  if (rowVenue) return parseOutcome(row?.outcomeYes ?? row?.finalOutcomeYes ?? row?.final_outcome_yes);
  const otherVenuePresent = venue === 'Kalshi'
    ? Object.keys(row || {}).some((key) => key.startsWith('poly'))
    : Object.keys(row || {}).some((key) => key.startsWith('kalshi'));
  return otherVenuePresent ? null : parseOutcome(row?.outcomeYes);
}

function parseTimestampMs(value, fallback = Number.NaN) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric > 1e17) return numeric / 1_000_000;
    if (numeric > 1e14) return numeric / 1_000;
    if (numeric > 1e11) return numeric;
    if (numeric > 1e8) return numeric * 1_000;
    return numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pmFactorPriceMatches(factor, row, previousContractRow, context) {
  const v = factor.values;
  const horizon = resolveHorizon(v.marketHorizon, context.execution);
  if (horizon && row.marketHorizon !== horizon) return false;
  const side = resolveSide(v.side, context.execution);
  const venues = v.venue === 'Either' ? ['Kalshi', 'Polymarket'] : [resolveVenue(v.venue, context.execution)];
  return venues.some((venue) => {
    const current = contractPrice(row, venue, side, context.fillMode, 'buy');
    const previous = previousContractRow ? contractPrice(previousContractRow, venue, side, context.fillMode, 'buy') : null;
    if (v.operator === 'within') {
      return Number.isFinite(current) && Math.abs(current - Number(v.value)) <= Math.max(0, Number(v.tolerance || 0));
    }
    return compare(current, v.operator, Number(v.value), previous);
  });
}

function vwapSetupMatches(v, row, previousRow, context) {
  const source = context.dataSettings.btcSource;
  const price = selectedSpot(row, source);
  const vwap = sourceFeature(row, 'vwap', source);
  if (!Number.isFinite(price) || !Number.isFinite(vwap)) return false;
  const tolerance = Number(v.tolerancePct || 0) / 100;
  const upper = vwap * (1 + tolerance);
  const lower = vwap * (1 - tolerance);
  const prevPrice = selectedSpot(previousRow, source);
  const prevVwap = sourceFeature(previousRow, 'vwap', source);
  const returnDirection = Number.isFinite(prevPrice) ? price - prevPrice : Number.NaN;
  switch (v.setup) {
    case 'Bullish bias': return price > vwap;
    case 'Bearish bias': return price < vwap;
    case 'Reversal up': return !!previousRow && Number.isFinite(prevPrice) && Number.isFinite(prevVwap) && prevPrice < prevVwap && price >= vwap;
    case 'Reversal down': return !!previousRow && Number.isFinite(prevPrice) && Number.isFinite(prevVwap) && prevPrice > prevVwap && price <= vwap;
    case 'Continuation up': return price > upper && returnDirection > 0;
    case 'Continuation down': return price < lower && returnDirection < 0;
    case 'Support hold': return price >= vwap && price <= upper && returnDirection >= 0;
    case 'Resistance hold': return price <= vwap && price >= lower && returnDirection <= 0;
    case 'Breakthrough up': return !!previousRow && Number.isFinite(prevPrice) && Number.isFinite(prevVwap) && prevPrice <= prevVwap && price > upper;
    case 'Breakthrough down': return !!previousRow && Number.isFinite(prevPrice) && Number.isFinite(prevVwap) && prevPrice >= prevVwap && price < lower;
    default: return price > vwap;
  }
}

export function factorMatches(factor, row, previousRow, context) {
  const v = factor.values || {};
  const previousContractRow = context.previousContractRow || null;
  const priorBtcRow = previousTimeRow(context);
  switch (factor.type) {
    case 'pm_price': return pmFactorPriceMatches(factor, row, previousContractRow, context);
    case 'pm_delta': {
      const venue = resolveVenue(v.venue, context.execution);
      const lag = lookbackContractRow(context, Number(v.lookbackSeconds || 0));
      if (!lag) return false;
      const currentProbability = contractPrice(row, venue, 'YES', 'midpoint', 'buy');
      const lagProbability = contractPrice(lag, venue, 'YES', 'midpoint', 'buy');
      if (!Number.isFinite(currentProbability) || !Number.isFinite(lagProbability)) return false;
      return compare(currentProbability - lagProbability, v.operator, Number(v.value));
    }
    case 'pm_velocity': {
      const venue = resolveVenue(v.venue, context.execution);
      if (!previousContractRow) return false;
      const currentProbability = contractPrice(row, venue, 'YES', 'midpoint', 'buy');
      const previousProbability = contractPrice(previousContractRow, venue, 'YES', 'midpoint', 'buy');
      const elapsedSeconds = (rowTimeMs(row) - rowTimeMs(previousContractRow)) / 1000;
      if (!Number.isFinite(currentProbability) || !Number.isFinite(previousProbability) || !(elapsedSeconds > 0)) return false;
      return compare((currentProbability - previousProbability) / elapsedSeconds, v.operator, Number(v.value));
    }
    case 'pm_book_imbalance': return compare(Number(v.venue === 'Polymarket' ? row.polyBookImbalance : row.kalshiBookImbalance), v.operator, Number(v.value));
    case 'cross_market_spread': {
      const kalshi = contractPrice(row, 'Kalshi', 'YES', context.fillMode, 'buy');
      const poly = contractPrice(row, 'Polymarket', 'YES', context.fillMode, 'buy');
      if (!Number.isFinite(kalshi) || !Number.isFinite(poly)) return false;
      const kalshiTs = parseTimestampMs(row.kalshiQuoteTimestamp, rowTimeMs(row));
      const polyTs = parseTimestampMs(row.polyQuoteTimestamp, rowTimeMs(row));
      const toleranceMs = Math.max(0, Number(v.matchToleranceSeconds || 0)) * 1000;
      if (Number.isFinite(kalshiTs) && Number.isFinite(polyTs) && Math.abs(kalshiTs - polyTs) > toleranceMs) return false;
      return compare(kalshi - poly, v.operator, Number(v.value));
    }
    case 'time_to_expiry': return compare(Number(row.secondsRemaining), v.operator, Number(v.seconds));
    case 'strike_offset': {
      const horizon = resolveHorizon(v.marketHorizon, context.execution);
      if (horizon && row.marketHorizon !== horizon) return false;
      const spot = selectedSpot(row, context.dataSettings.btcSource);
      if (!Number.isFinite(spot)) return false;
      const reference = v.reference === 'Current BTC' ? spot : nearestRound(spot, v.reference);
      const offset = Number(row.strike) - reference;
      const side = resolveSide(v.side, context.execution);
      const sidePrice = contractPrice(row, context.execution.tradeVenue, side, context.fillMode, 'buy');
      return Number.isFinite(sidePrice) && compare(offset, v.operator, Number(v.dollars)) && sidePrice <= Number(v.maxPrice);
    }
    case 'pm_residual': return compare(Number(v.venue === 'Polymarket' ? row.polyResidual : row.kalshiResidual), v.operator, Number(v.value));
    case 'vwap_setup': return vwapSetupMatches(v, row, priorBtcRow, context);
    case 'ema_cross': {
      const source = context.dataSettings.btcSource;
      const fast = sourceFeature(row, 'emaFast', source);
      const slow = sourceFeature(row, 'emaSlow', source);
      if (!Number.isFinite(fast) || !Number.isFinite(slow)) return false;
      if (v.operator === 'fast_above') return fast > slow;
      if (v.operator === 'fast_below') return fast < slow;
      if (!priorBtcRow) return false;
      const previousFast = sourceFeature(priorBtcRow, 'emaFast', source);
      const previousSlow = sourceFeature(priorBtcRow, 'emaSlow', source);
      if (!Number.isFinite(previousFast) || !Number.isFinite(previousSlow)) return false;
      if (v.operator === 'cross_up') return previousFast <= previousSlow && fast > slow;
      if (v.operator === 'cross_down') return previousFast >= previousSlow && fast < slow;
      return false;
    }
    case 'prior_day_level': {
      const source = context.dataSettings.btcSource;
      const key = v.level === 'High' ? 'yesterdayHigh' : v.level === 'Low' ? 'yesterdayLow' : 'yesterdayClose';
      const level = sourceFeature(row, key, source);
      const price = selectedSpot(row, source);
      if (!Number.isFinite(level) || !Number.isFinite(price)) return false;
      if (v.operator === 'within_pct') return Math.abs(price / level - 1) * 100 <= Number(v.tolerancePct);
      const previous = selectedSpot(priorBtcRow, source);
      const previousLevel = sourceFeature(priorBtcRow, key, source);
      if (v.operator === 'crosses_up') return Number.isFinite(previous) && Number.isFinite(previousLevel) && previous <= previousLevel && price > level;
      if (v.operator === 'crosses_down') return Number.isFinite(previous) && Number.isFinite(previousLevel) && previous >= previousLevel && price < level;
      return compare(price, v.operator, level);
    }
    case 'prior_week_level': {
      const source = context.dataSettings.btcSource;
      const map = { 'Average close': 'priorWeekAvgClose', High: 'priorWeekHigh', Low: 'priorWeekLow', Close: 'priorWeekClose' };
      const key = map[v.level] || 'priorWeekAvgClose';
      const level = sourceFeature(row, key, source);
      const price = selectedSpot(row, source);
      if (!Number.isFinite(level) || !Number.isFinite(price)) return false;
      if (v.operator === 'within_pct') return Math.abs(price / level - 1) * 100 <= Number(v.tolerancePct);
      const previous = selectedSpot(priorBtcRow, source);
      const previousLevel = sourceFeature(priorBtcRow, key, source);
      if (v.operator === 'crosses_up') return Number.isFinite(previous) && Number.isFinite(previousLevel) && previous <= previousLevel && price > level;
      if (v.operator === 'crosses_down') return Number.isFinite(previous) && Number.isFinite(previousLevel) && previous >= previousLevel && price < level;
      return compare(price, v.operator, level);
    }
    case 'return_momentum': {
      const lag = lookbackGlobalRow(context, Number(v.lookbackMinutes || 0) * 60_000);
      const current = selectedSpot(row, context.dataSettings.btcSource);
      const previous = selectedSpot(lag, context.dataSettings.btcSource);
      if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return false;
      return compare((current / previous - 1) * 100, v.operator, Number(v.returnPct));
    }
    case 'realized_vol': return compare(sourceFeature(row, 'realizedVolPct', context.dataSettings.btcSource), v.operator, Number(v.annualizedPct));
    case 'round_level': {
      const price = selectedSpot(row, context.dataSettings.btcSource);
      if (!Number.isFinite(price)) return false;
      return Math.abs(price - nearestRound(price, v.rounding)) <= Number(v.distance);
    }
    case 'btc_move_gate': {
      const lag = lookbackGlobalRow(context, Number(v.lookbackSeconds || 0) * 1000);
      const current = selectedSpot(row, context.dataSettings.btcSource);
      const previous = selectedSpot(lag, context.dataSettings.btcSource);
      if (!Number.isFinite(current) || !Number.isFinite(previous)) return false;
      return compare(Math.abs(current - previous), v.operator, Number(v.dollars));
    }
    case 'reference_distance': {
      const ref = referencePrice(row, v.reference, context.execution, context.dataSettings);
      return Number.isFinite(ref) && compare(ref - Number(row.strike), v.operator, Number(v.dollars));
    }
    case 'reference_vs_spot': {
      const ref = referencePrice(row, v.reference, context.execution, context.dataSettings);
      const spot = selectedSpot(row, context.dataSettings.btcSource);
      return Number.isFinite(ref) && Number.isFinite(spot) && compare(ref - spot, v.operator, Number(v.dollars));
    }
    default: return true;
  }
}

function betaPosteriorMean(history, priorWins, priorLosses) {
  const wins = history.filter(Boolean).length;
  const losses = history.length - wins;
  return (wins + priorWins) / Math.max(1, wins + losses + priorWins + priorLosses);
}
function getSizingFraction({ risk, entryPrice, pastOutcomes, execution }) {
  if (risk.sizingMode !== 'kelly' || execution.exitMode !== 'expiry') return Number(risk.fixedTradePct || 0) / 100;
  const lookback = Math.max(1, Number(risk.kellyLookback || 100));
  const sample = pastOutcomes.slice(-lookback);
  const q = betaPosteriorMean(sample, Number(risk.kellyPriorWins || 0), Number(risk.kellyPriorLosses || 0));
  const edge = q - entryPrice;
  if (edge * 100 < Number(risk.minEdgePct || 0)) return 0;
  const fullKelly = edge <= 0 || entryPrice >= 1 ? 0 : edge / Math.max(0.001, 1 - entryPrice);
  return fullKelly * Number(risk.kellyFraction || 0.25);
}
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1; const z = Math.abs(x) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z));
  return 0.5 * (1 + erf);
}
export function digitalProbability({ spot, strike, timeYears, volatility, riskFreeRate = 0 }) {
  if (spot <= 0 || strike <= 0 || timeYears <= 0 || volatility <= 0) return spot >= strike ? 1 : 0;
  const d2 = (Math.log(spot / strike) + (riskFreeRate - 0.5 * volatility ** 2) * timeYears) / (volatility * Math.sqrt(timeYears));
  return normalCdf(d2);
}
function standardDeviation(values) { if (values.length < 2) return 0; const m = mean(values); return Math.sqrt(values.reduce((s,v)=>s+(v-m)**2,0)/(values.length-1)); }
function maxDrawdown(equity) { let peak=-Infinity,maxDd=0; equity.forEach(p=>{peak=Math.max(peak,p.equity);if(peak>0)maxDd=Math.max(maxDd,(peak-p.equity)/peak);});return maxDd; }
function percentile(values,p){if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.max(0,Math.floor((s.length-1)*p)))];}
function wilsonInterval(wins,n,z=1.96){if(!n)return[0,0];const phat=wins/n,denom=1+z**2/n,center=(phat+z**2/(2*n))/denom,margin=z*Math.sqrt((phat*(1-phat)+z**2/(4*n))/n)/denom;return[Math.max(0,center-margin),Math.min(1,center+margin)];}
function longestStreak(outcomes,wanted){let best=0,current=0;outcomes.forEach(v=>{if(v===wanted){current++;best=Math.max(best,current)}else current=0});return best;}
function calibrationError(trades){if(!trades.length)return 0;const bins=Array.from({length:10},()=>[]);trades.forEach(t=>{const p=clamp(t.marketProbability,.001,.999);bins[Math.min(9,Math.floor(p*10))].push(t)});return bins.reduce((sum,b)=>{if(!b.length)return sum;const p=mean(b.map(t=>clamp(t.marketProbability,.001,.999))),a=mean(b.map(t=>t.settlementWon?1:0));return sum+(b.length/trades.length)*Math.abs(p-a)},0)}
function advancedMetrics(trades,equity,cagr){if(!trades.length)return{brier:0,logLoss:0,calibration:0,confidenceLow:0,confidenceHigh:0,pValueApprox:1,expectancy:0,profitFactor:0,sortino:0,calmar:0,longestWinStreak:0,longestLossStreak:0,var95:0,cvar95:0};const outcomes=trades.map(t=>t.settlementWon),wins=outcomes.filter(Boolean).length,probs=trades.map(t=>clamp(t.marketProbability,.001,.999));const brier=mean(trades.map((t,i)=>(probs[i]-(t.settlementWon?1:0))**2));const logLoss=-mean(trades.map((t,i)=>{const y=t.settlementWon?1:0;return y*Math.log(probs[i])+(1-y)*Math.log(1-probs[i])}));const[confidenceLow,confidenceHigh]=wilsonInterval(wins,trades.length);const observed=wins/trades.length,expected=mean(probs),varianceOfMean=probs.reduce((s,p)=>s+p*(1-p),0)/(trades.length**2),standardError=Math.sqrt(Math.max(1e-12,varianceOfMean)),z=(observed-expected)/standardError,pValueApprox=Math.min(1,2*(1-normalCdf(Math.abs(z))));const pnls=trades.map(t=>t.pnl),grossProfit=pnls.filter(v=>v>0).reduce((a,b)=>a+b,0),grossLoss=Math.abs(pnls.filter(v=>v<0).reduce((a,b)=>a+b,0)),tradeReturns=trades.map(t=>t.pnl/Math.max(1,t.before)),downside=tradeReturns.filter(r=>r<0),downsideDev=downside.length?Math.sqrt(mean(downside.map(r=>r**2))):0,dd=maxDrawdown(equity),var95=percentile(tradeReturns,.05),tail=tradeReturns.filter(r=>r<=var95);return{brier,logLoss,calibration:calibrationError(trades),confidenceLow,confidenceHigh,pValueApprox,expectancy:mean(pnls),profitFactor:grossLoss?grossProfit/grossLoss:grossProfit>0?Infinity:0,sortino:downsideDev?mean(tradeReturns)/downsideDev*Math.sqrt(Math.max(1,trades.length)):0,calmar:dd?cagr/dd:0,longestWinStreak:longestStreak(outcomes,true),longestLossStreak:longestStreak(outcomes,false),var95,cvar95:mean(tail)}}
function executableSellPrice(row, position, fillMode, risk, feeSettings = null) {
  const raw = contractPrice(row, position.venue, position.side, fillMode, 'sell');
  if (!Number.isFinite(raw)) return Number.NaN;
  // Trading fees are cash charges, not fake price slippage. Legacy flat fee
  // allowances are retained only when no formula-based feeSettings are supplied.
  const legacyFee = feeSettings ? 0 : Number(risk.exitFeeCents || 0);
  const friction = (Number(risk.slippageCents || 0) + legacyFee) / 100;
  return clamp(raw - friction, 0, 1);
}
function shouldExitPosition(position, row, execution, fillMode, risk, feeSettings = null) {
  if (row.contractId !== position.contractId) return null;
  if (execution.exitMode === 'expiry') return null;
  const executable = executableSellPrice(row, position, fillMode, risk, feeSettings);
  if (!Number.isFinite(executable)) return null;
  if (execution.exitMode === 'target' && executable >= Number(execution.exitTarget)) return { reason: 'target', price: executable };
  if (execution.exitMode === 'target_stop') {
    if (executable >= Number(execution.exitTarget)) return { reason: 'target', price: executable };
    if (executable <= Number(execution.stopPrice)) return { reason: 'stop', price: executable };
  }
  if (execution.exitMode === 'time' && Number(row.secondsRemaining) <= Number(execution.exitSecondsRemaining)) return { reason: 'time', price: executable };
  return null;
}

export function runBacktest({ rows, factors, joinMode = 'AND', risk, execution, dataSettings, fillMode = 'ask', feeSettings = null }) {
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Date.parse(row.timestamp)) && row.contractId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const startingCapital = Number(risk.startingCapital || 10000);
  const trades = [];
  const equity = [{ timestamp: sortedRows[0]?.timestamp || new Date().toISOString(), equity: startingCapital }];
  const pastOutcomes = [];
  const entryCounts = new Map();
  const openPositions = [];
  const previousByContract = new Map();
  const historyByContract = new Map();
  const lastEntryByContract = new Map();
  const lastExitByContract = new Map();
  let autoYesFallbacks = 0;
  let cash = startingCapital;

  const openCost = () => openPositions.reduce((sum, position) => sum + position.allocation, 0);
  const markedValue = () => openPositions.reduce((sum, position) => sum + Math.max(0, position.shares * position.lastMark - Number(position.lastMarkFee || 0)), 0);
  const venueProfile = () => feeSettings?.profiles?.[execution.tradeVenue] || null;
  const entryLiquidity = () => venueProfile()?.entryLiquidity || 'taker';
  const exitLiquidity = () => venueProfile()?.exitLiquidity || 'taker';
  const feeFor = ({ contracts, price, liquidity, direction, phase }) => feeSettings
    ? calculateVenueFee({ settings: feeSettings, venue: execution.tradeVenue, contracts, price, liquidity, direction, phase })
    : 0;
  const accountEquity = () => cash + markedValue();

  function finalize(position, exitTs, exitPrice, reason) {
    const idx = openPositions.indexOf(position);
    if (idx >= 0) openPositions.splice(idx, 1);
    const grossProceeds = reason === 'expiry' ? (position.settlementWon ? position.shares : 0) : position.shares * exitPrice;
    const exitFee = reason === 'expiry' ? 0 : feeFor({
      contracts: position.shares,
      price: exitPrice,
      liquidity: exitLiquidity(),
      direction: 'sell',
      phase: 'exit',
    });
    const netProceeds = Math.max(0, grossProceeds - exitFee);
    cash += netProceeds;
    const grossPnlBeforeFees = grossProceeds - position.allocation;
    const totalFee = Number(position.entryFee || 0) + exitFee;
    const pnl = grossPnlBeforeFees - totalFee;
    const after = accountEquity();
    trades.push({
      ...position,
      exitTs,
      exitPrice,
      netExitPrice: position.shares > 0 ? netProceeds / position.shares : exitPrice,
      exitReason: reason,
      exitFee,
      totalFee,
      grossPnlBeforeFees,
      pnl,
      after,
    });
    lastExitByContract.set(position.contractId, exitTs);
    if (reason === 'expiry') pastOutcomes.push(position.settlementWon);
    equity.push({ timestamp: new Date(exitTs).toISOString(), equity: after });
  }

  function settleThrough(timestampMs) {
    [...openPositions]
      .filter((position) => position.expiryTs <= timestampMs)
      .sort((a, b) => a.expiryTs - b.expiryTs || Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .forEach((position) => finalize(position, position.expiryTs, position.settlementWon ? 1 : 0, 'expiry'));
  }

  function evaluateCandidateSide(side, row, index, previousContractRow, contractHistory) {
    const candidateExecution = { ...execution, tradeSide: side };
    const context = {
      execution: candidateExecution,
      dataSettings,
      fillMode,
      previousContractRow,
      contractHistory,
      historyRows: sortedRows,
      rowIndex: index,
      currentRow: row,
    };
    const matches = factors.map((factor) => factorMatches(factor, row, null, context));
    const signal = joinMode === 'OR' ? matches.some(Boolean) : matches.every(Boolean);
    const sidePriceMatches = factors.some((factor, factorIndex) => {
      if (factor.type !== 'pm_price' || !matches[factorIndex]) return false;
      const observedSide = factor.values?.side;
      return !observedSide || observedSide === 'Trade target side' || observedSide === side;
    });
    const rawEntry = contractPrice(row, execution.tradeVenue, side, fillMode, 'buy');
    return { side, signal, matches, sidePriceMatches, rawEntry, candidateExecution };
  }

  function chooseTradeCandidate(candidates) {
    const valid = candidates.filter((candidate) => candidate.signal && Number.isFinite(candidate.rawEntry));
    if (!valid.length) return null;
    if (execution.tradeSide !== 'AUTO' || valid.length === 1) return valid[0];

    // AUTO means: select the side that actually satisfied a price factor bound
    // to the trade side. This makes “buy whichever side is <=45c” explicit
    // rather than silently defaulting to YES/UP.
    const priceMatched = valid.filter((candidate) => candidate.sidePriceMatches);
    if (priceMatched.length === 1) return priceMatched[0];
    if (priceMatched.length > 1) {
      const boundPriceFactor = factors.find((factor) => factor.type === 'pm_price');
      const threshold = Number(boundPriceFactor?.values?.value);
      if (Number.isFinite(threshold)) {
        return [...priceMatched].sort((a, b) => Math.abs(a.rawEntry - threshold) - Math.abs(b.rawEntry - threshold))[0];
      }
    }

    // AUTO is price-driven when a price rule can identify a side. If there is
    // no side-defining contract-price rule, the product convention is YES / UP
    // rather than silently dropping an otherwise valid BTC/reference signal.
    const yes = valid.find((candidate) => candidate.side === 'YES');
    if (yes) { autoYesFallbacks += 1; return yes; }
    return valid[0];
  }

  sortedRows.forEach((row, index) => {
    const ts = new Date(row.timestamp).getTime();
    settleThrough(ts);
    const previousContractRow = previousByContract.get(row.contractId) || null;
    const contractHistory = historyByContract.get(row.contractId) || [];

    // Update marks and evaluate early exits before any new entry on this row.
    [...openPositions].forEach((position) => {
      if (row.contractId !== position.contractId) return;
      const mark = executableSellPrice(row, position, fillMode, risk, feeSettings);
      if (Number.isFinite(mark)) {
        position.lastMark = mark;
        position.lastMarkFee = feeFor({ contracts: position.shares, price: mark, liquidity: exitLiquidity(), direction: 'sell', phase: 'exit' });
      }
      const exit = shouldExitPosition(position, row, execution, fillMode, risk, feeSettings);
      if (exit) finalize(position, ts, exit.price, exit.reason);
    });
    equity.push({ timestamp: row.timestamp, equity: accountEquity() });

    const sideCandidates = execution.tradeSide === 'AUTO' ? ['YES', 'NO'] : [execution.tradeSide];
    const evaluated = sideCandidates.map((side) => evaluateCandidateSide(side, row, index, previousContractRow, contractHistory));
    const candidate = chooseTradeCandidate(evaluated);

    previousByContract.set(row.contractId, row);
    contractHistory.push(row);
    historyByContract.set(row.contractId, contractHistory);

    if (!candidate || factors.length === 0) return;
    if (row.marketHorizon !== execution.marketHorizon) return;

    const selectedSide = candidate.side;
    const executionForTrade = candidate.candidateExecution;

    // Sequential cycle semantics: never pyramid the same contract/venue, and
    // never exit then re-enter from the exact same snapshot.
    if (openPositions.some((position) => position.contractId === row.contractId && position.venue === execution.tradeVenue)) return;
    if (lastExitByContract.get(row.contractId) === ts) return;

    const count = entryCounts.get(row.contractId) || 0;
    if (execution.reentryMode === 'once' && count >= 1) return;
    if (execution.reentryMode === 'limited' && count >= Number(execution.maxEntriesPerContract || 1)) return;
    const cooldownMs = Number(execution.entryCooldownSeconds || 0) * 1000;
    const lastEntryTime = lastEntryByContract.get(row.contractId) ?? -Infinity;
    if (ts - lastEntryTime < cooldownMs) return;

    const rawEntry = candidate.rawEntry;
    const outcomeYes = venueOutcomeYes(row, execution.tradeVenue);
    if (outcomeYes === null) return;

    const legacyEntryFeeCents = feeSettings ? 0 : Number(risk.entryFeeCents || 0);
    const entryFriction = (Number(risk.slippageCents || 0) + legacyEntryFeeCents) / 100;
    const executionEntryPrice = Math.max(0.001, rawEntry + entryFriction);
    const equityBefore = accountEquity();

    let desiredAllocation = 0;
    if (risk.sizingMode === 'fixed_contracts') {
      desiredAllocation = Math.max(0, Number(risk.fixedContracts || 0)) * executionEntryPrice;
    } else if (risk.sizingMode === 'fixed_dollars') {
      desiredAllocation = Math.max(0, Number(risk.fixedTradeDollars || 0));
    } else if (risk.sizingMode === 'fixed_base_pct') {
      desiredAllocation = startingCapital * Math.max(0, Number(risk.fixedTradePct || 0)) / 100;
    } else {
      let sizingFraction = getSizingFraction({ risk, entryPrice: executionEntryPrice, pastOutcomes, execution: executionForTrade });
      sizingFraction = Math.min(sizingFraction, Number(risk.maxTradePct || 100) / 100);
      if (sizingFraction <= 0) return;
      desiredAllocation = equityBefore * sizingFraction;
    }

    const maxSinglePosition = equityBefore * (Number(risk.maxTradePct || 100) / 100);
    desiredAllocation = Math.min(desiredAllocation, maxSinglePosition);
    const maxExposureDollars = equityBefore * (Number(risk.maxExposurePct || 100) / 100);
    const exposureCapacity = Math.max(0, maxExposureDollars - openCost());
    let allocation = Math.min(desiredAllocation, exposureCapacity, cash);
    if (!(allocation > 0)) return;

    let shares = allocation / executionEntryPrice;
    let entryFee = feeFor({ contracts: shares, price: executionEntryPrice, liquidity: entryLiquidity(), direction: 'buy', phase: 'entry' });
    // Fees consume cash separately from contract notional. If a fee would push
    // the debit beyond available cash, scale the position down and recompute.
    for (let attempt = 0; attempt < 3 && allocation + entryFee > cash + 1e-9; attempt += 1) {
      const scale = cash / Math.max(1e-9, allocation + entryFee);
      allocation *= Math.max(0, Math.min(1, scale));
      shares = allocation / executionEntryPrice;
      entryFee = feeFor({ contracts: shares, price: executionEntryPrice, liquidity: entryLiquidity(), direction: 'buy', phase: 'entry' });
    }
    if (!(shares > 0) || allocation + entryFee > cash + 1e-6) return;
    const entryPrice = executionEntryPrice + (shares > 0 ? entryFee / shares : 0);
    const settlementWon = selectedSide === 'YES' ? outcomeYes : !outcomeYes;
    const fallbackExpiry = ts + Math.max(1, Number(row.secondsRemaining || 1)) * 1000;
    const expiryTs = parseTimestampMs(row.expiryTs ?? row.expiry, fallbackExpiry);
    if (!Number.isFinite(expiryTs) || expiryTs < ts) return;

    const spot = selectedSpot(row, dataSettings.btcSource);
    const vol = sourceFeature(row, 'realizedVolPct', dataSettings.btcSource);
    const yesModelProbability = digitalProbability({
      spot,
      strike: Number(row.strike),
      timeYears: Math.max(Number(row.secondsRemaining), 1) / (365.25 * 24 * 3600),
      volatility: Math.max(Number.isFinite(vol) ? vol : 1, 1) / 100,
    });
    const modelProbability = selectedSide === 'YES' ? yesModelProbability : 1 - yesModelProbability;
    const observedProbability = contractPrice(row, execution.tradeVenue, selectedSide, 'midpoint', 'buy');
    const marketProbability = Number.isFinite(observedProbability) ? observedProbability : rawEntry;

    const initialSell = contractPrice(row, execution.tradeVenue, selectedSide, fillMode, 'sell');
    const legacyExitFeeCents = feeSettings ? 0 : Number(risk.exitFeeCents || 0);
    const exitFriction = (Number(risk.slippageCents || 0) + legacyExitFeeCents) / 100;
    const initialMark = Number.isFinite(initialSell)
      ? clamp(initialSell - exitFriction, 0, 1)
      : clamp(rawEntry, 0, 1);
    const initialMarkFee = feeFor({ contracts: shares, price: initialMark, liquidity: exitLiquidity(), direction: 'sell', phase: 'exit' });

    cash -= allocation + entryFee;
    openPositions.push({
      timestamp: row.timestamp,
      expiryTs,
      contractId: row.contractId,
      venue: execution.tradeVenue,
      side: selectedSide,
      fillMode,
      rawEntryPrice: rawEntry,
      executionEntryPrice,
      marketProbability,
      entryPrice,
      entryFee,
      allocation,
      shares,
      settlementWon,
      before: equityBefore,
      btcPrice: spot,
      referencePrice: referencePrice(row, 'Auto by trade venue', executionForTrade, dataSettings),
      modelProbability,
      lastMark: initialMark,
      lastMarkFee: initialMarkFee,
    });
    entryCounts.set(row.contractId, count + 1);
    lastEntryByContract.set(row.contractId, ts);
    equity.push({ timestamp: row.timestamp, equity: accountEquity() });
  });

  settleThrough(Infinity);
  trades.sort((a, b) => a.exitTs - b.exitTs);
  equity.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const settlementWins = trades.filter((trade) => trade.settlementWon).length;
  const winRate = trades.length ? wins / trades.length : 0;
  const settlementWinRate = trades.length ? settlementWins / trades.length : 0;
  const avgEntry = mean(trades.map((trade) => trade.entryPrice));
  const avgExit = mean(trades.map((trade) => trade.exitPrice));
  const targetExits = trades.filter((trade) => trade.exitReason === 'target').length;
  const stopExits = trades.filter((trade) => trade.exitReason === 'stop').length;
  const timeExits = trades.filter((trade) => trade.exitReason === 'time').length;
  const expiryExits = trades.filter((trade) => trade.exitReason === 'expiry').length;
  const breakevenWinRate = avgEntry;
  const empiricalEdge = settlementWinRate - breakevenWinRate;
  const grossCapitalDeployed = trades.reduce((sum, trade) => sum + trade.allocation, 0);
  const totalEntryFees = trades.reduce((sum, trade) => sum + Number(trade.entryFee || 0), 0);
  const totalExitFees = trades.reduce((sum, trade) => sum + Number(trade.exitFee || 0), 0);
  const totalFees = totalEntryFees + totalExitFees;
  const grossPnlBeforeFees = trades.reduce((sum, trade) => sum + Number(trade.grossPnlBeforeFees || 0), 0);
  const netPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const deployedRoi = grossCapitalDeployed > 0 ? netPnl / grossCapitalDeployed : 0;
  const avgContracts = mean(trades.map((trade) => trade.shares));
  const avgPnlPerContract = mean(trades.map((trade) => trade.shares > 0 ? trade.pnl / trade.shares : 0));
  const avgFeePerTrade = trades.length ? totalFees / trades.length : 0;
  const avgFeePerContract = trades.reduce((sum, trade) => sum + Number(trade.shares || 0), 0) > 0
    ? totalFees / trades.reduce((sum, trade) => sum + Number(trade.shares || 0), 0)
    : 0;
  const feesPctGrossDeployed = grossCapitalDeployed > 0 ? totalFees / grossCapitalDeployed : 0;
  const grossDeployedRoi = grossCapitalDeployed > 0 ? grossPnlBeforeFees / grossCapitalDeployed : 0;
  const returns = trades.map((trade) => trade.pnl / Math.max(1, trade.before));
  const sdReturn = standardDeviation(returns);
  const pseudoSharpe = sdReturn ? mean(returns) / sdReturn * Math.sqrt(Math.max(1, trades.length)) : 0;
  const endingCapital = cash;
  const totalReturn = startingCapital ? endingCapital / startingCapital - 1 : 0;
  const startTs = sortedRows.length ? new Date(sortedRows[0].timestamp).getTime() : Date.now();
  const endTs = sortedRows.length ? new Date(sortedRows[sortedRows.length - 1].timestamp).getTime() : Date.now();
  const years = Math.max((endTs - startTs) / (365.25 * 86400000), 1 / 365.25);
  const cagr = endingCapital > 0 ? (endingCapital / startingCapital) ** (1 / years) - 1 : -1;
  const advanced = advancedMetrics(trades, equity, cagr);

  return {
    trades,
    equity,
    metrics: {
      trades: trades.length,
      wins,
      settlementWins,
      winRate,
      settlementWinRate,
      avgEntry,
      avgExit,
      targetExits,
      stopExits,
      timeExits,
      expiryExits,
      breakevenWinRate,
      empiricalEdge,
      endingCapital,
      totalReturn,
      cagr,
      maxDrawdown: maxDrawdown(equity),
      pseudoSharpe,
      avgPnl: mean(trades.map((trade) => trade.pnl)),
      grossCapitalDeployed,
      netPnl,
      deployedRoi,
      avgContracts,
      avgPnlPerContract,
      totalEntryFees,
      totalExitFees,
      totalFees,
      avgFeePerTrade,
      avgFeePerContract,
      feesPctGrossDeployed,
      grossPnlBeforeFees,
      grossDeployedRoi,
      feeModelEnabled: Boolean(feeSettings?.enabled),
      autoYesFallbacks,
      ...advanced,
    },
    warnings: [
      ...(risk.sizingMode === 'kelly' && execution.exitMode !== 'expiry'
        ? ['Kelly is disabled for early-exit tests; fixed % sizing is used because binary Kelly does not directly apply to arbitrary exit distributions.'] : []),
      ...(dataSettings.btcSource !== 'Composite (Binance + Coinbase)' && trades.some((trade) => !Number.isFinite(trade.btcPrice))
        ? [`Some ${dataSettings.btcSource} observations were unavailable; the engine does not fall back to another BTC source.`] : []),
      ...(execution.tradeSide === 'AUTO' && autoYesFallbacks > 0
        ? [`AUTO defaulted to YES / UP on ${autoYesFallbacks} qualifying timestamps because no contract-price rule uniquely selected a side.`] : []),
      ...(risk.sizingMode === 'fixed_pct' && trades.length >= 500
        ? ['Fixed % of current equity compounds position size after every win/loss. Over hundreds or thousands of trades, total portfolio return can become exponential; use deployed ROI or fixed-contract sizing to judge the signal itself.'] : []),
      ...(feeSettings?.enabled
        ? ['Venue trading fees are calculated from the configured current/custom formula at each simulated execution price. Historical date-versioned fee regimes and multi-fill fee-accumulator behavior are not yet reconstructed.'] : []),
    ],
  };
}

export function runParameterSweep({rows,factors,joinMode,risk,execution,dataSettings,feeSettings=null,factorInstanceId,fieldKey,start,end,step,fillMode='ask'}){const points=[],startValue=Number(start),endValue=Number(end);if(!Number.isFinite(startValue)||!Number.isFinite(endValue))return points;const magnitude=Math.abs(Number(step))||1,direction=endValue>=startValue?1:-1,increment=magnitude*direction,withinRange=value=>direction>0?value<=endValue+magnitude/1000:value>=endValue-magnitude/1000;for(let value=startValue;withinRange(value);value+=increment){const adjusted=factors.map(f=>f.instanceId===factorInstanceId?{...f,values:{...f.values,[fieldKey]:Number(value.toFixed(8))}}:f),result=runBacktest({rows,factors:adjusted,joinMode,risk,execution,dataSettings,feeSettings,fillMode});points.push({value:Number(value.toFixed(8)),...result.metrics});if(points.length>=250)break}return points}
export function equityDifference(left,right,startingCapital=10000){const byTime=new Map();left.forEach(point=>{const current=byTime.get(point.timestamp)||{timestamp:point.timestamp};current.left=point.equity;byTime.set(point.timestamp,current)});right.forEach(point=>{const current=byTime.get(point.timestamp)||{timestamp:point.timestamp};current.right=point.equity;byTime.set(point.timestamp,current)});let lastLeft=startingCapital,lastRight=startingCapital;return[...byTime.values()].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).map(point=>{if(Number.isFinite(point.left))lastLeft=point.left;if(Number.isFinite(point.right))lastRight=point.right;return{timestamp:point.timestamp,equity:lastLeft-lastRight}})}
