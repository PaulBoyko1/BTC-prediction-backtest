const ENDPOINTS = {
  kalshi: 'https://external-api.kalshi.com/trade-api/v2',
  polymarketGamma: 'https://gamma-api.polymarket.com',
  polymarketClob: 'https://clob.polymarket.com',
  polymarketData: 'https://data-api.polymarket.com',
  binance: 'https://data-api.binance.vision/api/v3',
  binanceUs: 'https://api.binance.us/api/v3',
  coinbaseExchange: 'https://api.exchange.coinbase.com',
};

function qs(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      body: options.body,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function testConnections() {
  const tests = [
    ['Kalshi', `${ENDPOINTS.kalshi}/markets?limit=1`],
    ['Polymarket', `${ENDPOINTS.polymarketGamma}/markets?limit=1`],
    ['Binance public data', `${ENDPOINTS.binance}/ticker/price?symbol=BTCUSDT`],
    ['Coinbase', `${ENDPOINTS.coinbaseExchange}/products/BTC-USD/ticker`],
  ];
  const results = await Promise.all(tests.map(async ([name, url]) => {
    const started = performance.now();
    try {
      await fetchJson(url, { timeoutMs: 7000 });
      return { name, ok: true, latencyMs: Math.round(performance.now() - started), url };
    } catch (error) {
      return { name, ok: false, latencyMs: Math.round(performance.now() - started), url, error: error.message };
    }
  }));
  return results;
}

export const kalshiApi = {
  async listMarkets({ seriesTicker, status, limit = 100, cursor } = {}) {
    return fetchJson(`${ENDPOINTS.kalshi}/markets${qs({ series_ticker: seriesTicker, status, limit, cursor })}`);
  },
  async getMarket(ticker) {
    return fetchJson(`${ENDPOINTS.kalshi}/markets/${encodeURIComponent(ticker)}`);
  },
  async trades({ ticker, minTs, maxTs, limit = 1000, cursor } = {}) {
    return fetchJson(`${ENDPOINTS.kalshi}/markets/trades${qs({ ticker, min_ts: minTs, max_ts: maxTs, limit, cursor })}`);
  },
  async orderbook(ticker, depth = 20) {
    return fetchJson(`${ENDPOINTS.kalshi}/markets/${encodeURIComponent(ticker)}/orderbook${qs({ depth })}`);
  },
  async candlesticks({ seriesTicker, ticker, startTs, endTs, periodInterval = 1, historical = false }) {
    const path = historical
      ? `/historical/markets/${encodeURIComponent(ticker)}/candlesticks`
      : `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`;
    return fetchJson(`${ENDPOINTS.kalshi}${path}${qs({ start_ts: startTs, end_ts: endTs, period_interval: periodInterval, include_latest_before_start: true })}`);
  },
  async historicalCutoff() {
    return fetchJson(`${ENDPOINTS.kalshi}/historical/cutoff`);
  },
  async historicalMarkets({ limit = 1000, cursor } = {}) {
    return fetchJson(`${ENDPOINTS.kalshi}/historical/markets${qs({ limit, cursor })}`);
  },
  async historicalMarket(ticker) {
    return fetchJson(`${ENDPOINTS.kalshi}/historical/markets/${encodeURIComponent(ticker)}`);
  },
  async historicalTrades({ ticker, minTs, maxTs, limit = 1000, cursor } = {}) {
    return fetchJson(`${ENDPOINTS.kalshi}/historical/trades${qs({ ticker, min_ts: minTs, max_ts: maxTs, limit, cursor })}`);
  },
};

export const polymarketApi = {
  async listMarkets({ limit = 100, offset = 0, active, closed } = {}) {
    return fetchJson(`${ENDPOINTS.polymarketGamma}/markets${qs({ limit, offset, active, closed })}`);
  },
  async getMarket(id) {
    return fetchJson(`${ENDPOINTS.polymarketGamma}/markets/${encodeURIComponent(id)}`);
  },
  async priceHistory({ tokenId, startTs, endTs, interval = 'all', fidelity = 1 }) {
    return fetchJson(`${ENDPOINTS.polymarketClob}/prices-history${qs({ market: tokenId, startTs, endTs, interval, fidelity })}`);
  },
  async orderbook(tokenId) {
    return fetchJson(`${ENDPOINTS.polymarketClob}/book${qs({ token_id: tokenId })}`);
  },
  async midpoint(tokenId) {
    return fetchJson(`${ENDPOINTS.polymarketClob}/midpoint${qs({ token_id: tokenId })}`);
  },
  async trades({ conditionIds, start, end, limit = 10000, offset = 0 } = {}) {
    const market = Array.isArray(conditionIds) ? conditionIds.join(',') : conditionIds;
    return fetchJson(`${ENDPOINTS.polymarketData}/trades${qs({ market, start, end, limit, offset })}`);
  },
};

export const binanceApi = {
  async ticker() {
    return fetchJson(`${ENDPOINTS.binance}/ticker/price?symbol=BTCUSDT`);
  },
  async klines({ interval = '1m', startTime, endTime, limit = 1000 } = {}) {
    return fetchJson(`${ENDPOINTS.binance}/klines${qs({ symbol: 'BTCUSDT', interval, startTime, endTime, limit })}`);
  },
  async aggTrades({ startTime, endTime, fromId, limit = 1000 } = {}) {
    return fetchJson(`${ENDPOINTS.binance}/aggTrades${qs({ symbol: 'BTCUSDT', startTime, endTime, fromId, limit })}`);
  },
  async depth(limit = 100) {
    return fetchJson(`${ENDPOINTS.binance}/depth${qs({ symbol: 'BTCUSDT', limit })}`);
  },
  async usTicker() {
    return fetchJson(`${ENDPOINTS.binanceUs}/ticker/price?symbol=BTCUSDT`);
  },
};

export const coinbaseApi = {
  async ticker() {
    return fetchJson(`${ENDPOINTS.coinbaseExchange}/products/BTC-USD/ticker`);
  },
  async candles({ start, end, granularity = 60 } = {}) {
    return fetchJson(`${ENDPOINTS.coinbaseExchange}/products/BTC-USD/candles${qs({ start, end, granularity })}`);
  },
  async trades({ before, after, limit = 100 } = {}) {
    return fetchJson(`${ENDPOINTS.coinbaseExchange}/products/BTC-USD/trades${qs({ before, after, limit })}`);
  },
  async book(level = 2) {
    return fetchJson(`${ENDPOINTS.coinbaseExchange}/products/BTC-USD/book${qs({ level })}`);
  },
};

export function websocketEndpoints() {
  return {
    polymarket: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    binance: 'wss://data-stream.binance.vision:443/ws/btcusdt@aggTrade',
    coinbase: 'wss://advanced-trade-ws.coinbase.com',
    kalshi: 'wss://external-api-ws.kalshi.com/trade-api/ws/v2',
  };
}

export const referenceSourceNotes = {
  Kalshi: {
    name: 'CF Benchmarks BRTI',
    model: 'Current BTC 15m contracts use the BRTI mechanism described by the individual market rules; retain the rule version with each contract.',
    directFreeTickAdapter: false,
    note: 'Kalshi market/trade/result metadata are public. Exact pre-expiry BRTI history requires the appropriate CME/CF Benchmarks entitlement; resolved outcomes can still be exact without the full intracontract reference path.',
  },
  Polymarket: {
    name: 'Chainlink BTC/USD Data Streams',
    model: 'Use each contract’s exact resolutionSource/rule version. BTC Up/Down contracts have used different TWAP windows, so the window must never be inferred only from horizon.',
    directFreeTickAdapter: false,
    note: 'Exact recent reports can be queried with authorized Chainlink access. Older research may use a clearly labeled reconstructed Binance/Coinbase TWAP proxy, but it must never be labeled as exact Chainlink data.',
  },
};

export { ENDPOINTS };
