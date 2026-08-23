export const branchCatalog = {
  prediction: {
    id: 'prediction',
    label: 'Prediction Markets',
    description: 'Test Kalshi / Polymarket prices, order flow, contract geometry, and cross-market discrepancies.',
    factors: [
      {
        id: 'pm_price',
        label: 'Contract price',
        description: 'Enter when YES or NO contract price crosses a chosen level.',
        fields: [
          { key: 'venue', label: 'Venue', type: 'select', options: ['Kalshi', 'Polymarket', 'Either'], default: 'Kalshi' },
          { key: 'side', label: 'Contract side', type: 'select', options: ['YES', 'NO'], default: 'YES' },
          { key: 'operator', label: 'Condition', type: 'select', options: ['<=', '>=', 'crosses_up', 'crosses_down'], default: '<=' },
          { key: 'value', label: 'Price / contract', type: 'number', min: 0.01, max: 0.99, step: 0.01, default: 0.45 },
          { key: 'marketHorizon', label: 'Market horizon', type: 'select', options: ['5m', '15m', '1h'], default: '15m' },
        ],
      },
      {
        id: 'pm_delta',
        label: 'Prediction price shock',
        description: 'Detect rapid repricing in the prediction market over a chosen lookback.',
        fields: [
          { key: 'venue', label: 'Venue', type: 'select', options: ['Kalshi', 'Polymarket'], default: 'Kalshi' },
          { key: 'lookbackSeconds', label: 'Lookback (seconds)', type: 'number', min: 1, max: 300, step: 1, default: 5 },
          { key: 'operator', label: 'Move', type: 'select', options: ['>=', '<='], default: '>=' },
          { key: 'value', label: 'Probability move', type: 'number', min: -0.5, max: 0.5, step: 0.01, default: 0.08 },
        ],
      },
      {
        id: 'pm_book_imbalance',
        label: 'Order-book imbalance',
        description: 'Compare YES-side bid depth with ask depth before entering.',
        fields: [
          { key: 'venue', label: 'Venue', type: 'select', options: ['Kalshi', 'Polymarket'], default: 'Kalshi' },
          { key: 'depthLevels', label: 'Book levels', type: 'number', min: 1, max: 20, step: 1, default: 5 },
          { key: 'operator', label: 'Imbalance', type: 'select', options: ['>=', '<='], default: '>=' },
          { key: 'value', label: 'Threshold', type: 'number', min: -1, max: 1, step: 0.05, default: 0.25 },
        ],
      },
      {
        id: 'cross_market_spread',
        label: 'Kalshi ↔ Polymarket spread',
        description: 'Test when equivalent BTC contracts disagree by a chosen amount.',
        fields: [
          { key: 'operator', label: 'Kalshi − Poly', type: 'select', options: ['>=', '<=', 'abs>='], default: 'abs>=' },
          { key: 'value', label: 'Spread', type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.05 },
          { key: 'matchToleranceSeconds', label: 'Timestamp tolerance (sec)', type: 'number', min: 0, max: 60, step: 1, default: 2 },
        ],
      },
      {
        id: 'time_to_expiry',
        label: 'Time to expiry',
        description: 'Only enter within or outside a specified time-to-settlement window.',
        fields: [
          { key: 'operator', label: 'Remaining', type: 'select', options: ['<=', '>='], default: '<=' },
          { key: 'seconds', label: 'Seconds remaining', type: 'number', min: 1, max: 3600, step: 1, default: 120 },
        ],
      },
      {
        id: 'strike_offset',
        label: 'Strike / threshold vs BTC',
        description: 'For hourly threshold markets: compare target strike with current BTC and round-number levels.',
        fields: [
          { key: 'marketHorizon', label: 'Market horizon', type: 'select', options: ['1h', '15m', '5m'], default: '1h' },
          { key: 'reference', label: 'Reference', type: 'select', options: ['Current BTC', 'Nearest $100', 'Nearest $500', 'Nearest $1,000'], default: 'Current BTC' },
          { key: 'operator', label: 'Strike offset', type: 'select', options: ['<=', '>=', 'abs<=', 'abs>='], default: 'abs<=' },
          { key: 'dollars', label: 'Distance ($)', type: 'number', min: 0, max: 10000, step: 10, default: 100 },
          { key: 'side', label: 'Contract side', type: 'select', options: ['YES', 'NO'], default: 'NO' },
          { key: 'maxPrice', label: 'Max contract price', type: 'number', min: 0.01, max: 0.99, step: 0.01, default: 0.20 },
        ],
      },
    ],
  },
  btc: {
    id: 'btc',
    label: 'BTC Technicals',
    description: 'Build rules from BTC price, VWAP, EMAs, prior-day/week levels, momentum and volatility.',
    factors: [
      {
        id: 'btc_vs_vwap',
        label: 'Price vs VWAP',
        description: 'Compare BTC spot with session VWAP.',
        fields: [
          { key: 'session', label: 'VWAP session', type: 'select', options: ['UTC day', 'Rolling 1h', 'Rolling 4h', 'Rolling 24h'], default: 'UTC day' },
          { key: 'operator', label: 'BTC price', type: 'select', options: ['>', '<', 'crosses_up', 'crosses_down'], default: '>' },
          { key: 'offsetPct', label: 'Offset (%)', type: 'number', min: -10, max: 10, step: 0.05, default: 0 },
        ],
      },
      {
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
        id: 'round_level',
        label: 'Round-number proximity',
        description: 'Test behavior near xx000 / xxx00 BTC levels.',
        fields: [
          { key: 'rounding', label: 'Round to', type: 'select', options: ['$100', '$500', '$1,000', '$5,000'], default: '$1,000' },
          { key: 'distance', label: 'Within ($)', type: 'number', min: 1, max: 5000, step: 10, default: 100 },
        ],
      },
    ],
  },
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
  feeCents: 0,
  fillMode: 'ask',
  holdMode: 'expiry',
  cooldownMinutes: 0,
  oneEntryPerContract: true,
};
