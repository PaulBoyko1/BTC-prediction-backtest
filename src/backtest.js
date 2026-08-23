const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function compare(value, operator, threshold, previousValue = null) {
  if (!Number.isFinite(Number(value))) return false;
  if (operator === '<=') return value <= threshold;
  if (operator === '>=') return value >= threshold;
  if (operator === '<') return value < threshold;
  if (operator === '>') return value > threshold;
  if (operator === 'abs>=') return Math.abs(value) >= threshold;
  if (operator === 'abs<=') return Math.abs(value) <= threshold;
  if (operator === 'crosses_up') return previousValue !== null && previousValue < threshold && value >= threshold;
  if (operator === 'crosses_down') return previousValue !== null && previousValue > threshold && value <= threshold;
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

function yesPrice(row, venue, mode = 'ask', action = 'buy') {
  const prefix = venue === 'Polymarket' ? 'poly' : 'kalshi';
  if (mode === 'last') return Number(row[`${prefix}YesLast`] ?? row[`${prefix}Yes`] ?? 0.5);
  if (mode === 'midpoint') {
    const explicit = row[`${prefix}YesMid`];
    if (explicit !== undefined) return Number(explicit);
    const bid = Number(row[`${prefix}YesBid`] ?? row[`${prefix}Yes`] ?? 0.5);
    const ask = Number(row[`${prefix}YesAsk`] ?? row[`${prefix}Yes`] ?? 0.5);
    return (bid + ask) / 2;
  }
  return Number(row[`${prefix}Yes${action === 'sell' ? 'Bid' : 'Ask'}`] ?? row[`${prefix}Yes`] ?? 0.5);
}

export function contractPrice(row, venue, side = 'YES', mode = 'ask', action = 'buy') {
  const yes = yesPrice(row, venue, mode, action);
  if (side === 'YES') return clamp(yes, 0.001, 0.999);
  if (mode === 'last' || mode === 'midpoint') return clamp(1 - yes, 0.001, 0.999);
  // Buy NO crosses the complementary YES bid; sell NO crosses the complementary YES ask.
  const complementaryYes = yesPrice(row, venue, 'ask', action === 'buy' ? 'sell' : 'buy');
  return clamp(1 - complementaryYes, 0.001, 0.999);
}

function referencePrice(row, reference, execution) {
  let choice = reference;
  if (!choice || choice === 'Auto by trade venue') {
    choice = execution.tradeVenue === 'Kalshi' ? 'Kalshi CF BRTI 60s average' : 'Polymarket Chainlink Data Stream';
  }
  if (choice.includes('Kalshi')) return Number(row.kalshiReferencePrice ?? row.compositePrice ?? row.btcPrice);
  return Number(row.polyReferencePrice ?? row.compositePrice ?? row.btcPrice);
}

function selectedSpot(row, btcSource = 'Composite (Binance + Coinbase)') {
  if (btcSource === 'Binance') return Number(row.binancePrice ?? row.btcPrice);
  if (btcSource === 'Coinbase') return Number(row.coinbasePrice ?? row.btcPrice);
  return Number(row.compositePrice ?? row.btcPrice);
}

function pmFactorPriceMatches(factor, row, previousRow, context) {
  const v = factor.values;
  const horizon = resolveHorizon(v.marketHorizon, context.execution);
  if (horizon && row.marketHorizon !== horizon) return false;
  const side = resolveSide(v.side, context.execution);
  const venues = v.venue === 'Either' ? ['Kalshi', 'Polymarket'] : [resolveVenue(v.venue, context.execution)];
  return venues.some((venue) => {
    const current = contractPrice(row, venue, side, context.fillMode, 'buy');
    const previous = previousRow ? contractPrice(previousRow, venue, side, context.fillMode, 'buy') : null;
    return compare(current, v.operator, Number(v.value), previous);
  });
}

function vwapSetupMatches(v, row, previousRow) {
  const price = Number(row.btcPrice);
  const vwap = Number(row.vwap);
  const tolerance = Number(v.tolerancePct || 0) / 100;
  const upper = vwap * (1 + tolerance);
  const lower = vwap * (1 - tolerance);
  const prevPrice = Number(previousRow?.btcPrice);
  const prevVwap = Number(previousRow?.vwap);
  switch (v.setup) {
    case 'Bullish bias': return price > vwap;
    case 'Bearish bias': return price < vwap;
    case 'Reversal up': return !!previousRow && prevPrice < prevVwap && price >= vwap;
    case 'Reversal down': return !!previousRow && prevPrice > prevVwap && price <= vwap;
    case 'Continuation up': return price > upper && Number(row.btcReturnPct) > 0;
    case 'Continuation down': return price < lower && Number(row.btcReturnPct) < 0;
    case 'Support hold': return price >= vwap && price <= upper && Number(row.btcReturnPct) >= 0;
    case 'Resistance hold': return price <= vwap && price >= lower && Number(row.btcReturnPct) <= 0;
    case 'Breakthrough up': return !!previousRow && prevPrice <= prevVwap && price > upper;
    case 'Breakthrough down': return !!previousRow && prevPrice >= prevVwap && price < lower;
    default: return price > vwap;
  }
}

export function factorMatches(factor, row, previousRow, context) {
  const v = factor.values || {};
  switch (factor.type) {
    case 'pm_price':
      return pmFactorPriceMatches(factor, row, previousRow, context);
    case 'pm_delta': {
      const delta = v.venue === 'Polymarket' ? row.polyDelta : row.kalshiDelta;
      return compare(Number(delta), v.operator, Number(v.value));
    }
    case 'pm_velocity': {
      const velocity = v.venue === 'Polymarket' ? row.polyVelocity : row.kalshiVelocity;
      return compare(Number(velocity), v.operator, Number(v.value));
    }
    case 'pm_book_imbalance': {
      const imbalance = v.venue === 'Polymarket' ? row.polyBookImbalance : row.kalshiBookImbalance;
      return compare(Number(imbalance), v.operator, Number(v.value));
    }
    case 'cross_market_spread': {
      const spread = contractPrice(row, 'Kalshi', 'YES', context.fillMode, 'buy') - contractPrice(row, 'Polymarket', 'YES', context.fillMode, 'buy');
      return compare(spread, v.operator, Number(v.value));
    }
    case 'time_to_expiry':
      return compare(Number(row.secondsRemaining), v.operator, Number(v.seconds));
    case 'strike_offset': {
      const horizon = resolveHorizon(v.marketHorizon, context.execution);
      if (horizon && row.marketHorizon !== horizon) return false;
      const spot = selectedSpot(row, context.dataSettings.btcSource);
      const reference = v.reference === 'Current BTC' ? spot : nearestRound(spot, v.reference);
      const offset = Number(row.strike) - reference;
      const side = resolveSide(v.side, context.execution);
      const sidePrice = contractPrice(row, context.execution.tradeVenue, side, context.fillMode, 'buy');
      return compare(offset, v.operator, Number(v.dollars)) && sidePrice <= Number(v.maxPrice);
    }
    case 'pm_residual': {
      const residual = v.venue === 'Polymarket' ? row.polyResidual : row.kalshiResidual;
      return compare(Number(residual), v.operator, Number(v.value));
    }
    case 'vwap_setup':
      return vwapSetupMatches(v, row, previousRow);
    case 'ema_cross': {
      if (v.operator === 'fast_above') return row.emaFast > row.emaSlow;
      if (v.operator === 'fast_below') return row.emaFast < row.emaSlow;
      if (!previousRow) return false;
      if (v.operator === 'cross_up') return previousRow.emaFast <= previousRow.emaSlow && row.emaFast > row.emaSlow;
      if (v.operator === 'cross_down') return previousRow.emaFast >= previousRow.emaSlow && row.emaFast < row.emaSlow;
      return false;
    }
    case 'prior_day_level': {
      const key = v.level === 'High' ? 'yesterdayHigh' : v.level === 'Low' ? 'yesterdayLow' : 'yesterdayClose';
      const level = Number(row[key]);
      if (v.operator === 'within_pct') return Math.abs(Number(row.btcPrice) / level - 1) * 100 <= Number(v.tolerancePct);
      const previous = previousRow ? Number(previousRow.btcPrice) : null;
      const previousLevel = previousRow ? Number(previousRow[key]) : null;
      if (v.operator === 'crosses_up') return previous !== null && previous <= previousLevel && Number(row.btcPrice) > level;
      if (v.operator === 'crosses_down') return previous !== null && previous >= previousLevel && Number(row.btcPrice) < level;
      return compare(Number(row.btcPrice), v.operator, level);
    }
    case 'prior_week_level': {
      const map = { 'Average close': 'priorWeekAvgClose', High: 'priorWeekHigh', Low: 'priorWeekLow', Close: 'priorWeekClose' };
      const key = map[v.level] || 'priorWeekAvgClose';
      const level = Number(row[key]);
      if (v.operator === 'within_pct') return Math.abs(Number(row.btcPrice) / level - 1) * 100 <= Number(v.tolerancePct);
      if (v.operator === 'crosses_up') return !!previousRow && Number(previousRow.btcPrice) <= Number(previousRow[key]) && Number(row.btcPrice) > level;
      if (v.operator === 'crosses_down') return !!previousRow && Number(previousRow.btcPrice) >= Number(previousRow[key]) && Number(row.btcPrice) < level;
      return compare(Number(row.btcPrice), v.operator, level);
    }
    case 'return_momentum':
      return compare(Number(row.btcReturnPct), v.operator, Number(v.returnPct));
    case 'realized_vol':
      return compare(Number(row.realizedVolPct), v.operator, Number(v.annualizedPct));
    case 'round_level': {
      const round = nearestRound(Number(row.btcPrice), v.rounding);
      return Math.abs(Number(row.btcPrice) - round) <= Number(v.distance);
    }
    case 'btc_move_gate':
      return compare(Math.abs(Number(row.btcMoveDollars || 0)), v.operator, Number(v.dollars));
    case 'reference_distance': {
      const ref = referencePrice(row, v.reference, context.execution);
      return compare(ref - Number(row.strike), v.operator, Number(v.dollars));
    }
    case 'reference_vs_spot': {
      const ref = referencePrice(row, v.reference, context.execution);
      const spot = selectedSpot(row, context.dataSettings.btcSource);
      return compare(ref - spot, v.operator, Number(v.dollars));
    }
    default:
      return true;
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
  const fullKelly = edge <= 0 ? 0 : edge / Math.max(0.001, 1 - entryPrice);
  return fullKelly * Number(risk.kellyFraction || 0.25);
}

function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z));
  return 0.5 * (1 + erf);
}

