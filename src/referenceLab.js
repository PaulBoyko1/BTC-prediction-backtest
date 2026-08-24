import { generateDemoDataset } from './mockData.js';
import { referenceSourceNotes } from './dataAdapters.js';

const root = document.querySelector('#reference-app');
const demoData = generateDemoDataset(3, 42);
// Exact rows must come from a verified ingestion/normalization path. Never point
// this at demoData merely because an API adapter exists.
const exactData = [];
const state = {
  mode: 'exact',
  years: 1,
  horizon: '15m',
  btcSource: 'Composite',
  venue: 'Both',
};

const fmt = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });

function activeData() {
  return state.mode === 'demo' ? demoData : exactData;
}

function latestTs(rows) {
  return rows.length ? Math.max(...rows.map((row) => new Date(row.timestamp).getTime()).filter(Number.isFinite)) : Date.now();
}

function selectedRows() {
  const source = activeData();
  const cutoff = latestTs(source) - Number(state.years) * 365.25 * 86400000;
  return source.filter((row) => row.marketHorizon === state.horizon && new Date(row.timestamp).getTime() >= cutoff);
}

function spot(row) {
  if (state.btcSource === 'Binance') return Number(row.binancePrice);
  if (state.btcSource === 'Coinbase') return Number(row.coinbasePrice);
  return Number(row.compositePrice);
}

function renderAvailability(venue) {
  const info = referenceSourceNotes[venue];
  return `<section class="availability">
    <div class="eyebrow">${venue.toUpperCase()}</div>
    <h3>${info.name}</h3>
    <p>${info.model}</p>
    <span class="blocked">${info.directFreeTickAdapter ? 'REFERENCE ADAPTER AVAILABLE · EXACT ROWS STILL REQUIRE INGESTION' : 'EXACT HISTORICAL TICK SOURCE NOT YET CONNECTED'}</span>
    <small>${info.note}</small>
  </section>`;
}

function availabilityCards() {
  if (state.venue === 'Kalshi') return renderAvailability('Kalshi');
  if (state.venue === 'Polymarket') return renderAvailability('Polymarket');
  return `${renderAvailability('Kalshi')}${renderAvailability('Polymarket')}`;
}

