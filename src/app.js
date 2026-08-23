import { branchCatalog, defaultRiskSettings } from './catalog.js';
import { generateDemoDataset } from './mockData.js';
import { runBacktest, digitalProbability } from './backtest.js';

const app = document.querySelector('#app');

const state = {
  tab: 'test',
  branch: null,
  factors: [],
  joinMode: 'AND',
  years: 1,
  seed: 42,
  risk: { ...defaultRiskSettings },
  result: null,
  demoData: generateDemoDataset(1, 42),
};

const fmtPct = (value, digits = 1) => `${(Number(value || 0) * 100).toFixed(digits)}%`;
const fmtMoney = (value) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function createFactor(typeId) {
  const branch = branchCatalog[state.branch];
  const template = branch.factors.find((factor) => factor.id === typeId) || branch.factors[0];
  return {
    instanceId: uid(),
    type: template.id,
    values: Object.fromEntries(template.fields.map((field) => [field.key, field.default ?? ''])),
  };
}

function setBranch(branchId) {
  state.branch = branchId;
  state.factors = [createFactor(branchCatalog[branchId].factors[0].id)];
  state.result = null;
  render();
}

function setTab(tab) {
  state.tab = tab;
  render();
}

function run() {
  state.demoData = generateDemoDataset(Number(state.years), Number(state.seed));
  state.result = runBacktest({
    rows: state.demoData,
    factors: state.factors,
    joinMode: state.joinMode,
    risk: state.risk,
  });
  render();
  requestAnimationFrame(drawEquityChart);
}

function render() {
  app.innerHTML = `
    <div class="shell">
      ${renderSidebar()}
      <main class="main">
        ${renderTopbar()}
        ${state.tab === 'test' ? renderTestIdeas() : ''}
        ${state.tab === 'compare' ? renderCompare() : ''}
        ${state.tab === 'data' ? renderDataSources() : ''}
        ${state.tab === 'about' ? renderAbout() : ''}
      </main>
    </div>
  `;
  bindEvents();
  if (state.result) requestAnimationFrame(drawEquityChart);
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">₿</div>
        <div><strong>BTC Lab</strong><span>Prediction Backtest</span></div>
      </div>
      <nav>
        ${navButton('test', '◫', 'Test Ideas')}
        ${navButton('compare', '⇄', 'Market Compare')}
        ${navButton('data', '⌁', 'Data Sources')}
        ${navButton('about', 'i', 'Methodology')}
      </nav>
      <div class="sidebar-note">
        <span class="status-dot"></span>
        Demo-data mode
        <small>API adapters are intentionally separate from strategy logic.</small>
      </div>
    </aside>
  `;
}

function navButton(id, icon, label) {
  return `<button class="nav-btn ${state.tab === id ? 'active' : ''}" data-tab="${id}"><span>${icon}</span>${label}</button>`;
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div>
        <div class="eyebrow">RESEARCH WORKBENCH</div>
        <h1>${state.tab === 'test' ? 'Strategy Composer' : state.tab === 'compare' ? 'Prediction Market Comparison' : state.tab === 'data' ? 'Data & API Adapters' : 'Backtest Methodology'}</h1>
      </div>
      <div class="top-actions">
        <span class="pill">No live orders</span>
        <span class="pill subtle">v0.1 foundation</span>
      </div>
    </header>
  `;
}

function renderTestIdeas() {
  if (!state.branch) return renderBranchChooser();
  return `
    <section class="workspace">
      <div class="workspace-grid">
        <div class="builder-column">
          <div class="section-heading">
            <div>
              <button class="text-btn" id="change-branch">← Change branch</button>
              <h2>${branchCatalog[state.branch].label}</h2>
              <p>${branchCatalog[state.branch].description}</p>
            </div>
            <div class="segmented">
              <button data-join="AND" class="${state.joinMode === 'AND' ? 'active' : ''}">AND</button>
              <button data-join="OR" class="${state.joinMode === 'OR' ? 'active' : ''}">OR</button>
            </div>
          </div>
          <div class="factor-stack">
            ${state.factors.map((factor, index) => renderFactor(factor, index)).join('')}
          </div>
          <button class="add-factor" id="add-factor">＋ Add factor</button>
          ${renderRiskPanel()}
          ${renderRunPanel()}
        </div>
        <div class="results-column">
          ${state.result ? renderResults() : renderEmptyResults()}
        </div>
      </div>
    </section>
  `;
}

