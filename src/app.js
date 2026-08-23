import {
  factorCatalog,
  branchCatalog,
  defaultExecutionSettings,
  defaultRiskSettings,
  defaultDataSettings,
  advancedMetricHelp,
  getFactorTemplate,
} from './catalog.js';
import { generateDemoDataset } from './mockData.js';
import { runBacktest, runParameterSweep, equityDifference } from './backtest.js';
import { testConnections, referenceSourceNotes, ENDPOINTS } from './dataAdapters.js';

const app = document.querySelector('#app');
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const fmtPct = (value, digits = 1) => `${(Number(value || 0) * 100).toFixed(digits)}%`;
const fmtPts = (value, digits = 2) => `${(Number(value || 0) * 100).toFixed(digits)} pts`;
const fmtMoney = (value, digits = 0) => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
const fmtNum = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits });

const state = {
  tab: 'test',
  startBranch: null,
  factors: [],
  joinMode: 'AND',
  execution: { ...defaultExecutionSettings },
  risk: { ...defaultRiskSettings },
  dataSettings: { ...defaultDataSettings },
  seed: 42,
  data: generateDemoDataset(3, 42),
  results: null,
  viewFill: 'ask',
  showFillDetails: false,
  showAdvanced: false,
  sweep: {
    factorId: null,
    fieldKey: null,
    start: 0.30,
    end: 0.70,
    step: 0.05,
    windowYears: 3,
    venue: 'Kalshi',
    result: null,
  },
  discrepancy: { threshold: 0.05, horizon: '15m', result: null },
  connections: null,
  connectionBusy: false,
};

function factorOptionGroups(selected) {
  const groups = [...new Set(factorCatalog.map((factor) => factor.group))];
  return groups.map((group) => `<optgroup label="${group}">${factorCatalog.filter((factor) => factor.group === group).map((factor) => `<option value="${factor.id}" ${factor.id === selected ? 'selected' : ''}>${factor.label}</option>`).join('')}</optgroup>`).join('');
}

function createFactor(typeId) {
  const template = getFactorTemplate(typeId);
  return {
    instanceId: uid(),
    type: template.id,
    values: Object.fromEntries(template.fields.map((field) => [field.key, field.default ?? ''])),
  };
}

function setStartBranch(branchId) {
  state.startBranch = branchId;
  state.factors = [createFactor(branchCatalog[branchId].defaultFactor)];
  state.results = null;
  state.sweep.result = null;
  state.sweep.factorId = state.factors[0].instanceId;
  render();
}

function latestTimestamp(rows) {
  return rows.length ? new Date(rows[rows.length - 1].timestamp).getTime() : Date.now();
}

function rowsForYears(years) {
  const cutoff = latestTimestamp(state.data) - Number(years) * 365.25 * 86400000;
  return state.data.filter((row) => new Date(row.timestamp).getTime() >= cutoff);
}

function cloneExecutionForVenue(venue) {
  return { ...state.execution, tradeVenue: venue };
}

function executeAll() {
  if (!state.factors.length) return;
  state.results = {};
  [1, 2, 3].forEach((years) => {
    const rows = rowsForYears(years);
    state.results[years] = {};
    ['Kalshi', 'Polymarket'].forEach((venue) => {
      state.results[years][venue] = {};
      ['ask', 'last', 'midpoint'].forEach((fillMode) => {
        state.results[years][venue][fillMode] = runBacktest({
          rows,
          factors: state.factors,
          joinMode: state.joinMode,
          risk: state.risk,
          execution: cloneExecutionForVenue(venue),
          dataSettings: state.dataSettings,
          fillMode,
        });
      });
    });
    state.results[years].difference = {};
    ['ask', 'last', 'midpoint'].forEach((fillMode) => {
      state.results[years].difference[fillMode] = equityDifference(
        state.results[years].Kalshi[fillMode].equity,
        state.results[years].Polymarket[fillMode].equity,
        Number(state.risk.startingCapital),
      );
    });
  });
  state.sweep.result = null;
  render();
  requestAnimationFrame(drawAllCharts);
}

function fillSensitivity() {
  if (!state.results) return { large: false, maxReturnDiff: 0, maxWinDiff: 0, details: [] };
  const details = [];
  let maxReturnDiff = 0;
  let maxWinDiff = 0;
  [1, 2, 3].forEach((years) => ['Kalshi', 'Polymarket'].forEach((venue) => {
    const ask = state.results[years][venue].ask.metrics;
    ['last', 'midpoint'].forEach((variant) => {
      const other = state.results[years][venue][variant].metrics;
      const returnDiff = Math.abs(other.totalReturn - ask.totalReturn);
      const winDiff = Math.abs(other.settlementWinRate - ask.settlementWinRate);
      maxReturnDiff = Math.max(maxReturnDiff, returnDiff);
      maxWinDiff = Math.max(maxWinDiff, winDiff);
      details.push({ years, venue, variant, returnDiff, winDiff, ask, other });
    });
  }));
  const large = maxReturnDiff * 100 >= Number(state.dataSettings.largeReturnSensitivityPct) || maxWinDiff * 100 >= Number(state.dataSettings.largeFillSensitivityPts);
  return { large, maxReturnDiff, maxWinDiff, details };
}

function researchSuggestion() {
  if (!state.results) return null;
  const k3 = state.results[3].Kalshi.ask.metrics;
  const p3 = state.results[3].Polymarket.ask.metrics;
  const k1 = state.results[1].Kalshi.ask.metrics;
  const p1 = state.results[1].Polymarket.ask.metrics;
  const sensitivity = fillSensitivity();
  const messages = [];
  let tone = 'neutral';
  if (Math.min(k3.trades, p3.trades) < 100) {
    messages.push('Sample size is still thin on at least one venue. Treat any apparent edge as exploratory and broaden the test before sizing conclusions.');
  }
  if (sensitivity.large) {
    tone = 'warn';
    messages.push('Results are execution-sensitive: ask vs last/midpoint materially changes the outcome. Raw trades/order books and exact timestamp alignment should be required before treating this as tradable.');
  }
  if (k3.empiricalEdge > 0 && p3.empiricalEdge > 0) {
    tone = sensitivity.large ? 'warn' : 'good';
    messages.push('The settlement-direction edge is positive on both venue simulations over three years. Next priority: walk-forward validation and exact venue-specific fee/fill reconstruction.');
  } else if (k3.empiricalEdge > 0 || p3.empiricalEdge > 0) {
    tone = 'warn';
    messages.push('The edge is venue-specific in this run. Investigate settlement reference, market microstructure, and contract mapping rather than assuming the signal generalizes.');
  } else {
    tone = 'bad';
    messages.push('The three-year ask-based test does not show a positive settlement-direction edge on both venues. This version of the idea should be rejected or materially changed rather than optimized for survival.');
  }
  if ((k1.empiricalEdge > 0) !== (k3.empiricalEdge > 0) || (p1.empiricalEdge > 0) !== (p3.empiricalEdge > 0)) {
    messages.push('The sign of the edge changes between the 1-year and 3-year windows, which suggests regime dependence or instability.');
  }
  return { tone, messages };
}