function render() {
  const rows = selectedRows();
  const canChart = rows.length > 0;
  root.innerHTML = `
    <div class="reference-nav">
      <a href="./index.html">← Strategy workbench</a>
      <span class="pill">Settlement reference lab</span>
    </div>
    <section class="reference-title">
      <div class="eyebrow">REFERENCE-PRICE ANALYSIS</div>
      <h1>BTC settlement reference vs exchange spot</h1>
      <p>Use this page to analyze the price source that actually resolves a prediction contract. Exchange spot, a composite BTC price, Kalshi's CF Benchmarks mechanism, and Polymarket's Chainlink source are deliberately kept separate.</p>
    </section>
    <section class="section-card">
      <div class="reference-controls">
        <label><span>Mode</span><select id="ref-mode"><option value="exact" ${state.mode === 'exact' ? 'selected' : ''}>Exact historical source</option><option value="demo" ${state.mode === 'demo' ? 'selected' : ''}>Synthetic mechanics demo</option></select></label>
        <label><span>Venue reference</span><select id="ref-venue"><option ${state.venue === 'Both' ? 'selected' : ''}>Both</option><option ${state.venue === 'Kalshi' ? 'selected' : ''}>Kalshi</option><option ${state.venue === 'Polymarket' ? 'selected' : ''}>Polymarket</option></select></label>
        <label><span>Contract horizon</span><select id="ref-horizon">${['5m','15m','1h'].map((h) => `<option ${state.horizon === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
        <label><span>History</span><select id="ref-years">${[1,2,3].map((y) => `<option value="${y}" ${Number(state.years) === y ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <label><span>BTC comparison</span><select id="ref-btc"><option ${state.btcSource === 'Composite' ? 'selected' : ''}>Composite</option><option ${state.btcSource === 'Binance' ? 'selected' : ''}>Binance</option><option ${state.btcSource === 'Coinbase' ? 'selected' : ''}>Coinbase</option></select></label>
      </div>
    </section>
    <div class="availability-grid">${availabilityCards()}</div>
    ${state.mode === 'demo' ? '<div class="reference-warning"><strong>Synthetic mechanics only.</strong> These reference series are generated demo fields used to test chart/strategy plumbing. They are not BRTI or Chainlink historical observations and must not be used to claim an edge.</div>' : ''}
    ${canChart ? renderCharts(rows) : renderWithheld()}
  `;
  bind();
  if (canChart) requestAnimationFrame(() => drawAll(rows));
}

function renderWithheld() {
  return `<section class="withheld">
    <strong>${state.mode === 'exact' ? 'Exact historical reference chart withheld' : 'No demo rows for this selection'}</strong>
    <p>${state.mode === 'exact'
      ? 'No verified exact-reference rows have been loaded into this page. An API/client adapter alone is not enough: the app intentionally refuses to substitute synthetic or Binance/Coinbase spot data and call it BRTI or Chainlink. Switch to “Synthetic mechanics demo” only to inspect the page mechanics.'
      : 'The selected synthetic horizon/window has no observations.'}</p>
  </section>`;
}

function renderCharts(rows) {
  const showKalshi = state.venue !== 'Polymarket';
  const showPoly = state.venue !== 'Kalshi';
  const kDiffs = showKalshi ? rows.map((row) => Number(row.kalshiReferencePrice) - spot(row)) : [];
  const pDiffs = showPoly ? rows.map((row) => Number(row.polyReferencePrice) - spot(row)) : [];
  const kAbs = kDiffs.length ? kDiffs.reduce((s, x) => s + Math.abs(x), 0) / kDiffs.length : 0;
  const pAbs = pDiffs.length ? pDiffs.reduce((s, x) => s + Math.abs(x), 0) / pDiffs.length : 0;
  return `
    <div class="metric-grid four">
      <div class="metric"><span>Rows</span><strong>${rows.length.toLocaleString()}</strong><small>${state.horizon} · ${state.years}y</small></div>
      ${showKalshi ? `<div class="metric"><span>Kalshi mean |ref − spot|</span><strong>$${fmt(kAbs, 2)}</strong><small>${state.mode === 'demo' ? 'synthetic reference series' : 'exact reference rows'}</small></div>` : ''}
      ${showPoly ? `<div class="metric"><span>Poly mean |ref − spot|</span><strong>$${fmt(pAbs, 2)}</strong><small>${state.mode === 'demo' ? 'synthetic reference series' : 'exact reference rows'}</small></div>` : ''}
      <div class="metric"><span>BTC comparison</span><strong>${state.btcSource}</strong><small>kept separate from settlement source</small></div>
    </div>
    <div class="reference-chart-grid">
      ${showKalshi ? '<section class="reference-chart-card"><strong>Kalshi reference − BTC</strong><span>Positive means reference above selected BTC source</span><canvas id="kalshi-ref-diff" height="230"></canvas></section>' : ''}
      ${showPoly ? '<section class="reference-chart-card"><strong>Polymarket reference − BTC</strong><span>Positive means reference above selected BTC source</span><canvas id="poly-ref-diff" height="230"></canvas></section>' : ''}
      ${showKalshi && showPoly ? '<section class="reference-chart-card"><strong>Kalshi reference − Polymarket reference</strong><span>Reference-source divergence</span><canvas id="reference-cross-diff" height="230"></canvas></section>' : ''}
    </div>
    <section class="summary-card reference-table">
      <div class="card-head"><div><strong>Reference geometry sample</strong><span>Last 20 normalized observations</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>BTC</th><th>Strike</th>${showKalshi ? '<th>Kalshi ref</th><th>K − BTC</th>' : ''}${showPoly ? '<th>Poly ref</th><th>P − BTC</th>' : ''}</tr></thead><tbody>${rows.slice(-20).reverse().map((row) => `<tr><td>${new Date(row.timestamp).toLocaleString()}</td><td>$${fmt(spot(row), 0)}</td><td>$${fmt(row.strike, 0)}</td>${showKalshi ? `<td>$${fmt(row.kalshiReferencePrice, 0)}</td><td>$${fmt(Number(row.kalshiReferencePrice) - spot(row), 2)}</td>` : ''}${showPoly ? `<td>$${fmt(row.polyReferencePrice, 0)}</td><td>$${fmt(Number(row.polyReferencePrice) - spot(row), 2)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    </section>
  `;
}

function draw(canvas, values, stroke) {
  if (!canvas || !values.length) return;
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return;
  const maxPoints = 800;
  const step = Math.max(1, Math.ceil(finiteValues.length / maxPoints));
  const points = finiteValues.filter((_, i) => i % step === 0 || i === finiteValues.length - 1);
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || 360;
  const height = canvas.clientHeight || 230;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);
  const pad = 28;
  let min = Math.min(...points);
  let max = Math.max(...points);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1;
  [0,.5,1].forEach((f) => { const yy = pad + f * (height - pad * 2); ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(width - pad, yy); ctx.stroke(); });
  if (min < 0 && max > 0) { ctx.strokeStyle = 'rgba(255,255,255,.28)'; const yy = y(0); ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(width-pad, yy); ctx.stroke(); }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((value, i) => { if (i === 0) ctx.moveTo(x(i), y(value)); else ctx.lineTo(x(i), y(value)); });
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.font = '11px system-ui';
  ctx.fillText(`$${fmt(max, 2)}`, 3, 14);
  ctx.fillText(`$${fmt(min, 2)}`, 3, height - 5);
}

function drawAll(rows) {
  if (state.venue !== 'Polymarket') {
    draw(document.querySelector('#kalshi-ref-diff'), rows.map((row) => Number(row.kalshiReferencePrice) - spot(row)), '#71e3ad');
  }
  if (state.venue !== 'Kalshi') {
    draw(document.querySelector('#poly-ref-diff'), rows.map((row) => Number(row.polyReferencePrice) - spot(row)), '#7da8ff');
  }
  if (state.venue === 'Both') {
    draw(document.querySelector('#reference-cross-diff'), rows.map((row) => Number(row.kalshiReferencePrice) - Number(row.polyReferencePrice)), '#f2bf6d');
  }
}

function bind() {
  document.querySelector('#ref-mode')?.addEventListener('change', (event) => { state.mode = event.target.value; render(); });
  document.querySelector('#ref-venue')?.addEventListener('change', (event) => { state.venue = event.target.value; render(); });
  document.querySelector('#ref-horizon')?.addEventListener('change', (event) => { state.horizon = event.target.value; render(); });
  document.querySelector('#ref-years')?.addEventListener('change', (event) => { state.years = Number(event.target.value); render(); });
  document.querySelector('#ref-btc')?.addEventListener('change', (event) => { state.btcSource = event.target.value; render(); });
}

render();
