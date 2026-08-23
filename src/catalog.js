export const factorCatalog = [
  {
    group: 'Prediction market',
    id: 'pm_price',
    label: 'Contract price',
    description: 'Require an executable or observed YES/NO price to reach a chosen level.',
    fields: [
      { key: 'venue', label: 'Signal venue', type: 'select', options: ['Trade target venue', 'Kalshi', 'Polymarket', 'Either'], default: 'Trade target venue' },
      { key: 'side', label: 'Observed side', type: 'select', options: ['Trade target side', 'YES', 'NO'], default: 'Trade target side' },
      { key: 'operator', label: 'Condition', type: 'select', options: ['<=', '>=', 'crosses_up', 'crosses_down'], default: '<=' },
      { key: 'value', label: 'Price / contract', type: 'number', min: 0.01, max: 0.99, step: 0.01, default: 0.45 },
      { key: 'marketHorizon', label: 'Market horizon', type: 'select', options: ['Trade target', '5m', '15m', '1h'], default: 'Trade target' },
    ],
  },
  {
    group: 'Prediction market',
    id: 'pm_delta',
    label: 'Prediction price shock',
    description: 'Detect a rapid probability move over a chosen lookback; useful for Kalshi-leading-BTC tests.',
    fields: [
      { key: 'venue', label: 'Venue', type: 'select', options: ['Kalshi', 'Polymarket'], default: 'Kalshi' },
      { key: 'lookbackSeconds', label: 'Lookback (seconds)', type: 'number', min: 1, max: 300, step: 1, default: 5 },
      { key: 'operator', label: 'Move', type: 'select', options: ['>=', '<='], default: '>=' },
      { key: 'value', label: 'Probability move', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0.08 },
    ],
  },
  {
    group: 'Prediction market',
    id: 'pm_velocity',
    label: 'Probability velocity',
    description: 'Rate of prediction-price change per second. Designed for extreme repricing studies.',
    fields: [
      { key: 'venue', label: 'Venue', type: 'select', options: ['Kalshi', 'Polymarket'], default: 'Kalshi' },
      { key: 'operator', label: 'Velocity', type: 'select', options: ['>=', '<='], default: '>=' },
      { key: 'value', label: 'Probability / second', type: 'number', min: -0.5, max: 0.5, step: 0.005, default: 0.02 },
    ],
  },
  {
    group: 'Prediction market',
    id: 'pm_book_imbalance',
    label: 'Order-book imbalance',
    description: 'Compare bid and ask depth before entering.',
    fields: [
      { key: 'venue', label: 'Venue', type: 'select', options: ['Kalshi', 'Polymarket'], default: 'Kalshi' },
      { key: 'depthLevels', label: 'Book levels', type: 'number', min: 1, max: 20, step: 1, default: 5 },
      { key: 'operator', label: 'Imbalance', type: 'select', options: ['>=', '<='], default: '>=' },
      { key: 'value', label: 'Threshold', type: 'number', min: -1, max: 1, step: 0.05, default: 0.25 },
    ],
  },
  {
    group: 'Prediction market',
    id: 'cross_market_spread',
    label: 'Kalshi ↔ Polymarket spread',
    description: 'Require equivalent contracts to disagree by a chosen amount.',
    fields: [
      { key: 'operator', label: 'Kalshi − Poly', type: 'select', options: ['>=', '<=', 'abs>=', 'abs<='], default: 'abs>=' },
      { key: 'value', label: 'Spread', type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.05 },
      { key: 'matchToleranceSeconds', label: 'Timestamp tolerance (sec)', type: 'number', min: 0, max: 60, step: 1, default: 2 },
    ],
  },
  {
    group: 'Prediction market',
    id: 'time_to_expiry',
    label: 'Time to expiry',
    description: 'Only enter within or outside a specified time-to-settlement window.',
    fields: [
      { key: 'operator', label: 'Remaining', type: 'select', options: ['<=', '>='], default: '<=' },
      { key: 'seconds', label: 'Seconds remaining', type: 'number', min: 1, max: 3600, step: 1, default: 120 },
    ],
  },
  {
    group: 'Prediction market',
    id: 'strike_offset',
    label: 'Strike / threshold geometry',
    description: 'Compare contract threshold with BTC or a round-number level, optionally requiring a cheap side.',
    fields: [
      { key: 'marketHorizon', label: 'Market horizon', type: 'select', options: ['Trade target', '1h', '15m', '5m'], default: '1h' },
      { key: 'reference', label: 'Reference', type: 'select', options: ['Current BTC', 'Nearest $100', 'Nearest $500', 'Nearest $1,000', 'Nearest $5,000'], default: 'Current BTC' },
      { key: 'operator', label: 'Strike offset', type: 'select', options: ['<=', '>=', 'abs<=', 'abs>='], default: 'abs<=' },
      { key: 'dollars', label: 'Distance ($)', type: 'number', min: 0, max: 20000, step: 10, default: 100 },
      { key: 'side', label: 'Observed side', type: 'select', options: ['Trade target side', 'YES', 'NO'], default: 'NO' },
      { key: 'maxPrice', label: 'Max side price', type: 'number', min: 0.01, max: 0.99, step: 0.01, default: 0.20 },
    ],
  },
  {
    group: 'Prediction market',
    id: 'pm_residual',
    label: 'Prediction move unexplained by BTC',
    description: 'Require prediction probability to move more than contemporaneous BTC would normally imply.',
    fields: [
      { key: 'venue', label: 'Venue', type: 'select', options: ['Kalshi', 'Polymarket'], default: 'Kalshi' },
      { key: 'operator', label: 'Residual', type: 'select', options: ['>=', '<='], default: '>=' },
      { key: 'value', label: 'Residual probability move', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0.05 },
    ],
  },
  {
    group: 'BTC',
    id: 'vwap_setup',
    label: 'VWAP setup',
    description: 'Named VWAP behavior with sensible defaults; advanced distance/tolerance remains configurable.',
    fields: [
      { key: 'setup', label: 'Setup', type: 'select', options: ['Bullish bias', 'Bearish bias', 'Reversal up', 'Reversal down', 'Continuation up', 'Continuation down', 'Support hold', 'Resistance hold', 'Breakthrough up', 'Breakthrough down'], default: 'Bullish bias' },
      { key: 'session', label: 'VWAP session', type: 'select', options: ['UTC day', 'Rolling 1h', 'Rolling 4h', 'Rolling 24h'], default: 'UTC day' },
      { key: 'tolerancePct', label: 'VWAP tolerance (%)', type: 'number', min: 0, max: 10, step: 0.05, default: 0.15 },
      { key: 'confirmationBars', label: 'Confirmation bars', type: 'number', min: 0, max: 20, step: 1, default: 1 },
    ],
  },
  {
    group: 'BTC',
    id: 'ema_cross',
    label: 'EMA relationship / cross',
    description: 'Fast/slow EMA structure or crossover.',
    fields: [
      { key: 'fast', label: 'Fast EMA', type: 'number', min: 2, max: 500, step: 1, default: 9 },
      { key: 'slow', label: 'Slow EMA', type: 'number', min: 3, max: 1000, step: 1, default: 21 },
      { key: 'timeframe', label: 'Candle', type: 'select', options: ['1m', '5m', '15m', '1h'], default: '5m' },
      { key: 'operator', label: 'Condition', type: 'select', options: ['fast_above', 'fast_below', 'cross_up', 'cross_down'], default: 'cross_up' },
    ],
  },
  {
    group: 'BTC',
    id: 'prior_day_level',
    label: 'Yesterday level',
    description: 'Test price relative to yesterday high, low, or close.',
    fields: [
      { key: 'level', label: 'Level', type: 'select', options: ['High', 'Low', 'Close'], default: 'High' },
      { key: 'operator', label: 'BTC price', type: 'select', options: ['>', '<', 'crosses_up', 'crosses_down', 'within_pct'], default: 'crosses_up' },
      { key: 'tolerancePct', label: 'Tolerance (%)', type: 'number', min: 0, max: 10, step: 0.05, default: 0.15 },
    ],
  },
  {
    group: 'BTC',
    id: 'prior_week_level',
    label: 'Prior-week statistic',
    description: 'Compare BTC with prior-week average or extremes.',
    fields: [
      { key: 'level', label: 'Statistic', type: 'select', options: ['Average close', 'High', 'Low', 'Close'], default: 'Average close' },
      { key: 'operator', label: 'BTC price', type: 'select', options: ['>', '<', 'crosses_up', 'crosses_down', 'within_pct'], default: '>' },
      { key: 'tolerancePct', label: 'Tolerance (%)', type: 'number', min: 0, max: 10, step: 0.05, default: 0.15 },
    ],
  },
  {
    group: 'BTC',
    id: 'return_momentum',
    label: 'Momentum / return',
    description: 'Require a BTC return over a configurable lookback.',
    fields: [
      { key: 'lookbackMinutes', label: 'Lookback (minutes)', type: 'number', min: 1, max: 1440, step: 1, default: 15 },
      { key: 'operator', label: 'Return', type: 'select', options: ['>=', '<='], default: '>=' },
      { key: 'returnPct', label: 'Return (%)', type: 'number', min: -20, max: 20, step: 0.05, default: 0.25 },
    ],
  },
  {
    group: 'BTC',
    id: 'realized_vol',
    label: 'Realized volatility regime',
    description: 'Filter signals by recent realized volatility.',
    fields: [
      { key: 'lookbackMinutes', label: 'Lookback (minutes)', type: 'number', min: 5, max: 10080, step: 5, default: 60 },
      { key: 'operator', label: 'Volatility', type: 'select', options: ['>=', '<='], default: '>=' },
      { key: 'annualizedPct', label: 'Annualized vol (%)', type: 'number', min: 1, max: 500, step: 1, default: 50 },
    ],
  },
  {
    group: 'BTC',
    id: 'round_level',
    label: 'Round-number proximity',
    description: 'Test behavior near xx000 / xxx00 BTC levels.',
    fields: [
      { key: 'rounding', label: 'Round to', type: 'select', options: ['$100', '$500', '$1,000', '$5,000'], default: '$1,000' },
      { key: 'distance', label: 'Within ($)', type: 'number', min: 1, max: 5000, step: 10, default: 100 },
    ],
  },
  {
    group: 'BTC',
    id: 'btc_move_gate',
    label: 'BTC move gate',
    description: 'Require BTC to have moved little or substantially while another signal fires.',
    fields: [
      { key: 'lookbackSeconds', label: 'Lookback (seconds)', type: 'number', min: 1, max: 900, step: 1, default: 5 },
      { key: 'operator', label: 'Absolute BTC move', type: 'select', options: ['<=', '>='], default: '<=' },
      { key: 'dollars', label: 'Move ($)', type: 'number', min: 0, max: 10000, step: 1, default: 20 },
    ],
  },
  {
    group: 'Reference price',
    id: 'reference_distance',
    label: 'Settlement reference vs strike',
    description: 'Use the venue settlement reference rather than exchange spot when the data is available.',
    fields: [
      { key: 'reference', label: 'Reference model', type: 'select', options: ['Auto by trade venue', 'Kalshi CF BRTI 60s average', 'Polymarket Chainlink Data Stream'], default: 'Auto by trade venue' },
      { key: 'operator', label: 'Reference − strike', type: 'select', options: ['>=', '<=', 'abs>=', 'abs<='], default: '>=' },
      { key: 'dollars', label: 'Distance ($)', type: 'number', min: 0, max: 20000, step: 10, default: 0 },
    ],
  },
  {
    group: 'Reference price',
    id: 'reference_vs_spot',
    label: 'Settlement reference vs BTC spot',
    description: 'Measure lag/divergence between the contract settlement reference and selected exchange/composite spot.',
    fields: [
      { key: 'reference', label: 'Reference model', type: 'select', options: ['Auto by trade venue', 'Kalshi CF BRTI 60s average', 'Polymarket Chainlink Data Stream'], default: 'Auto by trade venue' },
      { key: 'operator', label: 'Reference − spot', type: 'select', options: ['>=', '<=', 'abs>=', 'abs<='], default: 'abs>=' },
      { key: 'dollars', label: 'Difference ($)', type: 'number', min: 0, max: 10000, step: 1, default: 25 },
    ],
  },
];

