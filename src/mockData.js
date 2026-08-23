function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function generateDemoDataset(years = 1, seed = 42) {
  const random = mulberry32(seed + years * 101);
  const now = new Date();
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - years);

  const rows = [];
  const total = Math.max(1200, years * 2400);
  let btc = 65000;

  for (let i = 0; i < total; i += 1) {
    const progress = i / Math.max(1, total - 1);
    const ts = new Date(start.getTime() + progress * (now.getTime() - start.getTime()));
    const regime = Math.sin(i / 190) * 0.35 + Math.sin(i / 47) * 0.12;
    const btcReturn = 0.00015 + regime * 0.00025 + normal(random) * 0.0045;
    const previousBtc = btc;
    btc = Math.max(10000, btc * (1 + btcReturn));

    const latent = Math.max(0.04, Math.min(0.96, 0.5 + regime * 0.16 + normal(random) * 0.17));
    const kalshiNoise = normal(random) * 0.035;
    const polyNoise = normal(random) * 0.04;
    const kalshi = Math.max(0.02, Math.min(0.98, latent + kalshiNoise));
    const polymarket = Math.max(0.02, Math.min(0.98, latent + polyNoise));
    const outcomeYes = random() < latent;

    const previousKalshi = rows.length ? rows[rows.length - 1].kalshiYes : kalshi;
    const previousPoly = rows.length ? rows[rows.length - 1].polyYes : polymarket;
    const minuteOfDay = ts.getUTCHours() * 60 + ts.getUTCMinutes();
    const sessionWave = Math.sin((minuteOfDay / 1440) * Math.PI * 2) * 0.0025;
    const vwap = btc * (1 - sessionWave + normal(random) * 0.001);
    const emaFast = btc * (1 - regime * 0.0015 + normal(random) * 0.0006);
    const emaSlow = btc * (1 - regime * 0.003 + normal(random) * 0.0005);
    const yesterdayClose = btc / (1 + normal(random) * 0.008);
    const yesterdayHigh = yesterdayClose * (1 + Math.abs(normal(random)) * 0.012);
    const yesterdayLow = yesterdayClose * (1 - Math.abs(normal(random)) * 0.012);
    const priorWeekAvgClose = btc / (1 + normal(random) * 0.02);
    const priorWeekHigh = priorWeekAvgClose * (1 + Math.abs(normal(random)) * 0.025);
    const priorWeekLow = priorWeekAvgClose * (1 - Math.abs(normal(random)) * 0.025);
    const minutesRemaining = [5, 15, 60][Math.floor(random() * 3)];
    const marketHorizon = minutesRemaining === 60 ? '1h' : `${minutesRemaining}m`;
    const secondsRemaining = Math.max(5, Math.floor(random() * minutesRemaining * 60));
    const round1000 = Math.round(btc / 1000) * 1000;
    const strike = round1000 + (Math.floor(random() * 5) - 2) * 100;

    rows.push({
      id: `demo-${years}-${i}`,
      timestamp: ts.toISOString(),
      contractId: `BTC-${ts.toISOString().slice(0, 16)}-${marketHorizon}-${i}`,
      marketHorizon,
      btcPrice: btc,
      btcReturnPct: ((btc / previousBtc) - 1) * 100,
      kalshiYes: kalshi,
      polyYes: polymarket,
      kalshiDelta: kalshi - previousKalshi,
      polyDelta: polymarket - previousPoly,
      kalshiBookImbalance: Math.max(-1, Math.min(1, regime * 0.5 + normal(random) * 0.35)),
      polyBookImbalance: Math.max(-1, Math.min(1, regime * 0.45 + normal(random) * 0.38)),
      secondsRemaining,
      strike,
      outcomeYes,
      vwap,
      emaFast,
      emaSlow,
      yesterdayHigh,
      yesterdayLow,
      yesterdayClose,
      priorWeekAvgClose,
      priorWeekHigh,
      priorWeekLow,
      realizedVolPct: Math.max(10, 55 + Math.abs(regime) * 45 + normal(random) * 14),
    });
  }

  return rows;
}
