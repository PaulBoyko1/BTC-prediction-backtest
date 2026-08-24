function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  const u = Math.max(1e-9, random());
  const v = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

function quoteFromMid(mid, random, venueBias = 0) {
  const noisy = clamp(mid + venueBias + gaussian(random) * 0.012, 0.015, 0.985);
  const spread = clamp(0.008 + random() * 0.024, 0.005, 0.05);
  const bid = clamp(noisy - spread / 2, 0.005, 0.99);
  const ask = clamp(noisy + spread / 2, 0.01, 0.995);
  const last = clamp(noisy + gaussian(random) * spread * 0.45, bid, ask);
  return { bid, ask, mid: (bid + ask) / 2, last };
}

function complementaryQuote(yes) {
  return {
    bid: clamp(1 - yes.ask, 0.005, 0.99),
    ask: clamp(1 - yes.bid, 0.01, 0.995),
    mid: clamp(1 - yes.mid, 0.005, 0.995),
    last: clamp(1 - yes.last, 0.005, 0.995),
  };
}

function horizonSeconds(horizon) {
  if (horizon === '5m') return 300;
  if (horizon === '15m') return 900;
  return 3600;
}

function nearest(value, step) {
  return Math.round(value / step) * step;
}

export function generateDemoDataset(years = 3, seed = 42) {
  const random = mulberry32(Number(seed) || 42);
  const end = Date.now();
  const days = Math.ceil(Number(years) * 365.25);
  const start = end - days * 86400000;
  const rows = [];
  let btc = 26000 + random() * 12000;
  let prevDayClose = btc;
  let priorWeekCloses = Array(7).fill(btc);
  let contractCounter = 0;

  for (let day = 0; day < days; day += 1) {
    const dayStart = start + day * 86400000;
    const macroDrift = 0.00035 + 0.0008 * Math.sin(day / 47) + gaussian(random) * 0.0012;
    const dayOpen = btc;
    const projectedClose = Math.max(8000, dayOpen * (1 + macroDrift + gaussian(random) * 0.018));
    const yesterdayHigh = Math.max(dayOpen, prevDayClose) * (1 + 0.004 + random() * 0.018);
    const yesterdayLow = Math.min(dayOpen, prevDayClose) * (1 - 0.004 - random() * 0.018);
    const yesterdayClose = prevDayClose;
    const priorWeekAvgClose = priorWeekCloses.reduce((a, b) => a + b, 0) / priorWeekCloses.length;
    const priorWeekHigh = Math.max(...priorWeekCloses) * 1.012;
    const priorWeekLow = Math.min(...priorWeekCloses) * 0.988;
    const priorWeekClose = priorWeekCloses[priorWeekCloses.length - 1];

    const contracts = [
      ['5m', 2 * 3600], ['15m', 5 * 3600], ['1h', 8 * 3600],
      ['5m', 13 * 3600], ['15m', 17 * 3600], ['1h', 21 * 3600],
    ];

    contracts.forEach(([marketHorizon, offsetSeconds], contractIndex) => {
      const totalSeconds = horizonSeconds(marketHorizon);
      const contractStart = dayStart + offsetSeconds * 1000;
      const dayProgress = offsetSeconds / 86400;
      const baseSpot = dayOpen + (projectedClose - dayOpen) * dayProgress + gaussian(random) * dayOpen * 0.004;
      const strike = marketHorizon === '1h'
        ? nearest(baseSpot + gaussian(random) * 140, 100)
        : baseSpot + gaussian(random) * 18;
      const contractVol = 0.42 + random() * 0.55;
      const finalMoveScale = baseSpot * contractVol * Math.sqrt(totalSeconds / (365.25 * 86400));
      const finalSpot = Math.max(1000, baseSpot + gaussian(random) * finalMoveScale + macroDrift * baseSpot * 0.08);
      const finalKalshiRef = finalSpot + gaussian(random) * 7;
      const finalPolyRef = finalSpot + gaussian(random) * 9;
      const kalshiOutcomeYes = finalKalshiRef >= strike;
      const polyOutcomeYes = finalPolyRef >= strike;
      // Generic outcome is retained only for backwards compatibility with single-venue fixtures.
      // The backtest engine prefers the venue-specific outcome fields above.
      const outcomeYes = kalshiOutcomeYes;
      const expiryTs = contractStart + totalSeconds * 1000;
      const contractId = `${marketHorizon}-${day}-${contractIndex}-${contractCounter++}`;
      const snapshots = marketHorizon === '1h' ? 9 : 7;
      let previousKalshiMid = 0.5;
      let previousPolyMid = 0.5;
      let previousSpot = baseSpot;

      for (let snap = 0; snap < snapshots; snap += 1) {
        const progress = snap / (snapshots - 1);
        // Do not include the exact settlement timestamp; last observable row is shortly before expiry.
        const effectiveProgress = Math.min(progress * 0.985, 0.985);
        const timestamp = contractStart + totalSeconds * effectiveProgress * 1000;
        const secondsRemaining = Math.max(1, Math.round((expiryTs - timestamp) / 1000));
        const bridge = baseSpot + (finalSpot - baseSpot) * effectiveProgress;
        const noiseScale = finalMoveScale * Math.sqrt(Math.max(0.02, (1 - effectiveProgress))) * 0.45;
        const compositePrice = Math.max(1000, bridge + gaussian(random) * noiseScale);
        const binancePrice = compositePrice + gaussian(random) * 6;
        const coinbasePrice = compositePrice + gaussian(random) * 7;
        const binanceBasis = binancePrice - compositePrice;
        const coinbaseBasis = coinbasePrice - compositePrice;
        // These are synthetic stand-ins only. Real mode must use exact reference-source archives.
        const kalshiReferencePrice = compositePrice * 0.72 + previousSpot * 0.28 + gaussian(random) * 4;
        const polyReferencePrice = compositePrice + gaussian(random) * 5;
        const uncertainty = Math.max(8, finalMoveScale * Math.sqrt(Math.max(secondsRemaining, 1) / totalSeconds));
        const fairProb = sigmoid((compositePrice - strike) / uncertainty * 1.55);
        // Build a mild synthetic lead/lag effect so the B-style workflow is demonstrable, not evidentiary.
        const latentFutureDirection = Math.sign(finalSpot - compositePrice);
        const kalshiMidLatent = clamp(fairProb + latentFutureDirection * 0.018 * (1 - effectiveProgress) + gaussian(random) * 0.018, 0.02, 0.98);
        const polyMidLatent = clamp(fairProb + latentFutureDirection * 0.008 * (1 - effectiveProgress) + gaussian(random) * 0.02, 0.02, 0.98);
        const k = quoteFromMid(kalshiMidLatent, random, 0);
        const p = quoteFromMid(polyMidLatent, random, gaussian(random) * 0.006);
        const kNo = complementaryQuote(k);
        // Polymarket YES/NO are separate outcome tokens. Give NO an independent
        // synthetic book so the engine can verify it prefers explicit NO quotes.
        const pNo = quoteFromMid(1 - polyMidLatent, random, gaussian(random) * 0.004);
        const elapsed = snap === 0 ? Math.max(1, totalSeconds / snapshots) : Math.max(1, totalSeconds * effectiveProgress / snap);
        const kalshiDelta = snap === 0 ? 0 : k.mid - previousKalshiMid;
        const polyDelta = snap === 0 ? 0 : p.mid - previousPolyMid;
        const btcMoveDollars = compositePrice - previousSpot;
        const btcReturnPct = previousSpot ? (compositePrice / previousSpot - 1) * 100 : 0;
        const expectedProbMoveFromBtc = btcMoveDollars / Math.max(500, uncertainty * 7);
        const kalshiResidual = kalshiDelta - expectedProbMoveFromBtc;
        const polyResidual = polyDelta - expectedProbMoveFromBtc;
        const binanceExpectedProbMove = (btcMoveDollars + binanceBasis) / Math.max(500, uncertainty * 7);
        const coinbaseExpectedProbMove = (btcMoveDollars + coinbaseBasis) / Math.max(500, uncertainty * 7);
        const vwapAnchor = dayOpen + (projectedClose - dayOpen) * Math.min(1, (offsetSeconds + totalSeconds * effectiveProgress) / 86400) * 0.65;
        const vwap = vwapAnchor + gaussian(random) * baseSpot * 0.0015;
        const emaSlow = compositePrice * (1 - macroDrift * 2) + gaussian(random) * 24;
        const emaFast = compositePrice * (1 + Math.sign(btcReturnPct) * 0.00035) + gaussian(random) * 14;
        const realizedVolPct = contractVol * 100;

        const sourceFields = {
          compositeVwap: vwap,
          binanceVwap: vwap + binanceBasis * 0.65,
          coinbaseVwap: vwap + coinbaseBasis * 0.65,
          compositeEmaFast: emaFast,
          binanceEmaFast: emaFast + binanceBasis * 0.8,
          coinbaseEmaFast: emaFast + coinbaseBasis * 0.8,
          compositeEmaSlow: emaSlow,
          binanceEmaSlow: emaSlow + binanceBasis * 0.55,
          coinbaseEmaSlow: emaSlow + coinbaseBasis * 0.55,
          compositeYesterdayHigh: yesterdayHigh,
          binanceYesterdayHigh: yesterdayHigh + binanceBasis * 0.25,
          coinbaseYesterdayHigh: yesterdayHigh + coinbaseBasis * 0.25,
          compositeYesterdayLow: yesterdayLow,
          binanceYesterdayLow: yesterdayLow + binanceBasis * 0.25,
          coinbaseYesterdayLow: yesterdayLow + coinbaseBasis * 0.25,
          compositeYesterdayClose: yesterdayClose,
          binanceYesterdayClose: yesterdayClose + binanceBasis * 0.25,
          coinbaseYesterdayClose: yesterdayClose + coinbaseBasis * 0.25,
          compositePriorWeekAvgClose: priorWeekAvgClose,
          binancePriorWeekAvgClose: priorWeekAvgClose + binanceBasis * 0.2,
          coinbasePriorWeekAvgClose: priorWeekAvgClose + coinbaseBasis * 0.2,
          compositePriorWeekHigh: priorWeekHigh,
          binancePriorWeekHigh: priorWeekHigh + binanceBasis * 0.2,
          coinbasePriorWeekHigh: priorWeekHigh + coinbaseBasis * 0.2,
          compositePriorWeekLow: priorWeekLow,
          binancePriorWeekLow: priorWeekLow + binanceBasis * 0.2,
          coinbasePriorWeekLow: priorWeekLow + coinbaseBasis * 0.2,
          compositePriorWeekClose: priorWeekClose,
          binancePriorWeekClose: priorWeekClose + binanceBasis * 0.2,
          coinbasePriorWeekClose: priorWeekClose + coinbaseBasis * 0.2,
          compositeRealizedVolPct: realizedVolPct,
          binanceRealizedVolPct: realizedVolPct * (0.985 + random() * 0.03),
          coinbaseRealizedVolPct: realizedVolPct * (0.98 + random() * 0.04),
        };

        rows.push({
          timestamp: new Date(timestamp).toISOString(),
          kalshiQuoteTimestamp: new Date(timestamp - Math.round(random() * 350)).toISOString(),
          polyQuoteTimestamp: new Date(timestamp - Math.round(random() * 350)).toISOString(),
          expiryTs,
          contractId,
          marketHorizon,
          strike,
          outcomeYes,
          kalshiOutcomeYes,
          polyOutcomeYes,
          btcPrice: compositePrice,
          compositePrice,
          binancePrice,
          coinbasePrice,
          kalshiReferencePrice,
          polyReferencePrice,
          vwap,
          emaFast,
          emaSlow,
          yesterdayHigh,
          yesterdayLow,
          yesterdayClose,
          priorWeekAvgClose,
          priorWeekHigh,
          priorWeekLow,
          priorWeekClose,
          btcReturnPct,
          btcMoveDollars,
          realizedVolPct,
          ...sourceFields,
          kalshiYesBid: k.bid,
          kalshiYesAsk: k.ask,
          kalshiYesMid: k.mid,
          kalshiYesLast: k.last,
          kalshiNoBid: kNo.bid,
          kalshiNoAsk: kNo.ask,
          kalshiNoMid: kNo.mid,
          kalshiNoLast: kNo.last,
          polyYesBid: p.bid,
          polyYesAsk: p.ask,
          polyYesMid: p.mid,
          polyYesLast: p.last,
          polyNoBid: pNo.bid,
          polyNoAsk: pNo.ask,
          polyNoMid: pNo.mid,
          polyNoLast: pNo.last,
          kalshiDelta,
          polyDelta,
          kalshiVelocity: kalshiDelta / elapsed,
          polyVelocity: polyDelta / elapsed,
          kalshiResidual,
          polyResidual,
          kalshiCompositeResidual: kalshiResidual,
          polyCompositeResidual: polyResidual,
          kalshiBinanceResidual: kalshiDelta - binanceExpectedProbMove,
          polyBinanceResidual: polyDelta - binanceExpectedProbMove,
          kalshiCoinbaseResidual: kalshiDelta - coinbaseExpectedProbMove,
          polyCoinbaseResidual: polyDelta - coinbaseExpectedProbMove,
          kalshiBookImbalance: clamp((fairProb - 0.5) * 1.2 + gaussian(random) * 0.3, -1, 1),
          polyBookImbalance: clamp((fairProb - 0.5) + gaussian(random) * 0.34, -1, 1),
        });

        previousKalshiMid = k.mid;
        previousPolyMid = p.mid;
        previousSpot = compositePrice;
      }
    });

    btc = projectedClose;
    prevDayClose = projectedClose;
    priorWeekCloses = [...priorWeekCloses.slice(1), projectedClose];
  }

  return rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