export const branchCatalog = {
  prediction: {
    id: 'prediction',
    label: 'Start from Prediction Markets',
    description: 'Start with contract price / flow, then freely add BTC and reference-price confirmations.',
    defaultFactor: 'pm_price',
  },
  btc: {
    id: 'btc',
    label: 'Start from BTC',
    description: 'Start with a BTC technical setup, then freely add prediction-market and settlement-reference confirmations.',
    defaultFactor: 'vwap_setup',
  },
};

export const defaultExecutionSettings = {
  tradeVenue: 'Kalshi',
  tradeSide: 'YES',
  marketHorizon: '15m',
  entryObservation: 'ask',
  exitMode: 'expiry',
  exitTarget: 0.55,
  stopPrice: 0.35,
  exitSecondsRemaining: 30,
  reentryMode: 'once',
  maxEntriesPerContract: 1,
  entryCooldownSeconds: 0,
};

export const defaultRiskSettings = {
  startingCapital: 10000,
  sizingMode: 'fixed_pct',
  fixedTradePct: 2,
  kellyFraction: 0.25,
  kellyLookback: 100,
  kellyPriorWins: 10,
  kellyPriorLosses: 10,
  maxTradePct: 5,
  maxExposurePct: 20,
  minEdgePct: 0,
  slippageCents: 0.2,
  entryFeeCents: 0,
  exitFeeCents: 0,
};

