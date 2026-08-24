import fs from 'node:fs/promises';
import path from 'node:path';
import {
  testConnections,
  kalshiApi,
  polymarketApi,
  binanceApi,
  coinbaseApi,
} from '../src/dataAdapters.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

function option(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

function numberOption(name, fallback) {
  const value = Number(option(name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function unixSeconds(value) {
  if (value === undefined || value === null) return undefined;
  if (/^\d+$/.test(String(value))) return Number(value);
  return Math.floor(new Date(value).getTime() / 1000);
}

function unixMs(value) {
  if (value === undefined || value === null) return undefined;
  if (/^\d+$/.test(String(value))) return Number(value);
  return new Date(value).getTime();
}

function safeName(value) {
  return String(value || 'data').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
}

async function writeRaw(source, label, payload, metadata = {}) {
  const dir = path.resolve(option('out', 'data/raw'), source);
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}-${safeName(label)}.json`;
  const body = {
    downloadedAt: new Date().toISOString(),
    source,
    command,
    metadata,
    payload,
  };
  await fs.writeFile(path.join(dir, filename), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  console.log(path.join(dir, filename));
}

async function ingestKalshiTrades() {
  const ticker = option('ticker');
  if (!ticker) throw new Error('--ticker is required');
  const minTs = unixSeconds(option('start'));
  const maxTs = unixSeconds(option('end'));
  const maxPages = numberOption('pages', 100);
  let cursor;
  const trades = [];
  for (let page = 0; page < maxPages; page += 1) {
    const response = await kalshiApi.trades({ ticker, minTs, maxTs, limit: 1000, cursor });
    const batch = response.trades || response.data || [];
    trades.push(...batch);
    cursor = response.cursor;
    console.error(`Kalshi page ${page + 1}: +${batch.length} trades`);
    if (!cursor || batch.length === 0) break;
  }
  await writeRaw('kalshi', `${ticker}-trades`, trades, { ticker, minTs, maxTs });
}

async function ingestKalshiMarket() {
  const ticker = option('ticker');
  if (!ticker) throw new Error('--ticker is required');
  const response = await kalshiApi.getMarket(ticker);
  await writeRaw('kalshi', `${ticker}-market`, response, { ticker });
}

async function ingestKalshiCandles() {
  const seriesTicker = option('series');
  const ticker = option('ticker');
  if (!ticker) throw new Error('--ticker is required');
  const historical = option('historical', 'false') === true || option('historical', 'false') === 'true';
  if (!historical && !seriesTicker) throw new Error('--series is required for non-historical Kalshi candlesticks');
  const startTs = unixSeconds(option('start'));
  const endTs = unixSeconds(option('end'));
  const periodInterval = numberOption('period', 1);
  const response = await kalshiApi.candlesticks({ seriesTicker, ticker, startTs, endTs, periodInterval, historical });
  await writeRaw('kalshi', `${ticker}-candles-${periodInterval}m`, response, { seriesTicker, ticker, startTs, endTs, periodInterval, historical });
}

async function ingestPolymarketHistory() {
  const tokenId = option('token');
  if (!tokenId) throw new Error('--token is required');
  const startTs = unixSeconds(option('start'));
  const endTs = unixSeconds(option('end'));
  const interval = option('interval', 'all');
  const fidelity = numberOption('fidelity', 1);
  const response = await polymarketApi.priceHistory({ tokenId, startTs, endTs, interval, fidelity });
  await writeRaw('polymarket', `${tokenId}-price-history`, response, { tokenId, startTs, endTs, interval, fidelity });
}

async function ingestPolymarketTrades() {
  const conditionId = option('condition');
  if (!conditionId) throw new Error('--condition is required');
  const start = unixSeconds(option('start'));
  const end = unixSeconds(option('end'));
  const limit = Math.min(10000, numberOption('limit', 10000));
  const maxPages = numberOption('pages', 100);
  let offset = 0;
  const trades = [];
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await polymarketApi.trades({ conditionIds: conditionId, start, end, limit, offset });
    const list = Array.isArray(batch) ? batch : batch.data || batch.trades || [];
    trades.push(...list);
    console.error(`Polymarket page ${page + 1}: +${list.length} trades`);
    if (list.length < limit) break;
    offset += list.length;
  }
  await writeRaw('polymarket', `${conditionId}-trades`, trades, { conditionId, start, end });
}

const intervalMsMap = {
  '1s': 1000,
  '1m': 60000,
  '3m': 180000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};

async function ingestBinanceKlines() {
  const interval = option('interval', '1m');
  let cursor = unixMs(option('start'));
  const endTime = unixMs(option('end'));
  if (!cursor || !endTime) throw new Error('--start and --end are required');
  const limit = Math.min(1000, numberOption('limit', 1000));
  const maxPages = numberOption('pages', 5000);
  const intervalMs = intervalMsMap[interval];
  if (!intervalMs) throw new Error(`Unsupported interval for pager: ${interval}`);
  const rows = [];
  for (let page = 0; page < maxPages && cursor <= endTime; page += 1) {
    const batch = await binanceApi.klines({ interval, startTime: cursor, endTime, limit });
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    const lastOpen = Number(batch[batch.length - 1][0]);
    const next = lastOpen + intervalMs;
    if (next <= cursor) throw new Error('Binance kline pager did not advance');
    cursor = next;
    console.error(`Binance page ${page + 1}: +${batch.length} klines`);
    if (batch.length < limit) break;
  }
  await writeRaw('binance', `BTCUSDT-${interval}-klines`, rows, { interval, start: option('start'), end: option('end') });
}

async function ingestBinanceAggTrades() {
  const startTime = unixMs(option('start'));
  const endTime = unixMs(option('end'));
  if (!startTime || !endTime) throw new Error('--start and --end are required');
  const maxPages = numberOption('pages', 5000);
  let fromId;
  let first = true;
  const trades = [];
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await binanceApi.aggTrades(first
      ? { startTime, endTime, limit: 1000 }
      : { fromId, endTime, limit: 1000 });
    first = false;
    if (!Array.isArray(batch) || batch.length === 0) break;
    const filtered = batch.filter((trade) => Number(trade.T) <= endTime);
    trades.push(...filtered);
    const last = batch[batch.length - 1];
    fromId = Number(last.a) + 1;
    console.error(`Binance page ${page + 1}: +${filtered.length} aggTrades`);
    if (batch.length < 1000 || Number(last.T) >= endTime) break;
  }
  await writeRaw('binance', 'BTCUSDT-aggTrades', trades, { start: option('start'), end: option('end') });
}

async function ingestCoinbaseCandles() {
  const granularity = numberOption('granularity', 60);
  let cursor = new Date(option('start')).getTime();
  const endMs = new Date(option('end')).getTime();
  if (!Number.isFinite(cursor) || !Number.isFinite(endMs)) throw new Error('--start and --end are required ISO dates');
  const rows = [];
  const maxPages = numberOption('pages', 5000);
  const windowMs = granularity * 1000 * 299;
  for (let page = 0; page < maxPages && cursor < endMs; page += 1) {
    const windowEnd = Math.min(endMs, cursor + windowMs);
    const batch = await coinbaseApi.candles({
      start: new Date(cursor).toISOString(),
      end: new Date(windowEnd).toISOString(),
      granularity,
    });
    if (!Array.isArray(batch) || batch.length === 0) {
      cursor = windowEnd + granularity * 1000;
      continue;
    }
    rows.push(...batch);
    cursor = windowEnd + granularity * 1000;
    console.error(`Coinbase page ${page + 1}: +${batch.length} candles`);
  }
  const unique = [...new Map(rows.map((row) => [row[0], row])).values()].sort((a, b) => a[0] - b[0]);
  await writeRaw('coinbase', `BTC-USD-${granularity}s-candles`, unique, { granularity, start: option('start'), end: option('end') });
}

function help() {
  console.log(`BTC Prediction Backtest — public read-only ingestion\n\nCommands:\n  connections\n  kalshi-market --ticker TICKER\n  kalshi-trades --ticker TICKER [--start ISO|unix] [--end ISO|unix]\n  kalshi-candles --ticker TICKER --series SERIES [--start ...] [--end ...] [--period 1]\n  kalshi-candles --ticker TICKER --historical true [--start ...] [--end ...]\n  poly-history --token TOKEN_ID [--start ...] [--end ...] [--interval all] [--fidelity 1]\n  poly-trades --condition CONDITION_ID [--start ...] [--end ...]\n  binance-klines --start ISO --end ISO [--interval 1m]\n  binance-aggtrades --start ISO --end ISO\n  coinbase-candles --start ISO --end ISO [--granularity 60]\n\nCommon:\n  --out data/raw\n  --pages N\n\nThe script only performs market-data GET requests and writes raw JSON. It does not place orders.`);
}

try {
  if (command === 'connections') console.log(JSON.stringify(await testConnections(), null, 2));
  else if (command === 'kalshi-market') await ingestKalshiMarket();
  else if (command === 'kalshi-trades') await ingestKalshiTrades();
  else if (command === 'kalshi-candles') await ingestKalshiCandles();
  else if (command === 'poly-history') await ingestPolymarketHistory();
  else if (command === 'poly-trades') await ingestPolymarketTrades();
  else if (command === 'binance-klines') await ingestBinanceKlines();
  else if (command === 'binance-aggtrades') await ingestBinanceAggTrades();
  else if (command === 'coinbase-candles') await ingestCoinbaseCandles();
  else help();
} catch (error) {
  console.error(`Ingestion failed: ${error.message}`);
  process.exitCode = 1;
}
