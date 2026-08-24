#!/usr/bin/env node

/**
 * Credentialed Chainlink Data Streams reference-data reader.
 *
 * This intentionally contains no trading/order code. It uses Chainlink's official
 * SDK and writes raw/decoded reports so Polymarket settlement-reference studies can
 * remain distinct from Binance/Coinbase spot proxies.
 *
 * Required environment variables:
 *   API_KEY
 *   USER_SECRET
 *
 * Optional:
 *   CHAINLINK_REST_ENDPOINT=https://api.dataengine.chain.link
 *   CHAINLINK_WS_ENDPOINT=wss://ws.dataengine.chain.link
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  createClient,
  decodeReport,
} from '@chainlink/data-streams-sdk';

const REST_ENDPOINT = process.env.CHAINLINK_REST_ENDPOINT || 'https://api.dataengine.chain.link';
const WS_ENDPOINT = process.env.CHAINLINK_WS_ENDPOINT || 'wss://ws.dataengine.chain.link';

function usage(exitCode = 0) {
  console.log(`
Chainlink Data Streams reference reader

Usage:
  npm run chainlink:reference -- feeds [search]
  npm run chainlink:reference -- latest <feedId> [output.json]
  npm run chainlink:reference -- timestamp <feedId> <unixSeconds> [output.json]
  npm run chainlink:reference -- page <feedId> <startUnixSeconds> [limit] [output.json]

Examples:
  npm run chainlink:reference -- feeds BTC
  npm run chainlink:reference -- page 0x... 1787000000 100 data/raw/chainlink/page.json

Important:
  The official SDK example warns that historical-page timestamps must be within
  the last 30 days. Treat older exact history as unavailable unless Chainlink or
  an authorized archive explicitly provides it.
`);
  process.exit(exitCode);
}

function requireCredentials() {
  const apiKey = process.env.API_KEY;
  const userSecret = process.env.USER_SECRET;
  if (!apiKey || !userSecret) {
    throw new Error('Missing API_KEY / USER_SECRET Chainlink Data Streams credentials.');
  }
  return { apiKey, userSecret };
}

function client() {
  const { apiKey, userSecret } = requireCredentials();
  return createClient({
    apiKey,
    userSecret,
    endpoint: REST_ENDPOINT,
    wsEndpoint: WS_ENDPOINT,
  });
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => (
    typeof item === 'bigint' ? item.toString() : item
  )));
}

function decodedReport(report) {
  const decoded = decodeReport(report.fullReport, report.feedID);
  return jsonSafe({
    feedID: report.feedID,
    validFromTimestamp: report.validFromTimestamp,
    observationsTimestamp: report.observationsTimestamp,
    fullReport: report.fullReport,
    decoded,
  });
}

async function writeOutput(output, payload) {
  if (!output) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const resolved = path.resolve(output);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`saved ${resolved}`);
}

function warnRetention(timestampSeconds) {
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(timestampSeconds);
  if (ageSeconds > 30 * 86400) {
    console.warn(
      'WARNING: requested start is older than 30 days. The official SDK example '
      + 'documents a 30-day historical-page limit; this request may be rejected.'
    );
  }
}

async function commandFeeds(search = '') {
  const feeds = await client().listFeeds();
  const term = search.toLowerCase();
  const filtered = term
    ? feeds.filter((feed) => JSON.stringify(jsonSafe(feed)).toLowerCase().includes(term))
    : feeds;
  await writeOutput(null, jsonSafe(filtered));
}

async function commandLatest(feedId, output) {
  const report = await client().getLatestReport(feedId);
  await writeOutput(output, decodedReport(report));
}

async function commandTimestamp(feedId, timestamp, output) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new Error('timestamp must be Unix seconds');
  warnRetention(ts);
  const report = await client().getReportByTimestamp(feedId, ts);
  await writeOutput(output, decodedReport(report));
}

async function commandPage(feedId, startTimestamp, limitText, output) {
  const start = Number(startTimestamp);
  if (!Number.isFinite(start)) throw new Error('start timestamp must be Unix seconds');
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('limit must be a positive integer');
  }
  warnRetention(start);
  const reports = await client().getReportsPage(feedId, start, limit);
  await writeOutput(output, reports.map(decodedReport));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') usage(0);

  if (command === 'feeds') return commandFeeds(args[0] || '');
  if (command === 'latest') {
    if (!args[0]) usage(1);
    return commandLatest(args[0], args[1]);
  }
  if (command === 'timestamp') {
    if (!args[0] || !args[1]) usage(1);
    return commandTimestamp(args[0], args[1], args[2]);
  }
  if (command === 'page') {
    if (!args[0] || !args[1]) usage(1);
    return commandPage(args[0], args[1], args[2], args[3]);
  }

  usage(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