export const defaultDataSettings = {
  mode: 'demo',
  btcSource: 'Composite (Binance + Coinbase)',
  predictionSource: 'Both',
  timestampResolution: 'Raw timestamps',
  referenceMode: 'Venue rule',
  largeFillSensitivityPts: 3,
  largeReturnSensitivityPct: 10,
};

export const advancedMetricHelp = {
  brier: 'Mean squared error of probability forecasts. Lower is better; 0 is perfect.',
  logLoss: 'Penalizes confident wrong probabilities more heavily. Lower is better.',
  calibration: 'How closely forecast probabilities match realized frequencies. Lower error is better.',
  confidence: 'Wilson 95% interval around observed win rate; shows sampling uncertainty.',
  significance: 'Approximate test of whether observed wins exceed the average contract-price breakeven rate.',
  expectancy: 'Average dollars earned or lost per completed trade.',
  profitFactor: 'Gross profits divided by gross losses. Above 1 means profits exceeded losses.',
  sortino: 'Return relative to downside volatility only; higher is better.',
  calmar: 'CAGR divided by maximum drawdown; reward relative to worst historical drawdown.',
  streaks: 'Longest consecutive winning and losing runs.',
  var: '5% Value-at-Risk on trade returns: a historical bad-tail threshold, not a guarantee.',
  cvar: 'Average trade return in the worst 5% tail; useful for loss severity.',
  digital: 'Digital-option N(d2) risk-neutral probability reference from spot/strike/time/volatility; not a true forecast by itself.',
};

export function getFactorTemplate(id) {
  return factorCatalog.find((factor) => factor.id === id) || factorCatalog[0];
}
