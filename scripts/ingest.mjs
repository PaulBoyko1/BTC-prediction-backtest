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

function parsedDateMs(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`${label} must be a valid date or Unix timestamp`);
    return numeric >= 1e12 ? numeric : numeric * 1000;
  }
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO date or Unix timestamp`);
  return parsed;
}

function unixSeconds(value, label = 'timestamp') {
  const ms = parsedDateMs(value, label);
  return ms === undefined ? undefined : Math.floor(ms / 1000);
}

function unixMs(value, label = 'timestamp') {
  return parsedDateMs(value, label);
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

function tradeIdentity(trade) {
  return trade.trade_id
    || trade.id
    || `${trade.ticker || trade.market_ticker || ''}:${trade.created_time || trade.ts || ''}:${trade.yes_price_dollars || trade.yes_price || ''}:${trade.count_fp || trade.count || ''}`;
}

async function pageKalshiTrades(fetchPage, { ticker, minTs, maxTs, maxPages, label }) {
  let cursor;
  const trades = [];
  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchPage({ ticker, minTs, maxTs, limit: 1000, cursor });
    const batch = response.trades || response.data || [];
    trades.push(...batch);
    cursor = response.cursor;
    console.error(`Kalshi ${label} page ${page + 1}: +${batch.length} trades`);
    if (!cursor || batch.length === 0) break;
  }
  return trades;
}

async function ingestKalshiTrades() {
  const ticker = option('ticker');
  if (!ticker) throw new Error('--ticker is required');
  const minTs = unixSeconds(option('start'), '--start');
  const maxTs = unixSeconds(option('end'), '--end');
  if (minTs !== undefined && maxTs !== undefined && minTs > maxTs) throw new Error('--start must be before --end');
  const maxPages = Math.max(1, numberOption('pages', 100));

  const cutoffPayload = await kalshiApi.historicalCutoff();
  const cutoffTs = unixSeconds(cutoffPayload.trades_created_ts, 'Kalshi trades_created_ts cutoff');
  if (!Number.isFinite(cutoffTs)) throw new Error('Kalshi historical cutoff response did not contain a valid trades_created_ts');

  const trades = [];
  const queried = [];
  const historicalEnd = maxTs === undefined ? cutoffTs - 1 : Math.min(maxTs, cutoffTs - 1);
  const needsHistorical = (minTs === undefined || minTs < cutoffTs) && historicalEnd >= (minTs ?? 0);
  if (needsHistorical) {
    trades.push(...await pageKalshiTrades(
      (params) => kalshiApi.historicalTrades(params),
      { ticker, minTs, maxTs: historicalEnd, maxPages, label: 'historical' },
    ));
    queried.push({ tier: 'historical', minTs, maxTs: historicalEnd });
  }

  const liveStart = minTs === undefined ? cutoffTs : Math.max(minTs, cutoffTs);
  const needsLive = maxTs === undefined || maxTs >= cutoffTs;
  if (needsLive) {
    trades.push(...await pageKalshiTrades(
      (params) => kalshiApi.trades(params),
      { ticker, minTs: liveStart, maxTs, maxPages, label: 'live' },
    ));
    queried.push({ tier: 'live', minTs: liveStart, maxTs });
  }

  const unique = [...new Map(trades.map((trade) => [tradeIdentity(trade), trade])).values()]
    .sort((a, b) => new Date(a.created_time || 0) - new Date(b.created_time || 0));
  await writeRaw('kalshi', `${ticker}-trades`, unique, {
    ticker,
    minTs,
    maxTs,
    cutoffTs,
    queried,
    rawCount: trades.length,
    dedupedCount: unique.length,
  });
}

async function ingestKalshiMarket() {
  const ticker = option('ticker');
  if (!ticker) throw new Error('--ticker is required');
  let response;
  let tier = 'live';
  try {
    response = await kalshiApi.getMarket(ticker);
  } catch (error) {
    if (!String(error.message).startsWith('404 ')) throw error;
    response = await kalshiApi.historicalMarket(ticker);
    tier = 'historical';
  }
  await writeRaw('kalshi', `${ticker}-market`, response, { ticker, tier });
}

async function ingestKalshiCandles() {
  const seriesTicker = option('series');
  const ticker = option('ticker');
  if (!ticker) throw new Error('--ticker is required');
  const historicalSetting = String(option('historical', 'auto')).toLowerCase();
  if (!['auto', 'true', 'false'].includes(historicalSetting)) throw new Error('--historical must be auto, true, or false');
  let historical = historicalSetting === 'true';
  if (historicalSetting === 'auto') {
    try {
      await kalshiApi.getMarket(ticker);
      historical = false;
    } catch (error) {
      if (!String(error.message).startsWith('404 ')) throw error;
      await kalshiApi.historicalMarket(ticker);
      historical = true;
    }
  }
  if (!historical && !seriesTicker) throw new Error('--series is required for a live/non-historical Kalshi candlestick query');
  const startTs = unixSeconds(option('start'), '--start');
  const endTs = unixSeconds(option('end'), '--end');
  if (startTs !== undefined && endTs !== undefined && startTs > endTs) throw new Error('--start must be before --end');
  const periodInterval = numberOption('period', 1);
  const response = await kalshiApi.candlesticks({ seriesTicker, ticker, startTs, endTs, periodInterval, historical });
  await writeRaw('kalshi', `${ticker}-candles-${periodInterval}m`, response, { seriesTicker, ticker, startTs, endTs, periodInterval, historical });
}

async function ingestPolymarketHistory() {
  const tokenId = option('token');
  if (!tokenId) throw new Error('--token is required');
  const startTs = unixSeconds(option('start'), '--start');
  const endTs = unixSeconds(option('end'), '--end');
  if (startTs !== undefined && endTs !== undefined && startTs > endTs) throw new Error('--start must be before --end');
  const interval = option('interval', 'all');
  const fidelity = numberOption('fidelity', 1);
  const response = await polymarketApi.priceHistory({ tokenId, startTs, endTs, interval, fidelity });
  await writeRaw('polymarket', `${tokenId}-price-history`, response, { tokenId, startTs, endTs, interval, fidelity });
}

async function ingestPolymarketTrades() {
  const conditionId = option('condition');
  if (!conditionId) throw new Error('--condition is required');
  const start = unixSeconds(option('start'), '--start');
  const end = unixSeconds(option('end'), '--end');
  if (start !== undefined && end !== undefined && start > end) throw new Error('--start must be before --end');
  const limit = Math.min(10000, Math.max(1, numberOption('limit', 10000)));
  const maxPages = Math.max(1, numberOption('pages', 100));
  let offset = 0;
  const trades = [];
  let truncatedAtOffsetLimit = false;
  for (let page = 0; page < maxPages; page += 1) {
    if (offset > 10000) {
      truncatedAtOffsetLimit = true;
      break;
    }
    const batch = await polymarketApi.trades({ conditionIds: conditionId, start, end, limit, offset });
    const list = Array.isArray(batch) ? batch : batch.data || batch.trades || [];
    trades.push(...list);
    console.error(`Polymarket page ${page + 1}: +${list.length} trades`);
    if (list.length < limit) break;
    const nextOffset = offset + list.length;
    if (nextOffset > 10000) {
      truncatedAtOffsetLimit = true;
      break;
    }
    offset = nextOffset;
  }
  if (truncatedAtOffsetLimit) {
    console.error('WARNING: Polymarket Data API offset is capped at 10000. Narrow --start/--end and ingest in time chunks for a complete result.');
  }
  await writeRaw('polymarket', `${conditionId}-trades`, trades, { conditionId, start, end, truncatedAtOffsetLimit });
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
  let cursor = unixMs(option('start'), '--start');
  const endTime = unixMs(option('end'), '--end');
  if (cursor === undefined || endTime === undefined) throw new Error('--start and --end are required');
  if (cursor > endTime) throw new Error('--start must be before --end');
  const limit = Math.min(1000, Math.max(1, numberOption('limit', 1000)));
  const maxPages = Math.max(1, numberOption('pages', 5000));
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
  const startTime = unixMs(option('start'), '--start');
  const endTime = unixMs(option('end'), '--end');
  if (startTime === undefined || endTime === undefined) throw new Error('--start and --end are required');
  if (startTime > endTime) throw new Error('--start must be before --end');
  const maxPages = Math.max(1, numberOption('pages', 5000));
  let fromId;
  let first = true;
  const trades = [];
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await binanceApi.aggTrades(first
      ? { startTime, endTime, limit: 1000 }
      : { fromId, endTime, limit: 1000 });
    first = false;
    if (!Array.isArray(batch) || batch.length === 0) break;
    const filtered = batch.filter((trade) => Number(trade.T) >= startTime && Number(trade.T) <= endTime);
    trades.push(...filtered);
    const last = batch[batch.length - 1];
    const nextFromId = Number(last.a) + 1;
    if (!Number.isFinite(nextFromId) || nextFromId <= Number(fromId ?? -1)) throw new Error('Binance aggregate-trade pager did not advance');
    fromId = nextFromId;
    console.error(`Binance page ${page + 1}: +${filtered.length} aggTrades`);
    if (batch.length < 1000 || Number(last.T) >= endTime) break;
  }
  await writeRaw('binance', 'BTCUSDT-aggTrades', trades, { start: option('start'), end: option('end') });
}

async function ingestCoinbaseCandles() {
  const granularity = numberOption('granularity', 60);
  let cursor = unixMs(option('start'), '--start');
  const endMs = unixMs(option('end'), '--end');
  if (cursor === undefined || endMs === undefined) throw new Error('--start and --end are required ISO dates or Unix timestamps');
  if (cursor > endMs) throw new Error('--start must be before --end');
  const rows = [];
  const maxPages = Math.max(1, numberOption('pages', 5000));
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
  console.log(`BTC Prediction Backtest — public read-only ingestion\n\nCommands:\n  connections\n  kalshi-market --ticker TICKER\n  kalshi-trades --ticker TICKER [--start ISO|unix] [--end ISO|unix]\n  kalshi-candles --ticker TICKER [--series SERIES] [--historical auto|true|false] [--start ...] [--end ...] [--period 1]\n  poly-history --token TOKEN_ID [--start ...] [--end ...] [--interval all] [--fidelity 1]\n  poly-trades --condition CONDITION_ID [--start ...] [--end ...]\n  binance-klines --start ISO --end ISO [--interval 1m]\n  binance-aggtrades --start ISO --end ISO\n  coinbase-candles --start ISO --end ISO [--granularity 60]\n\nCommon:\n  --out data/raw\n  --pages N\n\nKalshi trade ingestion automatically combines historical/live tiers around the current cutoff.\nPolymarket trade pagination stops at the documented offset cap; use narrower date chunks if warned.\nThe script only performs market-data GET requests and writes raw JSON. It does not place orders.`);
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