function renderBranchChooser() {
  return `
    <section class="branch-page">
      <div class="branch-intro">
        <span class="eyebrow">START WITH ONE IDEA</span>
        <h2>What should drive the trade?</h2>
        <p>Choose a branch, start with one condition, then add as many filters or confirmations as you want.</p>
      </div>
      <div class="branch-grid">
        ${branchCard('prediction', 'Prediction markets', 'Kalshi / Polymarket price, probability shocks, order books, settlement geometry and cross-market spread.', ['15m YES ≤ $0.45', 'Kalshi − Poly ≥ 5¢', 'NO ≤ $0.20 near strike'])}
        ${branchCard('btc', 'BTC technicals', 'VWAP, EMA structure, momentum, volatility, prior-day/week levels and round-number behavior.', ['Price > VWAP', 'EMA 9 crosses EMA 21', 'Near yesterday high'])}
      </div>
      <div class="principle-card">
        <strong>Fair-test default</strong>
        <p>Signals are evaluated without future data. Portfolio sizing is recomputed trade-by-trade, and Kelly mode estimates win probability only from earlier completed trades.</p>
      </div>
    </section>
  `;
}

function branchCard(id, title, text, examples) {
  return `
    <button class="branch-card" data-branch="${id}">
      <div class="branch-icon">${id === 'prediction' ? '◈' : '⌁'}</div>
      <h3>${title}</h3>
      <p>${text}</p>
      <div class="example-list">${examples.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="branch-cta">Open branch →</div>
    </button>
  `;
}

function renderFactor(factor, index) {
  const template = branchCatalog[state.branch].factors.find((item) => item.id === factor.type);
  return `
    <article class="factor-card" data-factor-id="${factor.instanceId}">
      <div class="factor-head">
        <div class="factor-number">${index + 1}</div>
        <div class="factor-title">
          <select class="factor-type" data-factor-id="${factor.instanceId}">
            ${branchCatalog[state.branch].factors.map((item) => `<option value="${item.id}" ${item.id === factor.type ? 'selected' : ''}>${item.label}</option>`).join('')}
          </select>
          <p>${template.description}</p>
        </div>
        ${state.factors.length > 1 ? `<button class="icon-btn remove-factor" data-factor-id="${factor.instanceId}" title="Remove">×</button>` : ''}
      </div>
      <div class="field-grid">
        ${template.fields.map((field) => renderField(field, factor)).join('')}
      </div>
    </article>
  `;
}

function renderField(field, factor) {
  const value = factor.values[field.key] ?? field.default ?? '';
  if (field.type === 'select') {
    return `<label><span>${field.label}</span><select class="factor-value" data-factor-id="${factor.instanceId}" data-key="${field.key}">${field.options.map((option) => `<option ${String(option) === String(value) ? 'selected' : ''}>${option}</option>`).join('')}</select></label>`;
  }
  return `<label><span>${field.label}</span><input class="factor-value" data-factor-id="${factor.instanceId}" data-key="${field.key}" type="number" value="${value}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 'any'}" /></label>`;
}