export function digitalProbability({ spot, strike, timeYears, volatility, riskFreeRate = 0 }) {
  if (spot <= 0 || strike <= 0 || timeYears <= 0 || volatility <= 0) return spot >= strike ? 1 : 0;
  const d2 = (Math.log(spot / strike) + (riskFreeRate - 0.5 * volatility ** 2) * timeYears) / (volatility * Math.sqrt(timeYears));
  return normalCdf(d2);
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

function maxDrawdown(equity) {
  let peak = -Infinity;
  let maxDd = 0;
  equity.forEach((point) => {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - point.equity) / peak);
  });
  return maxDd;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function wilsonInterval(wins, n, z = 1.96) {
  if (!n) return [0, 0];
  const phat = wins / n;
  const denom = 1 + z ** 2 / n;
  const center = (phat + z ** 2 / (2 * n)) / denom;
  const margin = z * Math.sqrt((phat * (1 - phat) + z ** 2 / (4 * n)) / n) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function longestStreak(outcomes, wanted) {
  let best = 0;
  let current = 0;
  outcomes.forEach((value) => {
    if (value === wanted) { current += 1; best = Math.max(best, current); }
    else current = 0;
  });
  return best;
}

function calibrationError(trades) {
  if (!trades.length) return 0;
  const bins = Array.from({ length: 10 }, () => []);
  trades.forEach((trade) => bins[Math.min(9, Math.floor(trade.entryPrice * 10))].push(trade));
  return bins.reduce((sum, bucket) => {
    if (!bucket.length) return sum;
    const predicted = mean(bucket.map((t) => t.entryPrice));
    const actual = mean(bucket.map((t) => t.settlementWon ? 1 : 0));
    return sum + (bucket.length / trades.length) * Math.abs(predicted - actual);
  }, 0);
}

function advancedMetrics(trades, equity, cagr) {
  if (!trades.length) return {
    brier: 0, logLoss: 0, calibration: 0, confidenceLow: 0, confidenceHigh: 0,
    pValueApprox: 1, expectancy: 0, profitFactor: 0, sortino: 0, calmar: 0,
    longestWinStreak: 0, longestLossStreak: 0, var95: 0, cvar95: 0,
  };
  const outcomes = trades.map((trade) => trade.settlementWon);
  const wins = outcomes.filter(Boolean).length;
  const probs = trades.map((trade) => clamp(trade.entryPrice, 0.001, 0.999));
  const brier = mean(trades.map((trade, i) => (probs[i] - (trade.settlementWon ? 1 : 0)) ** 2));
  const logLoss = -mean(trades.map((trade, i) => {
    const y = trade.settlementWon ? 1 : 0;
    return y * Math.log(probs[i]) + (1 - y) * Math.log(1 - probs[i]);
  }));
  const [confidenceLow, confidenceHigh] = wilsonInterval(wins, trades.length);
  const observed = wins / trades.length;
  const expected = mean(probs);
  const standardError = Math.sqrt(Math.max(1e-9, expected * (1 - expected) / trades.length));
  const z = (observed - expected) / standardError;
  const pValueApprox = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  const pnls = trades.map((trade) => trade.pnl);
  const grossProfit = pnls.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((v) => v < 0).reduce((a, b) => a + b, 0));
  const tradeReturns = trades.map((trade) => trade.pnl / Math.max(1, trade.before));
  const downside = tradeReturns.filter((r) => r < 0);
  const downsideDev = downside.length ? Math.sqrt(mean(downside.map((r) => r ** 2))) : 0;
  const sortino = downsideDev ? mean(tradeReturns) / downsideDev * Math.sqrt(Math.max(1, trades.length)) : 0;
  const dd = maxDrawdown(equity);
  const var95 = percentile(tradeReturns, 0.05);
  const tail = tradeReturns.filter((r) => r <= var95);
  return {
    brier,
    logLoss,
    calibration: calibrationError(trades),
    confidenceLow,
    confidenceHigh,
    pValueApprox,
    expectancy: mean(pnls),
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    sortino,
    calmar: dd ? cagr / dd : 0,
    longestWinStreak: longestStreak(outcomes, true),
    longestLossStreak: longestStreak(outcomes, false),
    var95,
    cvar95: mean(tail),
  };
}

