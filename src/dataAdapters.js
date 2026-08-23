const ENDPOINTS = {
  kalshi: 'https://external-api.kalshi.com/trade-api/v2',
  polymarketGamma: 'https://gamma-api.polymarket.com',
  polymarketClob: 'https://clob.polymarket.com',
  polymarketData: 'https://data-api.polymarket.com',
  binance: 'https://api.binance.com/api/v3',
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
    ['Binance', `${ENDPOINTS.binance}/ticker/price?symbol=BTCUSDT`],
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
    binance: 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade',
    coinbase: 'wss://advanced-trade-ws.coinbase.com',
    kalshi: 'wss://api.elections.kalshi.com/trade-api/ws/v2',
  };
}

export const referenceSourceNotes = {
  Kalshi: {
    name: 'CF Benchmarks BRTI',
    model: 'Simple average of 60 one-second RTI observations during the final minute for current BTC 15m contracts.',
    directFreeTickAdapter: false,
    note: 'Market metadata/rules are public. Historical BRTI tick licensing/availability must be verified separately before claiming an exact reference-price backtest.',
  },
  Polymarket: {
    name: 'Chainlink BTC/USD Data Streams',
    model: 'Use the exact market rule and resolution source. Current BTC Up/Down pages identify Chainlink BTC/USD Data Streams and warn against substituting ordinary spot.',
    directFreeTickAdapter: false,
    note: 'The app keeps this separate from Binance/Coinbase. Exact historical stream retrieval should be connected only through an authorized/archive source that matches the contract rule.',
  },
};

export { ENDPOINTS };