function renderRiskPanel() {
  return `
    <details class="panel" open>
      <summary><div><strong>Portfolio & execution</strong><span>How a real account would size and fill the signals</span></div><span>⌄</span></summary>
      <div class="panel-body settings-grid">
        ${riskInput('startingCapital', 'Starting capital', 'number', 1000, 10000000, 1000)}
        <label><span>Sizing mode</span><select class="risk-value" data-key="sizingMode"><option value="fixed_pct" ${state.risk.sizingMode === 'fixed_pct' ? 'selected' : ''}>Fixed % of equity</option><option value="kelly" ${state.risk.sizingMode === 'kelly' ? 'selected' : ''}>Fractional Kelly (prior trades only)</option></select></label>
        ${state.risk.sizingMode === 'fixed_pct' ? riskInput('fixedTradePct', 'Trade size (%)', 'number', 0.01, 100, 0.25) : `${riskInput('kellyFraction', 'Kelly multiplier', 'number', 0, 1, 0.05)}${riskInput('kellyLookback', 'Kelly lookback trades', 'number', 5, 5000, 5)}${riskInput('kellyPriorWins', 'Prior pseudo-wins', 'number', 0, 1000, 1)}${riskInput('kellyPriorLosses', 'Prior pseudo-losses', 'number', 0, 1000, 1)}`}
        ${riskInput('maxTradePct', 'Max single trade (%)', 'number', 0.1, 100, 0.5)}
        ${riskInput('maxExposurePct', 'Max total exposure (%)', 'number', 0.1, 100, 1)}
        ${riskInput('minEdgePct', 'Min estimated edge (pts)', 'number', 0, 50, 0.1)}
        ${riskInput('slippageCents', 'Slippage (¢/share)', 'number', 0, 20, 0.1)}
        ${riskInput('feeCents', 'Fee allowance (¢/share)', 'number', 0, 20, 0.1)}
        ${riskInput('cooldownMinutes', 'Cooldown (minutes)', 'number', 0, 1440, 1)}
        <label><span>Exit</span><select disabled><option>Hold to settlement</option></select></label>
      </div>
      <div class="panel-foot">Kelly is deliberately Bayesian-smoothed and backward-looking only. Live fee formulas can later be venue-specific adapters.</div>
    </details>
  `;
}

function riskInput(key, label, type, min, max, step) {
  return `<label><span>${label}</span><input class="risk-value" data-key="${key}" type="${type}" value="${state.risk[key]}" min="${min}" max="${max}" step="${step}" /></label>`;
}

function renderRunPanel() {
  return `
    <div class="run-panel">
      <div class="run-controls">
        <label><span>History window</span><select id="years"><option value="1" ${state.years === 1 ? 'selected' : ''}>1 year</option><option value="2" ${state.years === 2 ? 'selected' : ''}>2 years</option><option value="3" ${state.years === 3 ? 'selected' : ''}>3 years</option></select></label>
        <label><span>Demo seed</span><input id="seed" type="number" value="${state.seed}" /></label>
      </div>
      <button class="execute-btn" id="execute">▶ Execute backtest</button>
      <p>Currently uses deterministic synthetic data so UI/portfolio logic can be tested before historical API ingestion is connected.</p>
    </div>
  `;
}

function renderEmptyResults() {
  return `
    <div class="empty-results">
      <div class="empty-orbit">↗</div>
      <h3>Build a hypothesis, then run it.</h3>
      <p>The results pane will show empirical win rate, breakeven rate, edge, equity curve, drawdown, trade ledger and binary-option diagnostics.</p>
      <div class="empty-stat"><span>Example question</span><strong>“If 15m YES touches 45¢, how often does it settle YES?”</strong></div>
    </div>
  `;
}