function shouldExitPosition(position, row, execution, fillMode, risk) {
  if (row.contractId !== position.contractId) return null;
  if (execution.exitMode === 'expiry') return null;
  const raw = contractPrice(row, position.venue, position.side, fillMode, 'sell');
  const friction = (Number(risk.slippageCents || 0) + Number(risk.exitFeeCents || 0)) / 100;
  const executable = clamp(raw - friction, 0.001, 0.999);
  if (execution.exitMode === 'target' && executable >= Number(execution.exitTarget)) return { reason: 'target', price: executable };
  if (execution.exitMode === 'target_stop') {
    if (executable >= Number(execution.exitTarget)) return { reason: 'target', price: executable };
    if (executable <= Number(execution.stopPrice)) return { reason: 'stop', price: executable };
  }
  if (execution.exitMode === 'time' && Number(row.secondsRemaining) <= Number(execution.exitSecondsRemaining)) return { reason: 'time', price: executable };
  return null;
}

export function runBacktest({ rows, factors, joinMode = 'AND', risk, execution, dataSettings, fillMode = 'ask' }) {
  const sortedRows = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const startingCapital = Number(risk.startingCapital || 10000);
  const trades = [];
  const equity = [{ timestamp: sortedRows[0]?.timestamp || new Date().toISOString(), equity: startingCapital }];
  const pastOutcomes = [];
  const entryCounts = new Map();
  const openPositions = [];
  let cash = startingCapital;
  let lastEntryTime = -Infinity;

  const openCost = () => openPositions.reduce((sum, position) => sum + position.allocation, 0);
  const markedValue = () => openPositions.reduce((sum, position) => sum + position.shares * position.lastMark, 0);
  const accountEquity = () => cash + markedValue();

  function finalize(position, exitTs, exitPrice, reason) {
    const idx = openPositions.indexOf(position);
    if (idx >= 0) openPositions.splice(idx, 1);
    const proceeds = reason === 'expiry' ? (position.settlementWon ? position.shares : 0) : position.shares * exitPrice;
    cash += proceeds;
    const pnl = proceeds - position.allocation;
    const after = accountEquity();
    trades.push({ ...position, exitTs, exitPrice, exitReason: reason, pnl, after });
    if (reason === 'expiry') pastOutcomes.push(position.settlementWon);
    equity.push({ timestamp: new Date(exitTs).toISOString(), equity: after });
  }

  function settleThrough(timestampMs) {
    [...openPositions].forEach((position) => {
      if (position.expiryTs <= timestampMs) finalize(position, position.expiryTs, position.settlementWon ? 1 : 0, 'expiry');
    });
  }

  sortedRows.forEach((row, index) => {
    const ts = new Date(row.timestamp).getTime();
    settleThrough(ts);
    const previousRow = index > 0 ? sortedRows[index - 1] : null;

    // Update marks and evaluate configured early exits before considering a new entry.
    [...openPositions].forEach((position) => {
      if (row.contractId !== position.contractId) return;
      position.lastMark = contractPrice(row, position.venue, position.side, fillMode, 'sell');
      const exit = shouldExitPosition(position, row, execution, fillMode, risk);
      if (exit) finalize(position, ts, exit.price, exit.reason);
    });
    equity.push({ timestamp: row.timestamp, equity: accountEquity() });

    const context = { execution, dataSettings, fillMode };
    const matches = factors.map((factor) => factorMatches(factor, row, previousRow, context));
    const signal = joinMode === 'OR' ? matches.some(Boolean) : matches.every(Boolean);
    if (!signal || factors.length === 0) return;
    if (row.marketHorizon !== execution.marketHorizon) return;

    const count = entryCounts.get(row.contractId) || 0;
    if (execution.reentryMode === 'once' && count >= 1) return;
    if (execution.reentryMode === 'limited' && count >= Number(execution.maxEntriesPerContract || 1)) return;
    const cooldownMs = Number(execution.entryCooldownSeconds || 0) * 1000;
    if (ts - lastEntryTime < cooldownMs) return;

    const rawEntry = contractPrice(row, execution.tradeVenue, execution.tradeSide, fillMode, 'buy');
    const entryFriction = (Number(risk.slippageCents || 0) + Number(risk.entryFeeCents || 0)) / 100;
    const entryPrice = clamp(rawEntry + entryFriction, 0.001, 0.999);
    let sizingFraction = getSizingFraction({ risk, entryPrice, pastOutcomes, execution });
    sizingFraction = Math.min(sizingFraction, Number(risk.maxTradePct || 100) / 100);
    if (sizingFraction <= 0) return;

    const equityBefore = accountEquity();
    const maxExposureDollars = equityBefore * (Number(risk.maxExposurePct || 100) / 100);
    const exposureCapacity = Math.max(0, maxExposureDollars - openCost());
    const desiredAllocation = equityBefore * sizingFraction;
    const allocation = Math.min(desiredAllocation, exposureCapacity, cash);
    if (allocation <= 0) return;

    const shares = allocation / entryPrice;
    const settlementWon = execution.tradeSide === 'YES' ? !!row.outcomeYes : !row.outcomeYes;
    const expiryTs = Number(row.expiryTs || (ts + Math.max(1, Number(row.secondsRemaining || 1)) * 1000));
    const modelProbability = digitalProbability({
      spot: selectedSpot(row, dataSettings.btcSource),
      strike: Number(row.strike),
      timeYears: Math.max(Number(row.secondsRemaining), 1) / (365.25 * 24 * 3600),
      volatility: Math.max(Number(row.realizedVolPct || 1), 1) / 100,
    });

    cash -= allocation;
    openPositions.push({
      timestamp: row.timestamp,
      expiryTs,
      contractId: row.contractId,
      venue: execution.tradeVenue,
      side: execution.tradeSide,
      fillMode,
      entryPrice,
      allocation,
      shares,
      settlementWon,
      before: equityBefore,
      btcPrice: selectedSpot(row, dataSettings.btcSource),
      referencePrice: referencePrice(row, 'Auto by trade venue', execution),
      modelProbability,
      lastMark: rawEntry,
    });
    entryCounts.set(row.contractId, count + 1);
    lastEntryTime = ts;
  });

  settleThrough(Infinity);
  trades.sort((a, b) => a.exitTs - b.exitTs);
  equity.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const settlementWins = trades.filter((trade) => trade.settlementWon).length;
  const winRate = trades.length ? wins / trades.length : 0;
  const settlementWinRate = trades.length ? settlementWins / trades.length : 0;
  const avgEntry = mean(trades.map((trade) => trade.entryPrice));
  const breakevenWinRate = avgEntry;
  const empiricalEdge = settlementWinRate - breakevenWinRate;
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
      breakevenWinRate,
      empiricalEdge,
      endingCapital,
      totalReturn,
      cagr,
      maxDrawdown: maxDrawdown(equity),
      pseudoSharpe,
      avgPnl: mean(trades.map((trade) => trade.pnl)),
      ...advanced,
    },
    warnings: [
      ...(risk.sizingMode === 'kelly' && execution.exitMode !== 'expiry' ? ['Kelly is disabled for early-exit tests; fixed % sizing is used because binary Kelly does not directly apply to arbitrary exit distributions.'] : []),
    ],
  };
}