function render() {
  app.innerHTML = `
    <div class="shell">
      ${renderSidebar()}
      <main class="main">
        ${renderTopbar()}
        ${state.tab === 'test' ? renderTestIdeas() : ''}
        ${state.tab === 'compare' ? renderCompare() : ''}
        ${state.tab === 'settings' ? renderSettings() : ''}
        ${state.tab === 'data' ? renderDataSources() : ''}
        ${state.tab === 'about' ? renderMethodology() : ''}
      </main>
    </div>
  `;
  bindEvents();
  if (state.results && state.tab === 'test') requestAnimationFrame(drawAllCharts);
  if (state.tab === 'compare') requestAnimationFrame(drawDiscrepancyChart);
  if (state.sweep.result && state.tab === 'test') requestAnimationFrame(drawSweepChart);
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">₿</div><div><strong>BTC Lab</strong><span>Prediction Backtest</span></div></div>
      <nav>
        ${navButton('test', '◫', 'Test Ideas')}
        ${navButton('compare', '⇄', 'Discrepancy Analysis')}
        ${navButton('settings', '⚙', 'Settings')}
        ${navButton('data', '⌁', 'Data & APIs')}
        ${navButton('about', 'i', 'Methodology')}
      </nav>
      <div class="sidebar-note"><span class="status-dot ${state.dataSettings.mode === 'demo' ? '' : 'live'}"></span>${state.dataSettings.mode === 'demo' ? 'Demo-data mode' : 'Connected-data mode'}<small>No order placement code exists in this project.</small></div>
    </aside>
  `;
}

function navButton(id, icon, label) {
  return `<button class="nav-btn ${state.tab === id ? 'active' : ''}" data-tab="${id}"><span>${icon}</span>${label}</button>`;
}

function renderTopbar() {
  const titles = {
    test: ['RESEARCH WORKBENCH', 'Strategy Composer'],
    compare: ['CROSS-VENUE', 'Prediction Market Discrepancy'],
    settings: ['CONFIGURATION', 'Sources & Defaults'],
    data: ['INGESTION', 'Data & API Adapters'],
    about: ['VALIDATION', 'Backtest Methodology'],
  };
  const [eyebrow, title] = titles[state.tab];
  return `<header class="topbar"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div><div class="top-actions"><span class="pill">Research only</span><span class="pill subtle">v0.2</span></div></header>`;
}

function renderTestIdeas() {
  if (!state.startBranch) return renderBranchChooser();
  return `
    <section class="workspace full-width">
      <div class="composer-layout">
        <div class="builder-column">
          ${renderSignalBuilder()}
          ${renderExecutionPanel()}
          ${renderRiskPanel()}
          ${renderRunPanel()}
          ${renderSweepPanel()}
        </div>
        <div class="results-column">
          ${state.results ? renderResults() : renderEmptyResults()}
        </div>
      </div>
    </section>
  `;
}

function renderBranchChooser() {
  return `
    <section class="branch-page">
      <div class="branch-intro"><span class="eyebrow">START SIMPLE, THEN COMBINE</span><h2>What starts the hypothesis?</h2><p>This first choice only selects the first factor. Once inside, BTC, prediction-market and settlement-reference factors can all be combined in the same strategy.</p></div>
      <div class="branch-grid">
        ${branchCard('prediction', 'Prediction markets', 'Start from Kalshi/Polymarket price, shocks, order flow, time-to-expiry or contract geometry.', ['15m YES ≤ 45¢', 'Kalshi jumps 8¢ / 5s', 'Kalshi − Poly ≥ 5¢'])}
        ${branchCard('btc', 'BTC technicals', 'Start from VWAP, EMA, prior-day/week levels, momentum, volatility or round-number structure.', ['VWAP bullish → 15m UP', 'EMA 9/21 cross', 'Near yesterday low'])}
      </div>
      <div class="principle-card"><strong>Important</strong><p>Trade target and exit logic are separate from signal factors. A BTC setup can buy a Kalshi/Polymarket contract, and a prediction-market shock can be filtered by BTC/reference behavior.</p></div>
    </section>
  `;
}

function branchCard(id, title, text, examples) {
  return `<button class="branch-card" data-branch="${id}"><div class="branch-icon">${id === 'prediction' ? '◈' : '⌁'}</div><h3>${title}</h3><p>${text}</p><div class="example-list">${examples.map((x) => `<span>${x}</span>`).join('')}</div><div class="branch-cta">Build strategy →</div></button>`;
}

function renderSignalBuilder() {
  return `
    <section class="section-card">
      <div class="section-heading">
        <div><button class="text-btn" id="change-branch">← Reset starting branch</button><h2>Signal factors</h2><p>Every factor is evaluated using information available at that timestamp only.</p></div>
        <div class="segmented"><button data-join="AND" class="${state.joinMode === 'AND' ? 'active' : ''}">ALL / AND</button><button data-join="OR" class="${state.joinMode === 'OR' ? 'active' : ''}">ANY / OR</button></div>
      </div>
      <div class="factor-stack">${state.factors.map((factor, index) => renderFactor(factor, index)).join('')}</div>
      <div class="add-row"><select id="add-factor-select">${factorOptionGroups('pm_price')}</select><button class="add-factor" id="add-factor">＋ Add factor</button></div>
      <div class="micro-note">You can mix groups. Example: <strong>Kalshi shock ≥ 8¢</strong> AND <strong>BTC move ≤ $20</strong> AND <strong>VWAP bullish</strong>.</div>
    </section>
  `;
}

function renderFactor(factor, index) {
  const template = getFactorTemplate(factor.type);
  return `
    <article class="factor-card" data-factor-id="${factor.instanceId}">
      <div class="factor-head">
        <div class="factor-number">${index + 1}</div>
        <div class="factor-title"><select class="factor-type" data-factor-id="${factor.instanceId}">${factorOptionGroups(factor.type)}</select><p><span class="group-tag">${template.group}</span> ${template.description}</p></div>
        ${state.factors.length > 1 ? `<button class="icon-btn remove-factor" data-factor-id="${factor.instanceId}" title="Remove">×</button>` : ''}
      </div>
      <div class="field-grid">${template.fields.map((field) => renderField(field, factor)).join('')}</div>
    </article>
  `;
}

function renderField(field, factor) {
  const value = factor.values[field.key] ?? field.default ?? '';
  if (field.type === 'select') return `<label><span>${field.label}</span><select class="factor-value" data-factor-id="${factor.instanceId}" data-key="${field.key}">${field.options.map((option) => `<option value="${option}" ${String(option) === String(value) ? 'selected' : ''}>${option}</option>`).join('')}</select></label>`;
  return `<label><span>${field.label}</span><input class="factor-value" data-factor-id="${factor.instanceId}" data-key="${field.key}" type="number" value="${value}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 'any'}" /></label>`;
}

function executionSelect(key, label, options) {
  return `<label><span>${label}</span><select class="execution-value" data-key="${key}">${options.map((option) => `<option value="${option.value ?? option}" ${String(option.value ?? option) === String(state.execution[key]) ? 'selected' : ''}>${option.label ?? option}</option>`).join('')}</select></label>`;
}

function executionInput(key, label, min, max, step) {
  return `<label><span>${label}</span><input class="execution-value" data-key="${key}" type="number" value="${state.execution[key]}" min="${min}" max="${max}" step="${step}" /></label>`;
}

function renderExecutionPanel() {
  return `
    <details class="panel" open>
      <summary><div><strong>Trade target, entry & exit</strong><span>What gets bought and how the position is managed</span></div><span>⌄</span></summary>
      <div class="panel-body">
        <div class="subhead">Trade target</div>
        <div class="settings-grid three">
          ${executionSelect('tradeVenue', 'Primary venue', ['Kalshi', 'Polymarket'])}
          ${executionSelect('tradeSide', 'Buy side', ['YES', 'NO'])}
          ${executionSelect('marketHorizon', 'Contract horizon', ['5m', '15m', '1h'])}
        </div>
        <div class="subhead">Entry observation</div>
        <div class="settings-grid three">
          ${executionSelect('entryObservation', 'Primary assumption', [
            { value: 'ask', label: 'Ask / executable buy (default)' },
            { value: 'last', label: 'Last trade' },
            { value: 'midpoint', label: 'Bid/ask midpoint' },
          ])}
          ${executionSelect('reentryMode', 'Entries per contract', [
            { value: 'once', label: 'First qualifying entry only' },
            { value: 'limited', label: 'Limited multiple entries' },
            { value: 'repeat', label: 'Repeat while signal qualifies' },
          ])}
          ${state.execution.reentryMode === 'limited' ? executionInput('maxEntriesPerContract', 'Max entries / contract', 1, 20, 1) : executionInput('entryCooldownSeconds', 'Re-entry cooldown (sec)', 0, 3600, 1)}
        </div>
        <div class="subhead">Exit</div>
        <div class="settings-grid three">
          ${executionSelect('exitMode', 'Exit mode', [
            { value: 'expiry', label: 'Hold to settlement' },
            { value: 'target', label: 'Exit at contract target' },
            { value: 'target_stop', label: 'Target + stop' },
            { value: 'time', label: 'Exit before expiry' },
          ])}
          ${['target', 'target_stop'].includes(state.execution.exitMode) ? executionInput('exitTarget', 'Take-profit contract price', 0.01, 0.99, 0.01) : ''}
          ${state.execution.exitMode === 'target_stop' ? executionInput('stopPrice', 'Stop contract price', 0.01, 0.99, 0.01) : ''}
          ${state.execution.exitMode === 'time' ? executionInput('exitSecondsRemaining', 'Exit with seconds left', 1, 3600, 1) : ''}
        </div>
      </div>
      <div class="panel-foot">Every simulation also runs ask, last-trade and midpoint variants automatically. Ask is the primary fair-fill default.</div>
    </details>
  `;
}

function riskInput(key, label, min, max, step) {
  return `<label><span>${label}</span><input class="risk-value" data-key="${key}" type="number" value="${state.risk[key]}" min="${min}" max="${max}" step="${step}" /></label>`;
}

function renderRiskPanel() {
  return `
    <details class="panel">
      <summary><div><strong>Portfolio & safety</strong><span>Customizable sizing, friction and exposure constraints</span></div><span>⌄</span></summary>
      <div class="panel-body settings-grid three">
        ${riskInput('startingCapital', 'Starting capital', 100, 100000000, 1000)}
        <label><span>Sizing mode</span><select class="risk-value" data-key="sizingMode"><option value="fixed_pct" ${state.risk.sizingMode === 'fixed_pct' ? 'selected' : ''}>Fixed % of equity</option><option value="kelly" ${state.risk.sizingMode === 'kelly' ? 'selected' : ''}>Fractional Kelly (expiry only)</option></select></label>
        ${state.risk.sizingMode === 'fixed_pct' ? riskInput('fixedTradePct', 'Trade size (%)', 0.01, 100, 0.25) : `${riskInput('kellyFraction', 'Kelly multiplier', 0, 1, 0.05)}${riskInput('kellyLookback', 'Kelly lookback trades', 5, 5000, 5)}${riskInput('kellyPriorWins', 'Bayesian pseudo-wins', 0, 1000, 1)}${riskInput('kellyPriorLosses', 'Bayesian pseudo-losses', 0, 1000, 1)}`}
        ${riskInput('maxTradePct', 'Max single position (%)', 0.1, 100, 0.5)}
        ${riskInput('maxExposurePct', 'Max concurrent exposure (%)', 0.1, 100, 1)}
        ${riskInput('minEdgePct', 'Min estimated edge (pts)', 0, 50, 0.1)}
        ${riskInput('slippageCents', 'Slippage (¢/share)', 0, 20, 0.1)}
        ${riskInput('entryFeeCents', 'Entry fee allowance (¢)', 0, 20, 0.1)}
        ${riskInput('exitFeeCents', 'Exit fee allowance (¢)', 0, 20, 0.1)}
      </div>
      <div class="panel-foot">These are research controls, not fixed recommendations. The point is to test whether the edge survives conservative assumptions.</div>
    </details>
  `;
}

function renderRunPanel() {
  return `
    <div class="run-panel">
      <div><strong>Run all history windows</strong><p>One click runs 1-year, 2-year and 3-year tests for Kalshi and Polymarket, with ask/last/midpoint variants.</p></div>
      <div class="run-controls"><label><span>Demo seed</span><input id="seed" type="number" value="${state.seed}" /></label><button class="execute-btn" id="execute">▶ Execute full backtest</button></div>
      <p class="warning-text">Demo mode uses synthetic data to validate mechanics. Do not interpret demo profitability as evidence of a real edge.</p>
    </div>
  `;
}

function numericSweepFields(factor) {
  return getFactorTemplate(factor.type).fields.filter((field) => field.type === 'number');
}

function renderSweepPanel() {
  const selectedFactor = state.factors.find((factor) => factor.instanceId === state.sweep.factorId) || state.factors[0];
  if (selectedFactor && !state.sweep.factorId) state.sweep.factorId = selectedFactor.instanceId;
  const fields = selectedFactor ? numericSweepFields(selectedFactor) : [];
  if (selectedFactor && (!state.sweep.fieldKey || !fields.some((f) => f.key === state.sweep.fieldKey))) state.sweep.fieldKey = fields[0]?.key || null;
  return `
    <details class="panel">
      <summary><div><strong>Parameter sweep</strong><span>Quickly test a range instead of cherry-picking one threshold</span></div><span>⌄</span></summary>
      <div class="panel-body">
        <div class="settings-grid three">
          <label><span>Factor</span><select id="sweep-factor">${state.factors.map((factor, index) => `<option value="${factor.instanceId}" ${factor.instanceId === selectedFactor?.instanceId ? 'selected' : ''}>${index + 1}. ${getFactorTemplate(factor.type).label}</option>`).join('')}</select></label>
          <label><span>Numeric field</span><select id="sweep-field">${fields.map((field) => `<option value="${field.key}" ${field.key === state.sweep.fieldKey ? 'selected' : ''}>${field.label}</option>`).join('')}</select></label>
          <label><span>Venue</span><select id="sweep-venue"><option ${state.sweep.venue === 'Kalshi' ? 'selected' : ''}>Kalshi</option><option ${state.sweep.venue === 'Polymarket' ? 'selected' : ''}>Polymarket</option></select></label>
          <label><span>Start</span><input id="sweep-start" type="number" step="any" value="${state.sweep.start}"></label>
          <label><span>End</span><input id="sweep-end" type="number" step="any" value="${state.sweep.end}"></label>
          <label><span>Step</span><input id="sweep-step" type="number" step="any" value="${state.sweep.step}"></label>
          <label><span>History</span><select id="sweep-years">${[1,2,3].map((year) => `<option value="${year}" ${Number(state.sweep.windowYears) === year ? 'selected' : ''}>${year} year${year > 1 ? 's' : ''}</option>`).join('')}</select></label>
        </div>
        <button class="secondary-btn" id="run-sweep" ${!fields.length ? 'disabled' : ''}>Run parameter sweep</button>
        ${state.sweep.result ? renderSweepResults() : '<p class="micro-note">For a 45¢ entry idea, sweep 0.30 → 0.70 in 0.01 or 0.05 steps and compare trade count, edge, return and drawdown.</p>'}
      </div>
    </details>
  `;
}

function renderSweepResults() {
  return `
    <div class="sweep-results">
      <canvas id="sweep-chart" height="180"></canvas>
      <div class="table-wrap"><table><thead><tr><th>Value</th><th>Trades</th><th>Settlement win</th><th>Edge</th><th>Total return</th><th>Max DD</th></tr></thead><tbody>${state.sweep.result.slice(0, 80).map((point) => `<tr><td>${fmtNum(point.value, 4)}</td><td>${point.trades}</td><td>${fmtPct(point.settlementWinRate)}</td><td>${fmtPts(point.empiricalEdge)}</td><td>${fmtPct(point.totalReturn)}</td><td>${fmtPct(point.maxDrawdown)}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `;
}

function renderEmptyResults() {
  return `<div class="empty-results"><div class="empty-orbit">↗</div><h3>Compose the idea, then test it.</h3><p>The result side will show separate Kalshi and Polymarket portfolio paths for 1, 2 and 3 years, plus the difference between them.</p><div class="empty-stat"><span>Example</span><strong>Kalshi +8¢/5s while BTC ≤ $20 move → buy 15m YES</strong></div><div class="empty-stat"><span>Execution example</span><strong>Enter ≤45¢ → exit ≥55¢ or hold to expiry</strong></div></div>`;
}

function resultFor(years, venue, fill = state.viewFill) {
  return state.results?.[years]?.[venue]?.[fill];
}

function renderResults() {
  const sensitivity = fillSensitivity();
  const suggestion = researchSuggestion();
  return `
    <div class="results">
      <div class="results-head"><div><span class="eyebrow">MULTI-WINDOW RESULT</span><h2>1y / 2y / 3y × both venues</h2></div><button class="small-btn" id="rerun">Run again</button></div>
      <div class="fill-banner ${sensitivity.large ? 'alert' : ''}">
        <div><strong>${sensitivity.large ? 'Execution assumption materially changes results' : 'Fill sensitivity check completed'}</strong><span>Ask is primary. Largest last/midpoint difference: ${fmtPct(sensitivity.maxReturnDiff)} return, ${fmtPts(sensitivity.maxWinDiff)} win-rate.</span></div>
        <button class="small-btn" id="toggle-fill-details">${state.showFillDetails ? 'Hide' : 'Show'} variants</button>
      </div>
      <div class="segmented fill-tabs"><button data-fill="ask" class="${state.viewFill === 'ask' ? 'active' : ''}">Ask</button><button data-fill="last" class="${state.viewFill === 'last' ? 'active' : ''}">Last trade</button><button data-fill="midpoint" class="${state.viewFill === 'midpoint' ? 'active' : ''}">Midpoint</button></div>
      ${state.showFillDetails ? renderFillDetails(sensitivity) : ''}
      ${renderSummaryMatrix()}
      ${suggestion ? `<section class="assistant-card ${suggestion.tone}"><div class="card-head"><div><strong>Research engine suggestion</strong><span>Rule-based robustness review, not a trading recommendation</span></div></div>${suggestion.messages.map((message) => `<p>${message}</p>`).join('')}</section>` : ''}
      ${[1,2,3].map((years) => renderYearCharts(years)).join('')}
      ${renderAdvancedPanel()}
      ${renderTradeLedger()}
    </div>
  `;
}

function renderFillDetails(sensitivity) {
  const noteworthy = [...sensitivity.details].sort((a, b) => Math.max(b.returnDiff, b.winDiff) - Math.max(a.returnDiff, a.winDiff)).slice(0, 8);
  return `<div class="fill-detail-grid">${noteworthy.map((item) => `<div><span>${item.years}y · ${item.venue} · ${item.variant}</span><strong>Δ return ${fmtPct(item.returnDiff)}</strong><small>Δ settlement win ${fmtPts(item.winDiff)}</small></div>`).join('')}</div>`;
}

function renderSummaryMatrix() {
  return `<section class="summary-card"><div class="card-head"><div><strong>Backtest meaning</strong><span>Settlement win rate is compared with the average all-in entry price. Positive “edge” means realized settlement frequency exceeded that price in this sample.</span></div></div><div class="table-wrap"><table><thead><tr><th>Window</th><th>Venue</th><th>Trades</th><th>Settlement win</th><th>Avg entry</th><th>Observed edge</th><th>Total return</th><th>Max DD</th></tr></thead><tbody>${[1,2,3].flatMap((years) => ['Kalshi','Polymarket'].map((venue) => {
    const m = resultFor(years, venue).metrics;
    return `<tr><td>${years}y</td><td>${venue}</td><td>${m.trades.toLocaleString()}</td><td>${fmtPct(m.settlementWinRate)}</td><td>${fmtPct(m.avgEntry)}</td><td class="${m.empiricalEdge >= 0 ? 'positive' : 'negative'}">${fmtPts(m.empiricalEdge)}</td><td class="${m.totalReturn >= 0 ? 'positive' : 'negative'}">${fmtPct(m.totalReturn)}</td><td>${fmtPct(m.maxDrawdown)}</td></tr>`;
  })).join('')}</tbody></table></div></section>`;
}

function renderYearCharts(years) {
  const k = resultFor(years, 'Kalshi').metrics;
  const p = resultFor(years, 'Polymarket').metrics;
  return `
    <section class="year-section">
      <div class="year-heading"><div><span class="eyebrow">${years} YEAR${years > 1 ? 'S' : ''}</span><h3>Portfolio paths</h3></div><div class="year-mini"><span>Kalshi ${fmtPct(k.totalReturn)}</span><span>Poly ${fmtPct(p.totalReturn)}</span></div></div>
      <div class="chart-grid three">
        ${chartCard(`chart-${years}-kalshi`, 'Kalshi', `${k.trades} trades · ${fmtPct(k.settlementWinRate)} settlement wins`)}
        ${chartCard(`chart-${years}-poly`, 'Polymarket', `${p.trades} trades · ${fmtPct(p.settlementWinRate)} settlement wins`)}
        ${chartCard(`chart-${years}-diff`, 'Kalshi − Polymarket', 'Difference between portfolio equity paths')}
      </div>
    </section>
  `;
}

function chartCard(id, title, subtitle) {
  return `<div class="chart-card compact"><div class="card-head"><div><strong>${title}</strong><span>${subtitle}</span></div></div><canvas id="${id}" height="210"></canvas></div>`;
}

function renderAdvancedPanel() {
  const m = resultFor(3, state.execution.tradeVenue)?.metrics || resultFor(3, 'Kalshi').metrics;
  return `
    <details class="advanced-card" ${state.showAdvanced ? 'open' : ''}>
      <summary><div><strong>Advanced diagnostics</strong><span>Click to see what each statistic says about this backtest</span></div><span>⌄</span></summary>
      <div class="advanced-grid">
        ${advancedTile('Brier score', fmtNum(m.brier, 4), advancedMetricHelp.brier)}
        ${advancedTile('Log loss', fmtNum(m.logLoss, 4), advancedMetricHelp.logLoss)}
        ${advancedTile('Calibration error', fmtPct(m.calibration), advancedMetricHelp.calibration)}
        ${advancedTile('95% win interval', `${fmtPct(m.confidenceLow)}–${fmtPct(m.confidenceHigh)}`, advancedMetricHelp.confidence)}
        ${advancedTile('Approx. p-value', fmtNum(m.pValueApprox, 4), advancedMetricHelp.significance)}
        ${advancedTile('Expectancy', fmtMoney(m.expectancy, 2), advancedMetricHelp.expectancy)}
        ${advancedTile('Profit factor', Number.isFinite(m.profitFactor) ? fmtNum(m.profitFactor, 2) : '∞', advancedMetricHelp.profitFactor)}
        ${advancedTile('Sortino-like', fmtNum(m.sortino, 2), advancedMetricHelp.sortino)}
        ${advancedTile('Calmar', fmtNum(m.calmar, 2), advancedMetricHelp.calmar)}
        ${advancedTile('Streaks', `${m.longestWinStreak}W / ${m.longestLossStreak}L`, advancedMetricHelp.streaks)}
        ${advancedTile('Trade VaR 5%', fmtPct(m.var95, 2), advancedMetricHelp.var)}
        ${advancedTile('Trade CVaR 5%', fmtPct(m.cvar95, 2), advancedMetricHelp.cvar)}
      </div>
      <p class="micro-note"><strong>Important:</strong> Brier/log-loss here score the entry market probability against eventual settlement. More sophisticated model-vs-market scoring will be added when real feature forecasts are ingested.</p>
    </details>
  `;
}

function advancedTile(label, value, help) {
  return `<div class="advanced-tile"><span>${label}</span><strong>${value}</strong><p>${help}</p></div>`;
}

function renderTradeLedger() {
  const primary = resultFor(3, state.execution.tradeVenue) || resultFor(3, 'Kalshi');
  const trades = primary.trades.slice(-30).reverse();
  return `<section class="summary-card"><div class="card-head"><div><strong>Recent simulated trades</strong><span>3-year ${state.execution.tradeVenue} path · ${state.viewFill}</span></div></div><div class="table-wrap"><table><thead><tr><th>Entry</th><th>Contract</th><th>Side</th><th>Price</th><th>Exit</th><th>P/L</th><th>Settlement</th></tr></thead><tbody>${trades.map((trade) => `<tr><td>${new Date(trade.timestamp).toLocaleString()}</td><td>${trade.contractId}</td><td>${trade.side}</td><td>${fmtPct(trade.entryPrice)}</td><td>${trade.exitReason} ${trade.exitReason !== 'expiry' ? fmtPct(trade.exitPrice) : ''}</td><td class="${trade.pnl >= 0 ? 'positive' : 'negative'}">${fmtMoney(trade.pnl, 2)}</td><td>${trade.settlementWon ? 'YES' : 'NO'}</td></tr>`).join('') || '<tr><td colspan="7">No trades matched.</td></tr>'}</tbody></table></div></section>`;
}

function renderCompare() {
  const rows = state.data.filter((row) => row.marketHorizon === state.discrepancy.horizon);
  const qualifying = rows.filter((row) => Math.abs(row.kalshiYesMid - row.polyYesMid) >= Number(state.discrepancy.threshold));
  const meanAbs = qualifying.length ? qualifying.reduce((s, row) => s + Math.abs(row.kalshiYesMid - row.polyYesMid), 0) / qualifying.length : 0;
  const kalshiHigher = qualifying.length ? qualifying.filter((row) => row.kalshiYesMid > row.polyYesMid).length / qualifying.length : 0;
  state.discrepancy.result = { qualifying, meanAbs, kalshiHigher };
  return `
    <section class="page-stack">
      <section class="section-card">
        <div class="section-heading"><div><h2>Equivalent-contract discrepancy</h2><p>Keep this analysis separate from the main strategy builder so matching quality, timing tolerance and settlement-source differences are explicit.</p></div></div>
        <div class="settings-grid three">
          <label><span>Absolute spread ≥</span><input id="disc-threshold" type="number" min="0" max="0.99" step="0.01" value="${state.discrepancy.threshold}"></label>
          <label><span>Horizon</span><select id="disc-horizon">${['5m','15m','1h'].map((h) => `<option ${state.discrepancy.horizon === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
          <label><span>Timestamp match</span><select><option>Exact normalized snapshot (demo)</option><option disabled>Configurable raw tolerance in real ingestion</option></select></label>
        </div>
      </section>
      <div class="metric-grid four">
        ${metric('Qualifying snapshots', qualifying.length.toLocaleString(), `of ${rows.length.toLocaleString()} ${state.discrepancy.horizon} snapshots`)}
        ${metric('Mean |spread|', fmtPts(meanAbs), 'Kalshi vs Polymarket')}
        ${metric('Kalshi higher', fmtPct(kalshiHigher), 'Among qualifying snapshots')}
        ${metric('Reference warning', 'Different sources', 'Kalshi CF BRTI vs Poly Chainlink')}
      </div>
      <section class="chart-card"><div class="card-head"><div><strong>Kalshi − Polymarket probability spread</strong><span>Demo normalized snapshots; real mode must match economically equivalent contracts</span></div></div><canvas id="discrepancy-chart" height="260"></canvas></section>
      <section class="summary-card"><div class="card-head"><div><strong>Why this is its own tab</strong><span>A 5¢ gap is not automatically arbitrage.</span></div></div><p>Before treating a discrepancy as tradeable, match expiration, threshold, wording, settlement reference, fees, position limits and timestamp. A difference caused by CF Benchmarks vs Chainlink can be economically justified rather than mispricing.</p></section>
    </section>
  `;
}

function settingSelect(key, label, options) {
  return `<label><span>${label}</span><select class="data-setting" data-key="${key}">${options.map((option) => `<option ${String(state.dataSettings[key]) === String(option) ? 'selected' : ''}>${option}</option>`).join('')}</select></label>`;
}

function renderSettings() {
  return `
    <section class="page-stack">
      <section class="section-card">
        <div class="section-heading"><div><h2>Data-source defaults</h2><p>Choose the BTC information source separately from the prediction venue and settlement reference.</p></div></div>
        <div class="settings-grid three">
          ${settingSelect('btcSource', 'BTC source', ['Composite (Binance + Coinbase)', 'Binance', 'Coinbase'])}
          ${settingSelect('predictionSource', 'Prediction source', ['Both', 'Kalshi', 'Polymarket'])}
          ${settingSelect('timestampResolution', 'Research resolution', ['Raw timestamps', '100 ms buckets', '1 second buckets', '1 minute buckets'])}
          ${settingSelect('referenceMode', 'Settlement reference', ['Venue rule', 'BTC spot only (diagnostic)', 'Reference only when available'])}
          <label><span>Fill alert: win-rate pts</span><input class="data-setting" data-key="largeFillSensitivityPts" type="number" value="${state.dataSettings.largeFillSensitivityPts}" step="0.5"></label>
          <label><span>Fill alert: return %</span><input class="data-setting" data-key="largeReturnSensitivityPct" type="number" value="${state.dataSettings.largeReturnSensitivityPct}" step="1"></label>
        </div>
      </section>
      <div class="reference-grid">
        ${referenceCard('Kalshi')}
        ${referenceCard('Polymarket')}
      </div>
      <section class="summary-card"><div class="card-head"><div><strong>Raw timestamps vs 1-second data</strong><span>Why “smallest possible” matters</span></div></div><p><strong>Raw timestamps</strong> means keeping each exchange/prediction event at the timestamp supplied by the venue (often millisecond or finer precision) before aggregating. This is best for lead/lag research because a 300 ms lead disappears if both events are rounded into the same second. We can always aggregate raw data into 100 ms, 1 s or 1 m later; we cannot recover ordering after it was discarded.</p></section>
    </section>
  `;
}

function referenceCard(venue) {
  const info = referenceSourceNotes[venue];
  return `<section class="reference-card"><div class="eyebrow">${venue.toUpperCase()} SETTLEMENT REFERENCE</div><h3>${info.name}</h3><p>${info.model}</p><div class="reference-status ${info.directFreeTickAdapter ? 'good' : 'warn'}">${info.directFreeTickAdapter ? 'Direct tick adapter connected' : 'Exact historical tick source still required'}</div><small>${info.note}</small></section>`;
}

function renderDataSources() {
  return `
    <section class="page-stack">
      <section class="section-card">
        <div class="section-heading"><div><h2>Public API adapters</h2><p>The repository now contains read-only adapters. Browser CORS, venue limits, pagination and historical cutoffs still apply.</p></div><button class="secondary-btn" id="test-connections" ${state.connectionBusy ? 'disabled' : ''}>${state.connectionBusy ? 'Testing…' : 'Test API connections'}</button></div>
        ${state.connections ? `<div class="connection-grid">${state.connections.map((item) => `<div class="connection ${item.ok ? 'ok' : 'bad'}"><span>${item.name}</span><strong>${item.ok ? 'Connected' : 'Failed'}</strong><small>${item.ok ? `${item.latencyMs} ms` : item.error}</small></div>`).join('')}</div>` : '<p class="micro-note">Connection tests run GET requests only. No trading credentials or order methods are used.</p>'}
      </section>
      <div class="api-grid">
        ${apiCard('Kalshi', ENDPOINTS.kalshi, ['markets', 'trades', 'order book', '1m/1h/1d candlesticks', 'historical cutoff/candles'])}
        ${apiCard('Polymarket', ENDPOINTS.polymarketClob, ['Gamma market metadata', 'price history', 'order books', 'midpoint', 'Data API trades'])}
        ${apiCard('Binance BTCUSDT', ENDPOINTS.binance, ['aggTrades', 'klines', 'depth', 'ticker'])}
        ${apiCard('Coinbase BTC-USD', ENDPOINTS.coinbaseExchange, ['trades', 'candles', 'book', 'ticker'])}
      </div>
      <section class="summary-card"><div class="card-head"><div><strong>Three-year ingestion architecture</strong><span>Do not repeatedly download multi-year raw history in the browser</span></div></div><div class="pipeline"><span>API / archive</span><b>→</b><span>raw immutable files</span><b>→</b><span>normalized timestamps</span><b>→</b><span>feature store</span><b>→</b><span>backtest engine</span><b>→</b><span>UI</span></div><p>The current UI can operate on synthetic normalized rows. The adapters are the acquisition layer; production-scale raw tick history should be cached locally/server-side before running 1y/2y/3y sweeps.</p></section>
    </section>
  `;
}

function apiCard(title, base, capabilities) {
  return `<section class="api-card"><div class="eyebrow">READ-ONLY</div><h3>${title}</h3><code>${base}</code><div>${capabilities.map((item) => `<span>${item}</span>`).join('')}</div></section>`;
}

function renderMethodology() {
  return `
    <section class="page-stack methodology">
      <section class="section-card"><h2>Fair-test rules</h2><ol><li>No future feature data may enter a signal.</li><li>Ask is the default executable buy assumption; last and midpoint are sensitivity checks.</li><li>Exit prices use the sell side when ask-mode execution is selected.</li><li>Capital remains locked while a contract is open and concurrent exposure is capped.</li><li>Kelly learns only from previously resolved expiry trades and is not applied to arbitrary early-exit payoffs.</li><li>Kalshi and Polymarket are tested separately because settlement references and microstructure differ.</li><li>1y, 2y and 3y windows are always shown side-by-side to expose regime dependence.</li><li>Parameter sweeps are diagnostic; selecting the best historical point without out-of-sample validation is overfitting.</li></ol></section>
      <section class="summary-card"><h3>What “edge” means here</h3><p>For hold-to-expiry binary contracts, an entry price of 45¢ has a 45% frictionless breakeven settlement rate. If the strategy's historical settlement rate is 46.5%, the raw probability edge is +1.5 percentage points before any unmodeled costs. Early-exit strategies require payoff-distribution analysis rather than this simple binary edge alone.</p></section>
      <section class="summary-card"><h3>Lead/lag test B</h3><p>The intended high-frequency test is not merely “Kalshi went up.” It is: prediction-market repricing over X seconds, conditioned on BTC moving less than Y dollars (or less than a volatility-normalized threshold), followed by BTC returns over 100 ms / 1 s / 2 s / 5 s / 10 s / 30 s / 1 m / 5 m. Raw timestamps are preserved first so the direction of information flow can be tested rather than assumed.</p></section>
      <section class="summary-card"><h3>Reference prices</h3><p>Current Kalshi BTC 15-minute contracts use a CF Benchmarks BRTI final-minute average in their market rules, while current Polymarket BTC Up/Down pages point to Chainlink BTC/USD Data Streams. The app therefore keeps exchange spot, Kalshi reference and Polymarket reference as distinct fields.</p></section>
    </section>
  `;
}

function metric(label, value, sub) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
}

function drawLineChart(canvas, points, options = {}) {
  if (!canvas || !points?.length) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || Number(canvas.getAttribute('height')) || 220;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  const pad = 28;
  const values = points.map((point) => Number(point.equity ?? point.value ?? 0));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1;
  [0, .5, 1].forEach((f) => { const yy = pad + f * (height - pad * 2); ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(width - pad, yy); ctx.stroke(); });
  if (options.zeroLine && min < 0 && max > 0) { ctx.strokeStyle = 'rgba(255,255,255,.28)'; const yy = y(0); ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(width - pad, yy); ctx.stroke(); }
  ctx.strokeStyle = options.stroke || '#71e3ad';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, i) => { const xx = x(i); const yy = y(Number(point.equity ?? point.value ?? 0)); if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); });
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.font = '11px system-ui';
  ctx.fillText(fmtNum(max, options.money ? 0 : 2), 4, 14);
  ctx.fillText(fmtNum(min, options.money ? 0 : 2), 4, height - 5);
}

function downsample(points, maxPoints = 700) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

function drawAllCharts() {
  if (!state.results) return;
  [1,2,3].forEach((years) => {
    drawLineChart(document.querySelector(`#chart-${years}-kalshi`), downsample(resultFor(years, 'Kalshi').equity), { money: true, stroke: '#71e3ad' });
    drawLineChart(document.querySelector(`#chart-${years}-poly`), downsample(resultFor(years, 'Polymarket').equity), { money: true, stroke: '#7da8ff' });
    drawLineChart(document.querySelector(`#chart-${years}-diff`), downsample(state.results[years].difference[state.viewFill]), { money: true, zeroLine: true, stroke: '#f2bf6d' });
  });
  if (state.sweep.result) drawSweepChart();
}

function drawSweepChart() {
  const canvas = document.querySelector('#sweep-chart');
  if (!canvas || !state.sweep.result) return;
  drawLineChart(canvas, state.sweep.result.map((point) => ({ value: point.totalReturn * 100 })), { stroke: '#f2bf6d' });
}

function drawDiscrepancyChart() {
  const canvas = document.querySelector('#discrepancy-chart');
  const rows = state.discrepancy.result?.qualifying || [];
  drawLineChart(canvas, downsample(rows.map((row) => ({ value: (row.kalshiYesMid - row.polyYesMid) * 100 }))), { zeroLine: true, stroke: '#f2bf6d' });
}

async function handleConnectionTest() {
  state.connectionBusy = true;
  render();
  state.connections = await testConnections();
  state.connectionBusy = false;
  render();
}

function runSweep() {
  const selected = state.factors.find((factor) => factor.instanceId === state.sweep.factorId);
  if (!selected || !state.sweep.fieldKey) return;
  state.sweep.result = runParameterSweep({
    rows: rowsForYears(state.sweep.windowYears),
    factors: state.factors,
    joinMode: state.joinMode,
    risk: state.risk,
    execution: cloneExecutionForVenue(state.sweep.venue),
    dataSettings: state.dataSettings,
    factorInstanceId: state.sweep.factorId,
    fieldKey: state.sweep.fieldKey,
    start: state.sweep.start,
    end: state.sweep.end,
    step: state.sweep.step,
    fillMode: 'ask',
  });
  render();
  requestAnimationFrame(drawSweepChart);
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { state.tab = button.dataset.tab; render(); }));
  document.querySelectorAll('[data-branch]').forEach((button) => button.addEventListener('click', () => setStartBranch(button.dataset.branch)));
  document.querySelector('#change-branch')?.addEventListener('click', () => { state.startBranch = null; state.factors = []; state.results = null; render(); });
  document.querySelectorAll('[data-join]').forEach((button) => button.addEventListener('click', () => { state.joinMode = button.dataset.join; render(); }));
  document.querySelector('#add-factor')?.addEventListener('click', () => { const type = document.querySelector('#add-factor-select').value; const factor = createFactor(type); state.factors.push(factor); state.sweep.factorId ||= factor.instanceId; state.results = null; render(); });
  document.querySelectorAll('.remove-factor').forEach((button) => button.addEventListener('click', () => { state.factors = state.factors.filter((factor) => factor.instanceId !== button.dataset.factorId); state.results = null; render(); }));
  document.querySelectorAll('.factor-type').forEach((select) => select.addEventListener('change', () => { const factor = state.factors.find((item) => item.instanceId === select.dataset.factorId); const replacement = createFactor(select.value); factor.type = replacement.type; factor.values = replacement.values; state.results = null; render(); }));
  document.querySelectorAll('.factor-value').forEach((input) => input.addEventListener('change', () => { const factor = state.factors.find((item) => item.instanceId === input.dataset.factorId); factor.values[input.dataset.key] = input.type === 'number' ? Number(input.value) : input.value; state.results = null; }));
  document.querySelectorAll('.execution-value').forEach((input) => input.addEventListener('change', () => { state.execution[input.dataset.key] = input.type === 'number' ? Number(input.value) : input.value; state.results = null; render(); }));
  document.querySelectorAll('.risk-value').forEach((input) => input.addEventListener('change', () => { state.risk[input.dataset.key] = input.type === 'number' ? Number(input.value) : input.value; state.results = null; render(); }));
  document.querySelectorAll('.data-setting').forEach((input) => input.addEventListener('change', () => { state.dataSettings[input.dataset.key] = input.type === 'number' ? Number(input.value) : input.value; state.results = null; render(); }));
  document.querySelector('#seed')?.addEventListener('change', (event) => { state.seed = Number(event.target.value) || 42; state.data = generateDemoDataset(3, state.seed); state.results = null; });
  document.querySelector('#execute')?.addEventListener('click', executeAll);
  document.querySelector('#rerun')?.addEventListener('click', executeAll);
  document.querySelector('#toggle-fill-details')?.addEventListener('click', () => { state.showFillDetails = !state.showFillDetails; render(); });
  document.querySelectorAll('[data-fill]').forEach((button) => button.addEventListener('click', () => { state.viewFill = button.dataset.fill; render(); requestAnimationFrame(drawAllCharts); }));
  document.querySelector('#sweep-factor')?.addEventListener('change', (event) => { state.sweep.factorId = event.target.value; state.sweep.fieldKey = null; state.sweep.result = null; render(); });
  document.querySelector('#sweep-field')?.addEventListener('change', (event) => { state.sweep.fieldKey = event.target.value; state.sweep.result = null; });
  document.querySelector('#sweep-venue')?.addEventListener('change', (event) => { state.sweep.venue = event.target.value; state.sweep.result = null; });
  document.querySelector('#sweep-years')?.addEventListener('change', (event) => { state.sweep.windowYears = Number(event.target.value); state.sweep.result = null; });
  document.querySelector('#sweep-start')?.addEventListener('change', (event) => { state.sweep.start = Number(event.target.value); });
  document.querySelector('#sweep-end')?.addEventListener('change', (event) => { state.sweep.end = Number(event.target.value); });
  document.querySelector('#sweep-step')?.addEventListener('change', (event) => { state.sweep.step = Number(event.target.value); });
  document.querySelector('#run-sweep')?.addEventListener('click', runSweep);
  document.querySelector('#disc-threshold')?.addEventListener('change', (event) => { state.discrepancy.threshold = Number(event.target.value); render(); });
  document.querySelector('#disc-horizon')?.addEventListener('change', (event) => { state.discrepancy.horizon = event.target.value; render(); });
  document.querySelector('#test-connections')?.addEventListener('click', handleConnectionTest);
  document.querySelectorAll('.advanced-card').forEach((detail) => detail.addEventListener('toggle', () => { state.showAdvanced = detail.open; }));
}

render();