function renderResults() {
  const m = state.result.metrics;
  const lastRow = state.demoData[state.demoData.length - 1];
  const digital = lastRow ? digitalProbability({
    spot: lastRow.btcPrice,
    strike: lastRow.strike,
    timeYears: Math.max(lastRow.secondsRemaining, 1) / (365.25 * 24 * 3600),
    volatility: Math.max(lastRow.realizedVolPct, 1) / 100,
  }) : 0;
  return `
    <div class="results">
      <div class="results-head"><div><span class="eyebrow">BACKTEST RESULT</span><h2>${m.trades.toLocaleString()} trades</h2></div><button class="small-btn" id="rerun">Run again</button></div>
      <div class="metric-grid">
        ${metric('Win rate', fmtPct(m.winRate), `Breakeven ${fmtPct(m.breakevenWinRate)}`)}
        ${metric('Observed edge', `${(m.empiricalEdge * 100).toFixed(2)} pts`, 'Win rate − avg all-in price')}
        ${metric('Ending capital', fmtMoney(m.endingCapital), `${fmtPct(m.totalReturn)} total`)}
        ${metric('Max drawdown', fmtPct(m.maxDrawdown), 'Peak-to-trough')}
        ${metric('CAGR', fmtPct(m.cagr), `${state.years}y window`)}
        ${metric('Pseudo Sharpe', m.pseudoSharpe.toFixed(2), 'Trade-return diagnostic')}
      </div>
      <section class="chart-card">
        <div class="card-head"><div><strong>Portfolio equity</strong><span>Compounded, trade-by-trade settlement</span></div><span>${fmtMoney(m.endingCapital)}</span></div>
        <canvas id="equity-chart" height="260"></canvas>
      </section>
      <section class="diagnostic-card">
        <div class="card-head"><div><strong>Binary / digital-option diagnostic</strong><span>Risk-neutral lognormal reference, not a claim of true probability</span></div></div>
        <div class="diag-grid">
          <div><span>Latest demo BTC</span><strong>${fmtMoney(lastRow?.btcPrice || 0)}</strong></div>
          <div><span>Reference strike</span><strong>${fmtMoney(lastRow?.strike || 0)}</strong></div>
          <div><span>Realized vol input</span><strong>${(lastRow?.realizedVolPct || 0).toFixed(1)}%</strong></div>
          <div><span>Digital N(d₂)</span><strong>${fmtPct(digital)}</strong></div>
        </div>
      </section>
      ${renderTradeTable()}
    </div>
  `;
}

function metric(label, value, sub) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
}

