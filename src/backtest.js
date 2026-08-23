const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function compare(value, operator, threshold, previousValue = null) {
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

function valueForVenue(row, venue, side = 'YES') {
  let yes;
  if (venue === 'Polymarket') yes = row.polyYes;
  else if (venue === 'Either') yes = Math.min(row.kalshiYes, row.polyYes);
  else yes = row.kalshiYes;
  return side === 'NO' ? 1 - yes : yes;
}

function factorMatches(factor, row, previousRow) {
  const v = factor.values;
  switch (factor.type) {
    case 'pm_price': {
      if (v.marketHorizon && row.marketHorizon !== v.marketHorizon) return false;
      const current = valueForVenue(row, v.venue, v.side);
      const previous = previousRow ? valueForVenue(previousRow, v.venue, v.side) : null;
      return compare(current, v.operator, Number(v.value), previous);
    }
    case 'pm_delta': {
      const delta = v.venue === 'Polymarket' ? row.polyDelta : row.kalshiDelta;
      return compare(delta, v.operator, Number(v.value));
    }
    case 'pm_book_imbalance': {
      const imbalance = v.venue === 'Polymarket' ? row.polyBookImbalance : row.kalshiBookImbalance;
      return compare(imbalance, v.operator, Number(v.value));
    }
    case 'cross_market_spread': {
      const spread = row.kalshiYes - row.polyYes;
      return compare(spread, v.operator, Number(v.value));
    }
    case 'time_to_expiry':
      return compare(row.secondsRemaining, v.operator, Number(v.seconds));
    case 'strike_offset': {
      let reference = row.btcPrice;
      if (v.reference !== 'Current BTC') reference = nearestRound(row.btcPrice, v.reference);
      const offset = row.strike - reference;
      return compare(offset, v.operator, Number(v.dollars)) && valueForVenue(row, 'Kalshi', v.side) <= Number(v.maxPrice);
    }
    case 'btc_vs_vwap': {
      const adjustedVwap = row.vwap * (1 + Number(v.offsetPct || 0) / 100);
      if (v.operator === '>') return row.btcPrice > adjustedVwap;
      if (v.operator === '<') return row.btcPrice < adjustedVwap;
      if (!previousRow) return false;
      const previousAdjusted = previousRow.vwap * (1 + Number(v.offsetPct || 0) / 100);
      if (v.operator === 'crosses_up') return previousRow.btcPrice <= previousAdjusted && row.btcPrice > adjustedVwap;
      if (v.operator === 'crosses_down') return previousRow.btcPrice >= previousAdjusted && row.btcPrice < adjustedVwap;
      return false;
    }
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
      const level = row[key];
      if (v.operator === 'within_pct') return Math.abs(row.btcPrice / level - 1) * 100 <= Number(v.tolerancePct);
      if (v.operator === '>') return row.btcPrice > level;
      if (v.operator === '<') return row.btcPrice < level;
      if (!previousRow) return false;
      if (v.operator === 'crosses_up') return previousRow.btcPrice <= previousRow[key] && row.btcPrice > level;
      if (v.operator === 'crosses_down') return previousRow.btcPrice >= previousRow[key] && row.btcPrice < level;
      return false;
    }
    case 'prior_week_level': {
      const map = { 'Average close': 'priorWeekAvgClose', High: 'priorWeekHigh', Low: 'priorWeekLow', Close: 'priorWeekAvgClose' };
      const key = map[v.level] || 'priorWeekAvgClose';
      const level = row[key];
      if (v.operator === 'within_pct') return Math.abs(row.btcPrice / level - 1) * 100 <= Number(v.tolerancePct);
      if (v.operator === '>') return row.btcPrice > level;
      if (v.operator === '<') return row.btcPrice < level;
      if (!previousRow) return false;
      if (v.operator === 'crosses_up') return previousRow.btcPrice <= previousRow[key] && row.btcPrice > level;
      if (v.operator === 'crosses_down') return previousRow.btcPrice >= previousRow[key] && row.btcPrice < level;
      return false;
    }
    case 'return_momentum':
      return compare(row.btcReturnPct, v.operator, Number(v.returnPct));
    case 'realized_vol':
      return compare(row.realizedVolPct, v.operator, Number(v.annualizedPct));
    case 'round_level': {
      const round = nearestRound(row.btcPrice, v.rounding);
      return Math.abs(row.btcPrice - round) <= Number(v.distance);
    }
    default:
      return true;
  }
}

function inferEntrySide(factors) {
  const priced = factors.find((factor) => factor.type === 'pm_price' || factor.type === 'strike_offset');
  return priced?.values?.side || 'YES';
}

function getEntryPrice(row, factors, side, risk) {
  const priced = factors.find((factor) => factor.type === 'pm_price');
  const venue = priced?.values?.venue || 'Kalshi';
  const raw = valueForVenue(row, venue, side);
  const slippage = Number(risk.slippageCents || 0) / 100;
  const fee = Number(risk.feeCents || 0) / 100;
  return clamp(raw + slippage + fee, 0.01, 0.99);
}

function betaPosteriorMean(history, priorWins, priorLosses) {
  const wins = history.filter(Boolean).length;
  const losses = history.length - wins;
  return (wins + priorWins) / Math.max(1, wins + losses + priorWins + priorLosses);
}