export function runParameterSweep({ rows, factors, joinMode, risk, execution, dataSettings, factorInstanceId, fieldKey, start, end, step, fillMode = 'ask' }) {
  const points = [];
  const safeStep = Math.abs(Number(step)) || 1;
  for (let value = Number(start); value <= Number(end) + safeStep / 1000; value += safeStep) {
    const adjusted = factors.map((factor) => factor.instanceId === factorInstanceId
      ? { ...factor, values: { ...factor.values, [fieldKey]: Number(value.toFixed(8)) } }
      : factor);
    const result = runBacktest({ rows, factors: adjusted, joinMode, risk, execution, dataSettings, fillMode });
    points.push({ value: Number(value.toFixed(8)), ...result.metrics });
    if (points.length >= 250) break;
  }
  return points;
}

export function equityDifference(left, right, startingCapital = 10000) {
  const byTime = new Map();
  left.forEach((point) => byTime.set(point.timestamp, { timestamp: point.timestamp, left: point.equity, right: startingCapital }));
  right.forEach((point) => {
    const current = byTime.get(point.timestamp) || { timestamp: point.timestamp, left: startingCapital, right: point.equity };
    current.right = point.equity;
    byTime.set(point.timestamp, current);
  });
  let lastLeft = startingCapital;
  let lastRight = startingCapital;
  return [...byTime.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map((point) => {
    if (Number.isFinite(point.left)) lastLeft = point.left;
    else point.left = lastLeft;
    if (Number.isFinite(point.right)) lastRight = point.right;
    else point.right = lastRight;
    return { timestamp: point.timestamp, equity: point.left - point.right };
  });
}