function renderTradeTable() {
  const trades = state.result.trades.slice(-12).reverse();
  return `
    <section class="table-card">
      <div class="card-head"><div><strong>Recent simulated trades</strong><span>Last 12 entries</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Side</th><th>Entry</th><th>Size</th><th>Result</th><th>P&L</th></tr></thead><tbody>
        ${trades.length ? trades.map((t) => `<tr><td>${new Date(t.timestamp).toLocaleDateString()}</td><td>${t.side}</td><td>${(t.entryPrice * 100).toFixed(1)}¢</td><td>${fmtMoney(t.allocation)}</td><td><span class="result-pill ${t.won ? 'win' : 'loss'}">${t.won ? 'WIN' : 'LOSS'}</span></td><td class="${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl >= 0 ? '+' : ''}${fmtMoney(t.pnl)}</td></tr>`).join('') : '<tr><td colspan="6">No trades matched the current rule.</td></tr>'}
      </tbody></table></div>
    </section>
  `;
}

function renderCompare() {
  const rows = generateDemoDataset(1, 77).slice(-24).reverse();
  return `
    <section class="page-section">
      <div class="hero-card compact">
        <div><span class="eyebrow">ADAPTER-READY</span><h2>Kalshi ↔ Polymarket discrepancy monitor</h2><p>Match economically equivalent BTC contracts, normalize side/settlement rules, then rank discrepancies. Demo values below are synthetic until API ingestion is connected.</p></div>
      </div>
      <div class="compare-grid">
        <div class="metric"><span>Largest demo spread</span><strong>${Math.max(...rows.map((r) => Math.abs(r.kalshiYes - r.polyYes) * 100)).toFixed(1)}¢</strong><small>absolute YES difference</small></div>
        <div class="metric"><span>Matching requirement</span><strong>Strict</strong><small>expiry + strike + resolution source</small></div>
        <div class="metric"><span>Execution mode</span><strong>Research only</strong><small>no live orders</small></div>
      </div>
      <section class="table-card"><div class="card-head"><div><strong>Recent matched-market demo</strong><span>Shows the UI contract for later real adapters</span></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>BTC</th><th>Kalshi YES</th><th>Poly YES</th><th>Spread</th><th>Flag</th></tr></thead><tbody>
        ${rows.map((r) => { const spread = r.kalshiYes - r.polyYes; return `<tr><td>${new Date(r.timestamp).toLocaleString()}</td><td>${fmtMoney(r.btcPrice)}</td><td>${(r.kalshiYes * 100).toFixed(1)}¢</td><td>${(r.polyYes * 100).toFixed(1)}¢</td><td class="${Math.abs(spread) >= .05 ? 'positive' : ''}">${(spread * 100).toFixed(1)}¢</td><td>${Math.abs(spread) >= .05 ? '<span class="result-pill win">REVIEW</span>' : '—'}</td></tr>`; }).join('')}
      </tbody></table></div></section>
    </section>
  `;
}

function renderDataSources() {
  return `
    <section class="page-section">
      <div class="hero-card compact"><div><span class="eyebrow">DATA LAYER</span><h2>Keep data ingestion separate from strategy logic.</h2><p>The engine consumes normalized snapshots. Each external API will map its native schema into the same internal contract/trade/candle structures.</p></div></div>
      <div class="source-grid">
        ${sourceCard('Kalshi', 'Prediction markets', 'REST + WebSocket + FIX', 'Primary source for market metadata, order books, trades and live updates.', 'official')}
        ${sourceCard('Polymarket', 'Prediction markets', 'Gamma/CLOB + real-time data', 'Market discovery, prices/order books, analytics, activity and settlement data.', 'official')}
        ${sourceCard('Binance', 'BTC reference', 'REST + WebSocket', 'Agg trades, depth, klines and high-frequency price reference.', 'official')}
        ${sourceCard('Coinbase', 'BTC cross-check', 'Advanced Trade market data', 'Useful independent U.S. venue reference and robustness check.', 'official')}
        ${sourceCard('Chainlink', 'Resolution/oracle', 'TWAP / data feeds', 'Important where prediction contracts settle to Chainlink reference data.', 'planned')}
        ${sourceCard('CSV / Parquet', 'Historical import', 'Local files', 'Preferred path for large multi-year tick/order-book datasets to avoid API-history limits.', 'ready')}
      </div>
      <div class="principle-card"><strong>Historical-data warning</strong><p>“Free API” does not necessarily mean years of full depth/trade history are freely queryable. The app will support bulk historical files and cached normalized datasets so backtests are reproducible.</p></div>
    </section>
  `;
}

function sourceCard(name, kind, interfaceType, description, status) {
  return `<article class="source-card"><div class="source-head"><div><span>${kind}</span><h3>${name}</h3></div><span class="status ${status}">${status === 'official' ? 'Official API' : status === 'ready' ? 'Ready' : 'Planned'}</span></div><strong>${interfaceType}</strong><p>${description}</p></article>`;
}

function renderAbout() {
  return `
    <section class="page-section">
      <div class="hero-card"><div><span class="eyebrow">ANTI-OVERFIT RULES</span><h2>A backtest is only useful if the simulated trader could have known every input at that moment.</h2><p>The project is structured around causal timestamps, executable prices, explicit costs, rolling calibration and a full trade ledger.</p></div></div>
      <div class="method-grid">
        ${method('1', 'No future leakage', 'Indicators, prediction-market states and Kelly estimates must only use data timestamped before entry.')}
        ${method('2', 'Executable entry price', 'Signals are not fills. Backtests should use ask-side or reconstructed book execution plus slippage and venue fees.')}
        ${method('3', 'Hold-to-expiry by default', 'Binary contracts settle at $1/$0. This minimizes discretionary exit assumptions and extra fee modeling.')}
        ${method('4', 'Calibration before leverage', 'A model saying 70% should actually win roughly 70% in that bucket before Kelly sizing deserves trust.')}
        ${method('5', 'Walk-forward validation', 'Parameters should be developed on training periods and evaluated on untouched forward periods.')}
        ${method('6', 'Regime awareness', 'Settlement-rule changes, fee changes, API schema changes and liquidity regimes require separate analysis.')}
      </div>
    </section>
  `;
}

function method(n, title, text) {
  return `<article class="method-card"><span>${n}</span><div><h3>${title}</h3><p>${text}</p></div></article>`;
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  document.querySelectorAll('[data-branch]').forEach((button) => button.addEventListener('click', () => setBranch(button.dataset.branch)));
  document.querySelector('#change-branch')?.addEventListener('click', () => { state.branch = null; state.factors = []; state.result = null; render(); });
  document.querySelectorAll('[data-join]').forEach((button) => button.addEventListener('click', () => { state.joinMode = button.dataset.join; render(); }));
  document.querySelector('#add-factor')?.addEventListener('click', () => {
    state.factors.push(createFactor(branchCatalog[state.branch].factors[0].id));
    render();
  });
  document.querySelectorAll('.remove-factor').forEach((button) => button.addEventListener('click', () => {
    state.factors = state.factors.filter((factor) => factor.instanceId !== button.dataset.factorId);
    state.result = null;
    render();
  }));
  document.querySelectorAll('.factor-type').forEach((select) => select.addEventListener('change', () => {
    const factor = state.factors.find((item) => item.instanceId === select.dataset.factorId);
    const replacement = createFactor(select.value);
    factor.type = replacement.type;
    factor.values = replacement.values;
    state.result = null;
    render();
  }));
  document.querySelectorAll('.factor-value').forEach((input) => input.addEventListener('change', () => {
    const factor = state.factors.find((item) => item.instanceId === input.dataset.factorId);
    factor.values[input.dataset.key] = input.type === 'number' ? Number(input.value) : input.value;
    state.result = null;
  }));
  document.querySelectorAll('.risk-value').forEach((input) => input.addEventListener('change', () => {
    state.risk[input.dataset.key] = input.type === 'number' ? Number(input.value) : input.value;
    state.result = null;
    if (input.dataset.key === 'sizingMode') render();
  }));
  document.querySelector('#years')?.addEventListener('change', (event) => { state.years = Number(event.target.value); state.result = null; });
  document.querySelector('#seed')?.addEventListener('change', (event) => { state.seed = Number(event.target.value); state.result = null; });
  document.querySelector('#execute')?.addEventListener('click', run);
  document.querySelector('#rerun')?.addEventListener('click', run);
}

function drawEquityChart() {
  const canvas = document.querySelector('#equity-chart');
  if (!canvas || !state.result) return;
  const points = state.result.equity;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(600, rect.width * ratio);
  canvas.height = 260 * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { l: 14, r: 14, t: 18, b: 20 };
  const values = points.map((p) => p.equity);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min *= 0.99; max *= 1.01; }
  const x = (i) => pad.l + (i / Math.max(1, points.length - 1)) * (width - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(148, 163, 184, .16)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const gy = pad.t + (i / 4) * (height - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(width - pad.r, gy); ctx.stroke();
  }

  const gradient = ctx.createLinearGradient(0, pad.t, 0, height);
  gradient.addColorStop(0, 'rgba(72, 222, 161, .28)');
  gradient.addColorStop(1, 'rgba(72, 222, 161, 0)');
  ctx.beginPath();
  points.forEach((p, i) => { const px = x(i); const py = y(p.equity); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.lineTo(x(points.length - 1), height - pad.b); ctx.lineTo(x(0), height - pad.b); ctx.closePath();
  ctx.fillStyle = gradient; ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => { const px = x(i); const py = y(p.equity); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.strokeStyle = '#48dea1';
  ctx.lineWidth = 2;
  ctx.stroke();
}

render();
