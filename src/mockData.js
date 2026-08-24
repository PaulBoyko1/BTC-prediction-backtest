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
const YEAR_SECONDS = 365.25 * 24 * 3600;

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

function digitalProbability(spot, strike, secondsRemaining, annualVol) {
  if (!(spot > 0) || !(strike > 0) || !(secondsRemaining > 0) || !(annualVol > 0)) return spot >= strike ? 1 : 0;
  const t = secondsRemaining / YEAR_SECONDS;
  const d2 = (Math.log(spot / strike) - 0.5 * annualVol ** 2 * t) / (annualVol * Math.sqrt(t));
  return clamp(normalCdf(d2), 0.005, 0.995);
}

function quoteFromMid(mid, random, venueNoise = 0) {
  const noisy = clamp(mid + venueNoise + gaussian(random) * 0.006, 0.015, 0.985);
  const spread = clamp(0.008 + random() * 0.018, 0.005, 0.035);
  const bid = clamp(noisy - spread / 2, 0.005, 0.99);
  const ask = clamp(noisy + spread / 2, 0.01, 0.995);
  const last = clamp(noisy + gaussian(random) * spread * 0.35, bid, ask);
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

function evolveSpot(spot, dtSeconds, annualVol, driftAnnual, random) {
  const t = Math.max(0, dtSeconds) / YEAR_SECONDS;
  if (!t) return spot;
  const shock = annualVol * Math.sqrt(t) * gaussian(random);
  const logMove = (driftAnnual - 0.5 * annualVol ** 2) * t + shock;
  return Math.max(1000, spot * Math.exp(logMove));
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
    const dayDrift = 0.08 * Math.sin(day / 61) + gaussian(random) * 0.04;
    const dayOpen = btc;
    const projectedDayMove = gaussian(random) * 0.018 + dayDrift / 365.25;
    const projectedClose = Math.max(8000, dayOpen * Math.exp(projectedDayMove));
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
      const baseSpot = Math.max(1000,
        dayOpen * Math.exp(Math.log(projectedClose / dayOpen) * dayProgress) * (1 + gaussian(random) * 0.0025));
      const strike = marketHorizon === '1h'
        ? nearest(baseSpot + gaussian(random) * 120, 100)
        : baseSpot + gaussian(random) * 16;
      const contractVol = 0.42 + random() * 0.55;
      const driftAnnual = dayDrift;
      const snapshots = marketHorizon === '1h' ? 9 : 7;
      const contractId = `${marketHorizon}-${day}-${contractIndex}-${contractCounter++}`;
      const expiryTs = contractStart + totalSeconds * 1000;

      // Generate the observable BTC path strictly forward. The older demo first
      // sampled the final spot and then bridged intermediate prices toward it,
      // which unintentionally embedded a strong future-direction signal.
      const path = [];
      let spot = baseSpot;
      let previousTs = contractStart;
      for (let snap = 0; snap < snapshots; snap += 1) {
        const progress = snap / (snapshots - 1);
        const effectiveProgress = Math.min(progress * 0.985, 0.985);
        const timestamp = contractStart + totalSeconds * effectiveProgress * 1000;
        if (snap > 0) spot = evolveSpot(spot, (timestamp - previousTs) / 1000, contractVol, driftAnnual, random);
        path.push({ timestamp, spot });
        previousTs = timestamp;
      }
      const finalSpot = evolveSpot(spot, Math.max(1, (expiryTs - previousTs) / 1000), contractVol, driftAnnual, random);
      const finalKalshiRef = finalSpot + gaussian(random) * 5;
      const finalPolyRef = finalSpot + gaussian(random) * 7;
      const kalshiOutcomeYes = finalKalshiRef >= strike;
      const polyOutcomeYes = finalPolyRef >= strike;
      const outcomeYes = kalshiOutcomeYes;

      let previousKalshiMid = null;
      let previousPolyMid = null;
      let previousSpot = baseSpot;
      let priorKalshiReference = baseSpot;

      path.forEach(({ timestamp, spot: compositePrice }, snap) => {
        const secondsRemaining = Math.max(1, Math.round((expiryTs - timestamp) / 1000));
        const binancePrice = compositePrice + gaussian(random) * 4;
        const coinbasePrice = compositePrice + gaussian(random) * 5;
        const binanceBasis = binancePrice - compositePrice;
        const coinbaseBasis = coinbasePrice - compositePrice;

        // These are synthetic stand-ins only. They are deliberately distinct
        // from exchange spot and must never be labeled exact BRTI/Chainlink.
        const kalshiReferencePrice = compositePrice * 0.72 + priorKalshiReference * 0.28 + gaussian(random) * 3;
        const polyReferencePrice = compositePrice + gaussian(random) * 4;
        priorKalshiReference = kalshiReferencePrice;

        // Use the actual digital probability implied by the same forward GBM
        // process that drives the synthetic BTC path. This makes the demo close
        // to calibrated rather than manufacturing an accidental strategy edge.
        const fairProb = digitalProbability(compositePrice, strike, secondsRemaining, contractVol);
        const k = quoteFromMid(fairProb, random, gaussian(random) * 0.0025);
        const p = quoteFromMid(fairProb, random, gaussian(random) * 0.0035);
        const kNo = complementaryQuote(k);
        const pNo = quoteFromMid(1 - fairProb, random, gaussian(random) * 0.0035);

        const elapsed = snap === 0 ? Math.max(1, totalSeconds / snapshots) : Math.max(1, (timestamp - path[snap - 1].timestamp) / 1000);
        const kalshiDelta = previousKalshiMid === null ? 0 : k.mid - previousKalshiMid;
        const polyDelta = previousPolyMid === null ? 0 : p.mid - previousPolyMid;
        const btcMoveDollars = compositePrice - previousSpot;
        const btcReturnPct = previousSpot ? (compositePrice / previousSpot - 1) * 100 : 0;
        const remainingSigmaDollars = Math.max(5, compositePrice * contractVol * Math.sqrt(secondsRemaining / YEAR_SECONDS));
        const expectedProbMoveFromBtc = btcMoveDollars / Math.max(500, remainingSigmaDollars * 7);
        const kalshiResidual = kalshiDelta - expectedProbMoveFromBtc;
        const polyResidual = polyDelta - expectedProbMoveFromBtc;
        const binanceExpectedProbMove = (btcMoveDollars + binanceBasis) / Math.max(500, remainingSigmaDollars * 7);
        const coinbaseExpectedProbMove = (btcMoveDollars + coinbaseBasis) / Math.max(500, remainingSigmaDollars * 7);

        const intradayProgress = Math.min(1, (offsetSeconds + (timestamp - contractStart) / 1000) / 86400);
        const vwapAnchor = dayOpen * Math.exp(Math.log(projectedClose / dayOpen) * intradayProgress * 0.65);
        const vwap = vwapAnchor + gaussian(random) * baseSpot * 0.0012;
        const emaSlow = compositePrice * (1 - dayDrift / 365.25 * 2) + gaussian(random) * 18;
        const emaFast = compositePrice * (1 + Math.sign(btcReturnPct) * 0.00025) + gaussian(random) * 10;
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
          kalshiQuoteTimestamp: new Date(timestamp - Math.round(random() * 250)).toISOString(),
          polyQuoteTimestamp: new Date(timestamp - Math.round(random() * 250)).toISOString(),
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
          kalshiBookImbalance: clamp((fairProb - 0.5) * 1.1 + gaussian(random) * 0.28, -1, 1),
          polyBookImbalance: clamp((fairProb - 0.5) + gaussian(random) * 0.31, -1, 1),
        });

        previousKalshiMid = k.mid;
        previousPolyMid = p.mid;
        previousSpot = compositePrice;
      });
    });

    btc = projectedClose;
    prevDayClose = projectedClose;
    priorWeekCloses = [...priorWeekCloses.slice(1), projectedClose];
  }

  return rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