function getSizingFraction({ risk, entryPrice, pastOutcomes }) {
  if (risk.sizingMode === 'fixed_pct') return Number(risk.fixedTradePct || 0) / 100;
  const lookback = Math.max(1, Number(risk.kellyLookback || 100));
  const sample = pastOutcomes.slice(-lookback);
  const q = betaPosteriorMean(sample, Number(risk.kellyPriorWins || 0), Number(risk.kellyPriorLosses || 0));
  const edge = q - entryPrice;
  if (edge * 100 < Number(risk.minEdgePct || 0)) return 0;
  const fullKelly = edge <= 0 ? 0 : edge / Math.max(0.001, 1 - entryPrice);
  return fullKelly * Number(risk.kellyFraction || 0.25);
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

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function runBacktest({ rows, factors, joinMode = 'AND', risk }) {
  const trades = [];
  const equity = [{ timestamp: rows[0]?.timestamp || new Date().toISOString(), equity: Number(risk.startingCapital || 10000) }];
  const pastOutcomes = [];
  const seenContracts = new Set();
  let cash = Number(risk.startingCapital || 10000);
  let lastEntryTime = -Infinity;
  const side = inferEntrySide(factors);

  rows.forEach((row, index) => {
    const previousRow = index > 0 ? rows[index - 1] : null;
    const matches = factors.map((factor) => factorMatches(factor, row, previousRow));
    const signal = joinMode === 'OR' ? matches.some(Boolean) : matches.every(Boolean);
    if (!signal || factors.length === 0) return;
    if (risk.oneEntryPerContract && seenContracts.has(row.contractId)) return;

    const ts = new Date(row.timestamp).getTime();
    const cooldownMs = Number(risk.cooldownMinutes || 0) * 60000;
    if (ts - lastEntryTime < cooldownMs) return;

    const entryPrice = getEntryPrice(row, factors, side, risk);
    let sizingFraction = getSizingFraction({ risk, entryPrice, pastOutcomes });
    sizingFraction = Math.min(sizingFraction, Number(risk.maxTradePct || 100) / 100, Number(risk.maxExposurePct || 100) / 100);
    if (sizingFraction <= 0) return;

    const allocation = Math.min(cash * sizingFraction, cash);
    const shares = allocation / entryPrice;
    const won = side === 'YES' ? row.outcomeYes : !row.outcomeYes;
    const settlement = won ? shares : 0;
    const pnl = settlement - allocation;
    const before = cash;
    cash += pnl;

    trades.push({
      timestamp: row.timestamp,
      contractId: row.contractId,
      side,
      entryPrice,
      allocation,
      shares,
      won,
      pnl,
      before,
      after: cash,
      btcPrice: row.btcPrice,
      kalshiYes: row.kalshiYes,
      polyYes: row.polyYes,
    });
    pastOutcomes.push(won);
    equity.push({ timestamp: row.timestamp, equity: cash });
    seenContracts.add(row.contractId);
    lastEntryTime = ts;
  });

  const wins = trades.filter((trade) => trade.won).length;
  const losses = trades.length - wins;
  const winRate = trades.length ? wins / trades.length : 0;
  const avgEntry = trades.length ? trades.reduce((sum, trade) => sum + trade.entryPrice, 0) / trades.length : 0;
  const breakevenWinRate = avgEntry;
  const empiricalEdge = winRate - breakevenWinRate;
  const returns = trades.map((trade) => trade.pnl / Math.max(1, trade.before));
  const meanReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const sdReturn = standardDeviation(returns);
  const pseudoSharpe = sdReturn ? (meanReturn / sdReturn) * Math.sqrt(Math.max(1, trades.length)) : 0;
  const totalReturn = Number(risk.startingCapital || 10000) ? cash / Number(risk.startingCapital || 10000) - 1 : 0;
  const startTs = rows.length ? new Date(rows[0].timestamp).getTime() : Date.now();
  const endTs = rows.length ? new Date(rows[rows.length - 1].timestamp).getTime() : Date.now();
  const years = Math.max((endTs - startTs) / (365.25 * 86400000), 1 / 365.25);
  const cagr = cash > 0 ? (cash / Number(risk.startingCapital || 10000)) ** (1 / years) - 1 : -1;

  return {
    trades,
    equity,
    metrics: {
      trades: trades.length,
      wins,
      losses,
      winRate,
      avgEntry,
      breakevenWinRate,
      empiricalEdge,
      endingCapital: cash,
      totalReturn,
      cagr,
      maxDrawdown: maxDrawdown(equity),
      pseudoSharpe,
      avgPnl: trades.length ? trades.reduce((sum, trade) => sum + trade.pnl, 0) / trades.length : 0,
    },
  };
}

export function digitalProbability({ spot, strike, timeYears, volatility, riskFreeRate = 0 }) {
  if (spot <= 0 || strike <= 0 || timeYears <= 0 || volatility <= 0) return spot >= strike ? 1 : 0;
  const d2 = (Math.log(spot / strike) + (riskFreeRate - 0.5 * volatility ** 2) * timeYears) / (volatility * Math.sqrt(timeYears));
  return normalCdf(d2);
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
