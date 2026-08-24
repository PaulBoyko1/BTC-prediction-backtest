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
import { defaultFeeSettings, OFFICIAL_FEE_PRESETS, cloneFeeSettings, resetVenueFeePreset, sampleVenueFee, validateFeeProfile } from './fees.js';

const app = document.querySelector('#app');
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtMoney = (v, digits = 0) => Number(v || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
const fmtPct = (v, digits = 1) => `${(Number(v || 0) * 100).toFixed(digits)}%`;
const fmtPts = (v, digits = 2) => `${(Number(v || 0) * 100).toFixed(digits)} pts`;
const fmtNum = (v, digits = 2) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
const fmtDate = (value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

const state = {
  tab: 'test',
  lens: 'prediction',
  factors: [],
  joinMode: 'AND',
  execution: { ...defaultExecutionSettings, tradeSide: 'AUTO' },
  risk: { ...defaultRiskSettings, sizingMode: 'fixed_contracts' },
  dataSettings: { ...defaultDataSettings },
  fees: cloneFeeSettings(defaultFeeSettings),
  feeSample: { contracts: 100, price: 0.45 },
  feeError: null,
  seed: 42,
  data: [],
  results: null,
  viewYears: 3,
  viewVenue: 'Kalshi',
  viewFill: 'ask',
  overlayVenue: false,
  chartLines: { net: true, gross: true, other: false, drawdown: true },
  chartInfo: null,
  showFillDetails: false,
  showAdvanced: false,
  run: { active: false, progress: 0, stage: -1, reveal: 1, timers: [], raf: null },
  chartHoverIndex: null,
  sweep: { factorId: null, fieldKey: null, start: 0.30, end: 0.70, step: 0.02, years: 3, venue: 'Kalshi', fill: 'ask', metric: 'deployedRoi', result: null, error: null },
  discrepancy: { threshold: 0.05, horizon: '15m' },
};

function createFactor(id) {
  const t = getFactorTemplate(id);
  return { instanceId: uid(), type: t.id, values: Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? ''])) };
}

function sideDefiningPriceFactors() {
  return state.factors.filter((factor) => factor.type === 'pm_price');
}
function hasPriceSideRule() { return sideDefiningPriceFactors().length > 0; }
function setAutomaticExecutionSideForFactorChange({ addedPriceRule = false } = {}) {
  if (addedPriceRule) state.execution.tradeSide = 'AUTO';
  else if (state.execution.tradeSide === 'AUTO' && !hasPriceSideRule()) state.execution.tradeSide = 'YES';
}
function autoSideSummary() {
  const factor = sideDefiningPriceFactors()[0];
  if (!factor) return 'No contract-price rule · defaults to YES / UP';
  const op = factor.values.operator;
  const target = Number(factor.values.value);
  const tolerance = Number(factor.values.tolerance || 0);
  const rule = op === 'within' ? `near ${(target * 100).toFixed(0)}¢ ± ${(tolerance * 100).toFixed(1)}¢`
    : op === '<=' ? `at / below ${(target * 100).toFixed(0)}¢`
    : op === '>=' ? `at / above ${(target * 100).toFixed(0)}¢`
    : op === 'crosses_up' ? `crossing up through ${(target * 100).toFixed(0)}¢`
    : `crossing down through ${(target * 100).toFixed(0)}¢`;
  return `Price-driven · whichever side is ${rule}`;
}
function sweepFieldMeta(factor, key = state.sweep.fieldKey) {
  return factor ? getFactorTemplate(factor.type).fields.find((field) => field.key === key && field.type === 'number') || null : null;
}
function roundSweep(value, step) {
  const magnitude = Math.abs(Number(step)) || 1;
  const decimals = Math.min(8, Math.max(0, (String(magnitude).split('.')[1] || '').length));
  return Number((Math.round(value / magnitude) * magnitude).toFixed(decimals));
}
function setSweepDefaults(factor, field) {
  if (!factor || !field) return;
  const current = Number(factor.values[field.key]);
  const fieldStep = Math.abs(Number(field.step)) || 1;
  const min = Number.isFinite(Number(field.min)) ? Number(field.min) : -Infinity;
  let max = Number.isFinite(Number(field.max)) ? Number(field.max) : Infinity;
  // When AUTO is testing a cheap-side entry target at or below 50c, keep the
  // smart default sweep on the cheap half of the binary. Crossing above 50c is
  // a different economic hypothesis (buying the favorite), so make that manual.
  if (factor.type === 'pm_price' && field.key === 'value' && state.execution.tradeSide === 'AUTO' && current <= 0.50) max = Math.min(max, 0.50);
  const finiteSpan = Number.isFinite(min) && Number.isFinite(max) ? Math.max(fieldStep, max - min) : Math.max(fieldStep * 20, Math.abs(current || 1));
  const half = Math.max(fieldStep * 5, Math.min(finiteSpan * 0.20, Math.max(fieldStep * 5, Math.abs(current || fieldStep) * 0.5)));
  let start = Math.max(min, current - half);
  let end = Math.min(max, current + half);
  let step = Math.max(fieldStep, (end - start) / 20);
  step = Math.ceil(step / fieldStep) * fieldStep;
  start = roundSweep(start, fieldStep);
  end = roundSweep(end, fieldStep);
  if (start === end) end = Math.min(max, start + fieldStep * 5);
  state.sweep.start = start;
  state.sweep.end = end;
  state.sweep.step = Number(step.toPrecision(8));
  state.sweep.result = null;
  state.sweep.error = null;
}
function sweepMetricConfig() {
  const configs = {
    deployedRoi: { key: 'deployedRoi', label: 'ROI on gross deployed', format: (v) => fmtPct(v), direction: 1 },
    avgPnlPerContract: { key: 'avgPnlPerContract', label: 'P/L per contract', format: (v) => fmtMoney(v, 3), direction: 1 },
    avgPnl: { key: 'avgPnl', label: 'Expectancy per trade', format: (v) => fmtMoney(v, 2), direction: 1 },
    totalReturn: { key: 'totalReturn', label: 'Portfolio return', format: (v) => fmtPct(v), direction: 1 },
  };
  return configs[state.sweep.metric] || configs.deployedRoi;
}

function resetLens(lens = 'prediction') {
  state.lens = lens;
  state.factors = [createFactor(branchCatalog[lens].defaultFactor)];
  state.execution.tradeSide = state.factors[0].type === 'pm_price' ? 'AUTO' : 'YES';
  state.sweep.factorId = state.factors[0].instanceId;
  state.sweep.fieldKey = numericSweepFields(state.factors[0])[0]?.key || null;
  const field = sweepFieldMeta(state.factors[0]);
  if (field) setSweepDefaults(state.factors[0], field);
  invalidateResults();
}

function regenerateData() {
  state.data = generateDemoDataset(3, state.seed);
  invalidateResults();
}

function invalidateResults() {
  cancelRunAnimation();
  state.results = null;
  state.sweep.result = null;
  state.run.reveal = 1;
}

function latestTimestamp(rows) {
  return rows.length ? Date.parse(rows[rows.length - 1].timestamp) : Date.now();
}
function rowsForYears(years) {
  const cutoff = latestTimestamp(state.data) - Number(years) * 365.25 * 86400000;
  return state.data.filter((r) => Date.parse(r.timestamp) >= cutoff);
}
function cloneExecutionForVenue(venue) { return { ...state.execution, tradeVenue: venue }; }

function computeAllResults() {
  const out = {};
  for (const years of [1, 2, 3]) {
    const rows = rowsForYears(years);
    out[years] = {};
    for (const venue of ['Kalshi', 'Polymarket']) {
      out[years][venue] = {};
      for (const fillMode of ['ask', 'last', 'midpoint']) {
        const net = runBacktest({
          rows,
          factors: state.factors,
          joinMode: state.joinMode,
          risk: state.risk,
          execution: cloneExecutionForVenue(venue),
          dataSettings: state.dataSettings,
          feeSettings: state.fees,
          fillMode,
        });
        const gross = state.fees.enabled ? runBacktest({
          rows,
          factors: state.factors,
          joinMode: state.joinMode,
          risk: state.risk,
          execution: cloneExecutionForVenue(venue),
          dataSettings: state.dataSettings,
          feeSettings: { ...cloneFeeSettings(state.fees), enabled: false },
          fillMode,
        }) : net;
        out[years][venue][fillMode] = { net, gross };
      }
    }
    out[years].difference = {};
    for (const fillMode of ['ask', 'last', 'midpoint']) {
      out[years].difference[fillMode] = equityDifference(
        out[years].Kalshi[fillMode].net.equity,
        out[years].Polymarket[fillMode].net.equity,
        Number(state.risk.startingCapital),
      );
    }
  }
  state.results = out;
}

function resultFor(years = state.viewYears, venue = state.viewVenue, fill = state.viewFill) {
  return state.results?.[years]?.[venue]?.[fill]?.net || null;
}
function grossResultFor(years = state.viewYears, venue = state.viewVenue, fill = state.viewFill) {
  return state.results?.[years]?.[venue]?.[fill]?.gross || null;
}

function fillSensitivity(years = state.viewYears, venue = state.viewVenue) {
  if (!state.results) return { large: false, rows: [], maxReturn: 0, maxWin: 0 };
  const ask = resultFor(years, venue, 'ask')?.metrics;
  if (!ask) return { large: false, rows: [], maxReturn: 0, maxWin: 0 };
  const rows = ['last', 'midpoint'].map((fill) => {
    const m = resultFor(years, venue, fill).metrics;
    return { fill, returnDiff: Math.abs(m.totalReturn - ask.totalReturn), winDiff: Math.abs(m.settlementWinRate - ask.settlementWinRate), metrics: m };
  });
  const maxReturn = Math.max(...rows.map((x) => x.returnDiff), 0);
  const maxWin = Math.max(...rows.map((x) => x.winDiff), 0);
  const large = maxReturn * 100 >= Number(state.dataSettings.largeReturnSensitivityPct) || maxWin * 100 >= Number(state.dataSettings.largeFillSensitivityPts);
  return { large, rows, maxReturn, maxWin };
}

function cancelRunAnimation() {
  state.run.timers.forEach(clearTimeout);
  state.run.timers = [];
  if (state.run.raf) cancelAnimationFrame(state.run.raf);
  state.run.raf = null;
  state.run.active = false;
}

function validateFeeSettings() {
  for (const venue of ['Kalshi', 'Polymarket']) {
    const check = validateFeeProfile(state.fees.profiles[venue]);
    if (!check.valid) return { valid: false, error: `${venue}: ${check.error}` };
  }
  return { valid: true, error: null };
}

function feePresetStatus(venue) {
  const p = state.fees.profiles[venue];
  const official = OFFICIAL_FEE_PRESETS[venue];
  const same = ['takerRatePct','makerRatePct','takerMultiplier','makerMultiplier','formula','rounding','entryLiquidity','exitLiquidity','rebatePct']
    .every((key) => String(p?.[key]) === String(official?.[key]));
  return same ? 'OFFICIAL CURRENT PRESET' : 'CUSTOMIZED';
}

function executeAll() {
  if (!state.factors.length) return;
  const feeCheck = validateFeeSettings();
  if (!feeCheck.valid) { state.feeError = feeCheck.error; state.tab = 'fees'; render(); return; }
  state.feeError = null;
  cancelRunAnimation();
  computeAllResults();
  state.viewYears = 3;
  state.viewVenue = state.execution.tradeVenue;
  state.viewFill = 'ask';
  state.run.active = true;
  state.run.progress = 0;
  state.run.stage = 0;
  state.run.reveal = 0;
  render();

  const stageTimes = [0, 260, 520, 780, 1080, 1420];
  stageTimes.forEach((ms, idx) => {
    const id = setTimeout(() => {
      state.run.stage = Math.min(idx, 5);
      state.run.progress = Math.min(100, idx * 20);
      updateRunVisuals();
      if (idx === 5) state.run.active = false;
    }, ms);
    state.run.timers.push(id);
  });

  const started = performance.now();
  const duration = 1750;
  const frame = (now) => {
    state.run.reveal = clamp((now - started) / duration, 0, 1);
    drawEquityChart();
    updateLiveEndpoint();
    if (state.run.reveal < 1) state.run.raf = requestAnimationFrame(frame);
    else {
      state.run.raf = null;
      state.run.progress = 100;
      updateRunVisuals();
    }
  };
  state.run.raf = requestAnimationFrame(frame);
}

function updateRunVisuals() {
  const stages = document.querySelectorAll('.run-stage');
  stages.forEach((el, i) => {
    el.classList.toggle('done', i < state.run.stage || state.run.stage === 5);
    el.classList.toggle('current', i === state.run.stage && state.run.stage < 5);
  });
  const bar = document.querySelector('#run-progress-bar');
  if (bar) bar.style.width = `${state.run.progress}%`;
  const label = document.querySelector('#run-status-label');
  const copy = ['Validate execution', 'Run 1Y', 'Run 2Y', 'Run 3Y', 'Challenge fills', 'Complete'];
  if (label) label.textContent = copy[state.run.stage] || 'Ready';
}

function factorOptionGroups(selected) {
  const groups = [...new Set(factorCatalog.map((f) => f.group))];
  return groups.map((g) => `<optgroup label="${g}">${factorCatalog.filter((f) => f.group === g).map((f) => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${f.label}</option>`).join('')}</optgroup>`).join('');
}

function render() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <main class="main-shell">
        ${renderTopbar()}
        ${state.tab === 'test' ? renderTestPage() : ''}
        ${state.tab === 'robustness' ? renderRobustnessPage() : ''}
        ${state.tab === 'discrepancy' ? renderDiscrepancyPage() : ''}
        ${state.tab === 'data' ? renderDataPage() : ''}
        ${state.tab === 'fees' ? renderFeesPage() : ''}
        ${state.tab === 'settings' ? renderSettingsPage() : ''}
        ${state.tab === 'methodology' ? renderMethodologyPage() : ''}
      </main>
    </div>`;
  bindEvents();
  requestAnimationFrame(() => {
    if (state.results && state.tab === 'test') drawEquityChart();
    if (state.sweep.result && state.tab === 'robustness') drawSweepChart();
    if (state.tab === 'discrepancy') drawDiscrepancyChart();
  });
}

function renderSidebar() {
  const nav = [
    ['test', '⌁', 'Strategy lab'],
    ['robustness', '◌', 'Robustness'],
    ['discrepancy', '⇄', 'Discrepancy'],
    ['data', '▤', 'Data health'],
    ['fees', '$', 'Fees'],
    ['settings', '⚙', 'Settings'],
    ['methodology', 'i', 'Methodology'],
  ];
  return `<aside class="sidebar">
    <div class="brand-row"><div class="brand-mark">₿</div><div><strong>BTC Lab</strong><span>Prediction research</span></div></div>
    <nav>${nav.map(([id, icon, label]) => `<button class="nav-btn ${state.tab === id ? 'active' : ''}" data-tab="${id}"><i>${icon}</i><span>${label}</span></button>`).join('')}</nav>
    <div class="side-status"><div><span class="status-dot"></span><strong>Synthetic demo data</strong></div><small>Real backtest engine. Demo generator only. No production edge is implied.</small></div>
  </aside>`;
}

function renderTopbar() {
  const titles = {
    test: ['STRATEGY LAB', 'Build → run → challenge'],
    robustness: ['ROBUSTNESS', 'Parameter stability, not one best point'],
    discrepancy: ['CROSS-VENUE', 'Kalshi ↔ Polymarket disagreement'],
    data: ['DATA HEALTH', 'Coverage and field integrity'],
    fees: ['FEES', 'Venue formulas, presets & fee drag'],
    settings: ['SETTINGS', 'Source and research defaults'],
    methodology: ['METHODOLOGY', 'What the engine does and does not prove'],
  };
  const [eyebrow, title] = titles[state.tab];
  return `<header class="topbar">
    <div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1></div>
    <div class="top-actions"><span class="badge warning">DEMO / SYNTHETIC</span><span class="badge">v0.7 local candidate</span><button class="ghost-btn" id="export-strategy">Export strategy JSON</button><button class="ghost-btn" id="reset-app">Reset</button></div>
  </header>`;
}

function renderTestPage() {
  return `<section class="lab-layout">
    <div class="builder-stack">
      ${renderHypothesisCard()}
      ${renderSignalBuilder()}
      ${renderExecutionCard()}
      ${renderRiskCard()}
      ${renderRunCard()}
    </div>
    <div class="results-stack">
      ${state.results ? renderResultsPanel() : renderEmptyResults()}
    </div>
  </section>`;
}

function renderHypothesisCard() {
  return `<section class="card hypothesis-card">
    <div class="section-head"><div><span class="eyebrow">STARTING LENS</span><h2>What starts the hypothesis?</h2><p>This only chooses the first factor. BTC, prediction-market and reference factors can still be mixed.</p></div></div>
    <div class="lens-grid">
      <button class="lens-btn ${state.lens === 'prediction' ? 'active' : ''}" data-lens="prediction"><span>◈</span><strong>Prediction market</strong><small>Price, shock, order flow, discrepancy</small></button>
      <button class="lens-btn ${state.lens === 'btc' ? 'active' : ''}" data-lens="btc"><span>⌁</span><strong>BTC technicals</strong><small>VWAP, EMA, momentum, levels, vol</small></button>
    </div>
  </section>`;
}

function renderSignalBuilder() {
  return `<section class="card">
    <div class="section-head inline"><div><span class="eyebrow">SIGNAL</span><h2>Conditions</h2><p>Every factor reads only the current or backward-looking state.</p></div>
      <div class="segmented"><button data-join="AND" class="${state.joinMode === 'AND' ? 'active' : ''}">ALL / AND</button><button data-join="OR" class="${state.joinMode === 'OR' ? 'active' : ''}">ANY / OR</button></div>
    </div>
    <div class="factor-list">${state.factors.map(renderFactor).join('')}</div>
    <div class="add-factor-row"><select id="add-factor-select">${factorOptionGroups('pm_price')}</select><button id="add-factor" class="accent-outline">＋ Add factor</button></div>
  </section>`;
}

function renderFactor(factor, index) {
  const t = getFactorTemplate(factor.type);
  return `<article class="factor-card" data-factor-id="${factor.instanceId}">
    <div class="factor-top"><span class="factor-index">${index + 1}</span><div class="factor-title"><select class="factor-type" data-factor-id="${factor.instanceId}">${factorOptionGroups(factor.type)}</select><p><span>${t.group}</span>${t.description}</p></div>${state.factors.length > 1 ? `<button class="icon-btn remove-factor" data-factor-id="${factor.instanceId}" aria-label="Remove factor">×</button>` : '<span></span>'}</div>
    <div class="field-grid">${t.fields.filter((f) => !(factor.type === 'pm_price' && f.key === 'tolerance' && factor.values.operator !== 'within')).map((f) => renderFactorField(f, factor)).join('')}</div>
  </article>`;
}

function renderFactorField(field, factor) {
  const v = factor.values[field.key] ?? field.default ?? '';
  if (field.type === 'select') return `<label><span>${field.label}</span><select class="factor-value" data-factor-id="${factor.instanceId}" data-key="${field.key}">${field.options.map((o) => { const val = typeof o === 'string' ? o : o.value; const text = typeof o === 'string' ? o : o.label; return `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${text}</option>`; }).join('')}</select></label>`;
  return `<label><span>${field.label}</span><input class="factor-value" data-factor-id="${factor.instanceId}" data-key="${field.key}" type="number" value="${v}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 'any'}"></label>`;
}

function selectControl(cls, key, label, value, options) {
  return `<label><span>${label}</span><select class="${cls}" data-key="${key}">${options.map((o) => {
    const val = typeof o === 'string' ? o : o.value;
    const text = typeof o === 'string' ? o : o.label;
    return `<option value="${val}" ${String(value) === String(val) ? 'selected' : ''}>${text}</option>`;
  }).join('')}</select></label>`;
}
function numControl(cls, key, label, value, min, max, step) {
  return `<label><span>${label}</span><input class="${cls}" data-key="${key}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
}

function renderExecutionCard() {
  const e = state.execution;
  return `<section class="card">
    <div class="section-head"><div><span class="eyebrow">EXECUTION</span><h2>Trade cycle</h2><p>Signal, target contract, fill and exit are separate. Repeat means sequential cycles, not silent pyramiding.</p></div></div>
    <div class="control-block"><h3>Target</h3><div class="control-grid three">
      ${selectControl('execution-value', 'tradeVenue', 'Primary venue', e.tradeVenue, ['Kalshi', 'Polymarket'])}
      ${selectControl('execution-value', 'tradeSide', 'Execute side', e.tradeSide, [{value:'AUTO',label:'AUTO · follow entry-price rule'},{value:'YES',label:'UP / YES'},{value:'NO',label:'DOWN / NO'}])}
      ${selectControl('execution-value', 'marketHorizon', 'Contract horizon', e.marketHorizon, ['5m', '15m', '1h'])}
    </div></div>
    <div class="control-block"><h3>Re-entry</h3><div class="control-grid three">
      ${selectControl('execution-value', 'reentryMode', 'Entries / contract', e.reentryMode, [{value:'once',label:'One cycle'}, {value:'limited',label:'Limited cycles'}, {value:'repeat',label:'Repeat cycles'}])}
      ${e.reentryMode === 'limited' ? numControl('execution-value','maxEntriesPerContract','Max cycles',e.maxEntriesPerContract,1,20,1) : numControl('execution-value','entryCooldownSeconds','Cooldown seconds',e.entryCooldownSeconds,0,3600,1)}
      <div class="info-control"><span>Overlap</span><strong>Blocked</strong><small>Candidate fix: no same-contract pyramiding by default.</small></div>
    </div></div>
    <div class="control-block"><h3>Exit</h3><div class="control-grid three">
      ${selectControl('execution-value', 'exitMode', 'Exit mode', e.exitMode, [{value:'expiry',label:'Hold to settlement'}, {value:'target',label:'Price target'}, {value:'target_stop',label:'Target + stop'}, {value:'time',label:'Time before expiry'}])}
      ${['target','target_stop'].includes(e.exitMode) ? numControl('execution-value','exitTarget','Target price',e.exitTarget,.01,.99,.01) : '<div class="info-control"><span>Target price</span><strong>—</strong><small>Not used in settlement mode.</small></div>'}
      ${e.exitMode === 'target_stop' ? numControl('execution-value','stopPrice','Stop price',e.stopPrice,.01,.99,.01) : e.exitMode === 'time' ? numControl('execution-value','exitSecondsRemaining','Exit seconds left',e.exitSecondsRemaining,1,3600,1) : '<div class="info-control"><span>Secondary exit</span><strong>—</strong><small>No second exit trigger.</small></div>'}
    </div></div>
    <div class="truth-note ${e.tradeSide === 'AUTO' ? 'good-note' : ''}"><strong>${e.tradeSide === 'AUTO' ? 'AUTO active' : `Manual ${e.tradeSide} override`}</strong> · ${e.tradeSide === 'AUTO' ? autoSideSummary() : 'the selected side is forced even if the opposite side matches the price rule better.'}</div>
    <div class="truth-note">Adding a contract-price / fill-price rule automatically changes Execute side to AUTO. You can then override it to YES / UP or NO / DOWN. If no contract-price rule exists, Execute defaults to YES / UP because AUTO has nothing price-based to choose from.</div>
  </section>`;
}

function renderRiskCard() {
  const r = state.risk;
  return `<details class="card collapsible"><summary><div><span class="eyebrow">PORTFOLIO</span><strong>Risk, sizing & friction</strong><small>Open to change capital, costs and exposure assumptions.</small></div><span>⌄</span></summary><div class="details-body">
    <div class="control-grid three">
      ${numControl('risk-value','startingCapital','Starting capital',r.startingCapital,100,100000000,1000)}
      ${selectControl('risk-value','sizingMode','Sizing',r.sizingMode,[{value:'fixed_contracts',label:'Fixed contract count · research default'},{value:'fixed_dollars',label:'Fixed dollars per trade'},{value:'fixed_base_pct',label:'Fixed % of starting capital'},{value:'fixed_pct',label:'Fixed % of current equity · compounds'},{value:'kelly',label:'Fractional Kelly · expiry only'}])}
      ${r.sizingMode === 'fixed_contracts' ? numControl('risk-value','fixedContracts','Contracts / trade',r.fixedContracts,1,100000,1) : r.sizingMode === 'fixed_dollars' ? numControl('risk-value','fixedTradeDollars','Dollars / trade',r.fixedTradeDollars,1,10000000,10) : ['fixed_pct','fixed_base_pct'].includes(r.sizingMode) ? numControl('risk-value','fixedTradePct',r.sizingMode==='fixed_pct'?'% current equity':'% starting capital',r.fixedTradePct,.01,100,.25) : numControl('risk-value','kellyFraction','Kelly multiplier',r.kellyFraction,0,1,.05)}
      ${numControl('risk-value','maxTradePct','Max position %',r.maxTradePct,.1,100,.5)}
      ${numControl('risk-value','maxExposurePct','Max exposure %',r.maxExposurePct,.1,100,1)}
      ${numControl('risk-value','slippageCents','Slippage ¢/share',r.slippageCents,0,20,.1)}
      ${r.sizingMode === 'kelly' ? numControl('risk-value','kellyLookback','Kelly lookback trades',r.kellyLookback,1,5000,1) : `<div class="info-control"><span>Venue fees</span><strong>${state.fees.enabled?'ON':'OFF'}</strong><small>Formula-based cash fees are configured in the Fees tab, separate from slippage.</small></div>`}
    </div>
    <div class="truth-note"><strong>Sizing interpretation:</strong> fixed contracts isolates per-contract economics best. Fixed dollars and % of starting capital avoid exponential compounding. % of current equity intentionally compounds and can create enormous portfolio returns over thousands of trades even from a small edge.</div>
  </div></details>`;
}

function renderRunCard() {
  const labels = ['Validate', '1Y', '2Y', '3Y', 'Challenge', 'Done'];
  return `<section class="run-card">
    <div class="run-top"><div><span class="eyebrow">RUN</span><h2>Backtest from start → end</h2><p>The engine computes first. The UI then reveals the actual returned equity path on fixed axes.</p></div><div class="run-actions"><label><span>Demo seed</span><input id="seed-input" type="number" value="${state.seed}"></label><button id="run-backtest" class="run-btn">▶ Run full backtest</button></div></div>
    <div class="run-stages" id="run-stages">${labels.map((l,i) => `<div class="run-stage ${i < state.run.stage || state.run.stage === 5 ? 'done' : ''} ${i === state.run.stage && state.run.stage < 5 ? 'current' : ''}"><i></i><span>${l}</span></div>`).join('')}</div>
    <div class="progress-track"><i id="run-progress-bar" style="width:${state.run.progress}%"></i></div>
    <div class="run-foot"><strong id="run-status-label">${state.results ? 'Complete' : 'Ready'}</strong><span>Demo mode validates mechanics only. It is not historical evidence.</span></div>
  </section>`;
}

function renderEmptyResults() {
  return `<section class="empty-panel"><div class="empty-mark">↗</div><span class="eyebrow">RESULTS</span><h2>Configure the hypothesis, then run it.</h2><p>The chart is generated from the real runBacktest() equity arrays. AUTO side can buy YES or NO depending on which side actually satisfies the price rule. X and Y scales are fixed before the reveal starts.</p><div class="empty-grid"><div><span>Windows</span><strong>1Y · 2Y · 3Y</strong></div><div><span>Venues</span><strong>Kalshi · Polymarket</strong></div><div><span>Fills</span><strong>Ask · Last · Mid</strong></div><div><span>Data</span><strong>Synthetic demo</strong></div></div></section>`;
}

function renderResultsPanel() {
  const r = resultFor();
  const m = r.metrics;
  const gross = grossResultFor();
  const gm = gross?.metrics || m;
  const sens = fillSensitivity();
  const finalEq = m.endingCapital;
  const pnl = finalEq - Number(state.risk.startingCapital);
  return `<section class="results-panel">
    <div class="results-toolbar">
      <div><span class="eyebrow">REAL ENGINE OUTPUT · SYNTHETIC INPUT</span><h2>Equity & drawdown</h2></div>
      <div class="view-controls"><div class="segmented">${[1,2,3].map((y)=>`<button class="period-btn ${state.viewYears===y?'active':''}" data-years="${y}">${y}Y</button>`).join('')}</div><div class="segmented"><button class="venue-btn ${state.viewVenue==='Kalshi'?'active':''}" data-venue="Kalshi">Kalshi</button><button class="venue-btn ${state.viewVenue==='Polymarket'?'active':''}" data-venue="Polymarket">Poly</button></div><div class="segmented"><button class="fill-btn ${state.viewFill==='ask'?'active':''}" data-fill="ask">Ask</button><button class="fill-btn ${state.viewFill==='last'?'active':''}" data-fill="last">Last</button><button class="fill-btn ${state.viewFill==='midpoint'?'active':''}" data-fill="midpoint">Mid</button></div></div>
    </div>
    <div class="chart-kpis"><div><span>Ending equity</span><strong id="live-ending-equity">${fmtMoney(finalEq,0)}</strong><small id="live-ending-return" class="${pnl>=0?'positive':'negative'}">${pnl>=0?'+':''}${fmtMoney(pnl,0)} · ${fmtPct(m.totalReturn)}</small></div><div><span>Trades</span><strong>${m.trades.toLocaleString()}</strong><small>${fmtPct(m.winRate)} profitable exits · avg ${fmtNum(m.avgContracts,1)} contracts</small></div><div><span>Max drawdown</span><strong class="negative">${fmtPct(m.maxDrawdown)}</strong><small>Peak-to-trough equity</small></div><div><span>Expectancy</span><strong class="${m.expectancy>=0?'positive':'negative'}">${fmtMoney(m.expectancy,2)}</strong><small>Average completed trade</small></div></div>
    <div class="chart-shell" id="equity-chart-shell"><canvas id="equity-chart"></canvas><div class="chart-tooltip" id="chart-tooltip"></div><div class="chart-series-controls">
      <label class="series-toggle net"><input type="checkbox" data-chart-line="net" ${state.chartLines.net?'checked':''}><i></i><span>Net · ${state.viewVenue}</span><button type="button" class="line-info-btn" data-line-info="net" aria-label="Explain net line">i</button></label>
      <label class="series-toggle gross"><input type="checkbox" data-chart-line="gross" ${state.chartLines.gross?'checked':''}><i></i><span>No fees</span><button type="button" class="line-info-btn" data-line-info="gross" aria-label="Explain no-fee line">i</button></label>
      <label class="series-toggle other"><input type="checkbox" data-chart-line="other" ${state.chartLines.other?'checked':''}><i></i><span>${state.viewVenue==='Kalshi'?'Polymarket':'Kalshi'} net</span><button type="button" class="line-info-btn" data-line-info="other" aria-label="Explain comparison line">i</button></label>
      <label class="series-toggle drawdown"><input type="checkbox" data-chart-line="drawdown" ${state.chartLines.drawdown?'checked':''}><i></i><span>Drawdown</span><button type="button" class="line-info-btn" data-line-info="drawdown" aria-label="Explain drawdown line">i</button></label>
    </div></div>
    ${renderChartInfoPanel()}
    <div class="metric-grid">
      ${metricTile(state.risk.sizingMode==='fixed_pct'?'Portfolio return · compounded':'Portfolio return · sizing dependent', fmtPct(m.totalReturn), m.totalReturn >= 0)}
      ${metricTile('CAGR', fmtPct(m.cagr), m.cagr >= 0)}
      ${state.execution.exitMode === 'expiry' ? metricTile('Settlement win', fmtPct(m.settlementWinRate), null) : metricTile('Profitable exits', fmtPct(m.winRate), null)}
      ${metricTile('Avg all-in entry', fmtPct(m.avgEntry), null)}
      ${state.execution.exitMode === 'expiry' ? metricTile('Observed settlement edge', fmtPts(m.empiricalEdge), m.empiricalEdge >= 0) : metricTile('Avg realized exit', fmtPct(m.avgExit), null)}
      ${metricTile('Return on gross cost', fmtPct(m.deployedRoi), m.deployedRoi >= 0)}
      ${metricTile('P/L per contract', fmtMoney(m.avgPnlPerContract,3), m.avgPnlPerContract >= 0)}
      ${metricTile('Trading fees', fmtMoney(m.totalFees,2), m.totalFees === 0 ? null : false)}
      ${metricTile('Profit factor', Number.isFinite(m.profitFactor) ? fmtNum(m.profitFactor,2) : '∞', m.profitFactor >= 1)}
    </div>
    <div class="truth-note fee-summary-note"><strong>Fee view:</strong> ${state.fees.enabled ? `${state.viewVenue} charged ${fmtMoney(m.totalFees,2)} across ${m.trades} completed trades (${fmtMoney(m.totalEntryFees,2)} entry + ${fmtMoney(m.totalExitFees,2)} exit). No-fee counterfactual return: ${fmtPct(gm.totalReturn)} vs net ${fmtPct(m.totalReturn)}.` : 'Fees are OFF. Net and no-fee lines are identical until the fee engine is enabled.'}</div>
    ${state.execution.exitMode !== 'expiry' ? `<div class="truth-note"><strong>Early-exit interpretation:</strong> ${m.targetExits} target · ${m.stopExits} stop · ${m.timeExits} timed · ${m.expiryExits} expiry exits. Final settlement win rate (${fmtPct(m.settlementWinRate)}) is diagnostic only and is not used as the headline “edge” for this payoff shape.</div>` : ''}
    <div class="evidence-grid">
      <section class="evidence-card critical"><span class="eyebrow">EVIDENCE GATE</span><strong>DEMO — not evidence</strong><p>These rows are synthetic. The demo path is now generated forward and market probabilities are derived from the same synthetic diffusion process to avoid intentionally manufacturing an edge. It still is not historical evidence.</p></section>
      <section class="evidence-card ${sens.large?'warn':'good'}"><span class="eyebrow">FILL SENSITIVITY</span><strong>${sens.large?'Materially sensitive':'Within configured alert'}</strong><p>Largest ask-vs-last/mid difference: ${fmtPct(sens.maxReturn)} total return · ${fmtPts(sens.maxWin)} settlement-win rate.</p><button id="toggle-fill-details" class="text-btn">${state.showFillDetails?'Hide':'Inspect'} variants</button></section>
    </div>
    ${state.showFillDetails ? renderFillDetails(sens) : ''}
    ${r.warnings?.length ? `<div class="warning-list">${r.warnings.map((w)=>`<div>⚠ ${w}</div>`).join('')}</div>` : ''}
    ${renderTradeLedger(r)}
    ${renderAdvancedDiagnostics(m)}
  </section>`;
}

function chartLineExplanation(key) {
  if (!state.results) return null;
  const net = resultFor(), gross = grossResultFor();
  const m = net.metrics, gm = gross.metrics;
  const start = Number(state.risk.startingCapital);
  const otherVenue = state.viewVenue === 'Kalshi' ? 'Polymarket' : 'Kalshi';
  const other = resultFor(state.viewYears, otherVenue, state.viewFill);
  if (key === 'net') {
    const drag = gm.endingCapital - m.endingCapital;
    return {
      title: `Net after fees · ${state.viewVenue}`,
      body: state.fees.enabled
        ? `This is the fee-aware portfolio path for the selected venue. This run moved from ${fmtMoney(start,0)} to ${fmtMoney(m.endingCapital,0)} (${fmtPct(m.totalReturn)}). The engine charged ${fmtMoney(m.totalFees,2)} of venue/custom trading fees. The fee-off rerun ended ${fmtMoney(drag,2)} higher; that ending-equity difference can differ from literal fee dollars when sizing/cash capacity changes after fees.`
        : `Fees are disabled, so this line is identical to the no-fee counterfactual. This run moved from ${fmtMoney(start,0)} to ${fmtMoney(m.endingCapital,0)} (${fmtPct(m.totalReturn)}).`,
    };
  }
  if (key === 'gross') return {
    title: 'No-fee counterfactual',
    body: `Same strategy, synthetic data, venue, fill assumption and slippage, rerun with trading fees disabled. It ended at ${fmtMoney(gm.endingCapital,0)} (${fmtPct(gm.totalReturn)}). Compare it with the net line to isolate fee drag; this is not “zero friction” because slippage is still applied.`,
  };
  if (key === 'other') return {
    title: `${otherVenue} net comparison`,
    body: `Fee-aware result for ${otherVenue} using that venue's own configured fee profile. It ended at ${fmtMoney(other.metrics.endingCapital,0)} (${fmtPct(other.metrics.totalReturn)}) with ${fmtMoney(other.metrics.totalFees,2)} in simulated trading fees. The line can differ because both quotes/outcomes and fee rules differ by venue.`,
  };
  if (key === 'drawdown') return {
    title: 'Net drawdown',
    body: `Peak-to-trough decline of the selected venue's net-after-fee equity path. The worst drawdown in this run was ${fmtPct(m.maxDrawdown)}. It moves down when current net equity falls below its prior running high and returns toward 0% when a new equity peak is reached.`,
  };
  return null;
}
function renderChartInfoPanel() {
  const info = chartLineExplanation(state.chartInfo);
  if (!info) return '';
  return `<div class="chart-info-panel"><div><strong>${esc(info.title)}</strong><p>${esc(info.body)}</p></div><button id="close-chart-info" class="icon-btn" aria-label="Close explanation">×</button></div>`;
}

function metricTile(label, value, positive = null) {
  return `<div class="metric-tile"><span>${label}</span><strong class="${positive === true ? 'positive' : positive === false ? 'negative' : ''}">${value}</strong></div>`;
}
function renderFillDetails(sens) {
  const ask = resultFor(state.viewYears, state.viewVenue, 'ask').metrics;
  return `<section class="fill-details"><div class="fill-row header"><span>Fill</span><span>Return</span><span>Settlement win</span><span>Trades</span><span>Max DD</span></div>${['ask','last','midpoint'].map((f)=>{const x=resultFor(state.viewYears,state.viewVenue,f).metrics;return `<div class="fill-row"><strong>${f}</strong><span class="${x.totalReturn>=0?'positive':'negative'}">${fmtPct(x.totalReturn)}</span><span>${fmtPct(x.settlementWinRate)}</span><span>${x.trades}</span><span>${fmtPct(x.maxDrawdown)}</span></div>`}).join('')}<p>Ask is the primary executable-buy scenario. Last and midpoint are observation/fill sensitivity comparisons.</p></section>`;
}
function renderTradeLedger(result) {
  const trades = result.trades.slice(-16).reverse();
  return `<section class="table-card"><div class="table-head"><div><span class="eyebrow">TRADES</span><strong>Recent completed trades</strong></div><span>${state.viewYears}Y · ${state.viewVenue} · ${state.viewFill}</span></div><div class="table-wrap"><table><thead><tr><th>Entry</th><th>Contract</th><th>Side</th><th>Entry</th><th>Exit</th><th>Reason</th><th>Fees</th><th>P/L</th></tr></thead><tbody>${trades.map((t)=>`<tr><td>${new Date(t.timestamp).toLocaleString()}</td><td>${t.contractId}</td><td>${t.side}</td><td>${fmtPct(t.entryPrice)}</td><td>${fmtPct(t.exitPrice)}</td><td>${t.exitReason}</td><td>${fmtMoney(t.totalFee,3)}</td><td class="${t.pnl>=0?'positive':'negative'}">${fmtMoney(t.pnl,2)}</td></tr>`).join('') || '<tr><td colspan="8">No trades matched this configuration.</td></tr>'}</tbody></table></div></section>`;
}
function renderAdvancedDiagnostics(m) {
  const items = [
    ['Brier', fmtNum(m.brier,4), advancedMetricHelp.brier], ['Log loss',fmtNum(m.logLoss,4),advancedMetricHelp.logLoss], ['Calibration error',fmtPct(m.calibration),advancedMetricHelp.calibration], ['95% win interval',`${fmtPct(m.confidenceLow)}–${fmtPct(m.confidenceHigh)}`,advancedMetricHelp.confidence], ['Approx p-value',fmtNum(m.pValueApprox,4),advancedMetricHelp.significance], ['Sortino-like',fmtNum(m.sortino,2),advancedMetricHelp.sortino], ['Calmar',fmtNum(m.calmar,2),advancedMetricHelp.calmar], ['Tail CVaR 5%',fmtPct(m.cvar95,2),advancedMetricHelp.cvar],
  ];
  return `<details class="advanced-card" ${state.showAdvanced?'open':''}><summary><div><span class="eyebrow">DIAGNOSTICS</span><strong>Advanced statistics</strong><small>Probability and tail diagnostics. Still synthetic until real history is loaded.</small></div><span>⌄</span></summary><div class="advanced-grid">${items.map(([l,v,h])=>`<div><span>${l}</span><strong>${v}</strong><p>${h}</p></div>`).join('')}</div></details>`;
}

function numericSweepFields(factor) { return getFactorTemplate(factor.type).fields.filter((f) => f.type === 'number'); }
function ensureSweepSelection() {
  const factor = state.factors.find((f)=>f.instanceId===state.sweep.factorId) || state.factors[0];
  if (!factor) return null;
  state.sweep.factorId = factor.instanceId;
  const fields = numericSweepFields(factor);
  if (!fields.some((f)=>f.key===state.sweep.fieldKey)) {
    state.sweep.fieldKey = fields[0]?.key || null;
    if (fields[0]) setSweepDefaults(factor, fields[0]);
  }
  return { factor, fields };
}
function runSweep() {
  const feeCheck = validateFeeSettings();
  if (!feeCheck.valid) { state.sweep.error = `Fee formula: ${feeCheck.error}`; state.sweep.result = null; render(); return; }
  const selected = state.factors.find((f)=>f.instanceId===state.sweep.factorId);
  const field = sweepFieldMeta(selected);
  if (!selected || !field) return;
  const rawStart = Number(state.sweep.start), rawEnd = Number(state.sweep.end), rawStep = Math.abs(Number(state.sweep.step));
  const min = Number.isFinite(Number(field.min)) ? Number(field.min) : -Infinity;
  const max = Number.isFinite(Number(field.max)) ? Number(field.max) : Infinity;
  const startValue = clamp(rawStart, min, max), endValue = clamp(rawEnd, min, max);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || !Number.isFinite(rawStep) || rawStep <= 0) {
    state.sweep.error = 'Enter a finite start/end and a positive step.';
    state.sweep.result = null;
    render();
    return;
  }
  const estimated = Math.floor(Math.abs(endValue - startValue) / rawStep) + 1;
  if (estimated > 101) {
    state.sweep.error = `That range would run about ${estimated} backtests. Increase the step so the sweep stays at 101 points or fewer.`;
    state.sweep.result = null;
    render();
    return;
  }
  state.sweep.start = startValue;
  state.sweep.end = endValue;
  state.sweep.step = rawStep;
  state.sweep.error = null;
  state.sweep.result = runParameterSweep({ rows: rowsForYears(state.sweep.years), factors: state.factors, joinMode: state.joinMode, risk: state.risk, execution: cloneExecutionForVenue(state.sweep.venue), dataSettings: state.dataSettings, feeSettings: state.fees, factorInstanceId: state.sweep.factorId, fieldKey: state.sweep.fieldKey, start: startValue, end: endValue, step: rawStep, fillMode:state.sweep.fill });
  render();
}

function renderRobustnessPage() {
  const sel = ensureSweepSelection();
  const field = sweepFieldMeta(sel?.factor);
  const current = field ? Number(sel.factor.values[field.key]) : null;
  const base = state.results ? fillSensitivity(3, state.execution.tradeVenue) : null;
  return `<section class="page-stack">
    <section class="card"><div class="section-head"><div><span class="eyebrow">PARAMETER SWEEP</span><h2>Look for a stable region, not one magic point</h2><p>Every point reruns the same strategy with exactly one numeric field changed. The default score is ROI on gross capital deployed so a setting is not rewarded merely for generating more trades.</p></div></div>
      <div class="control-grid four">
        <label><span>Factor</span><select id="sweep-factor">${state.factors.map((f,i)=>`<option value="${f.instanceId}" ${f.instanceId===sel?.factor.instanceId?'selected':''}>${i+1}. ${getFactorTemplate(f.type).label}</option>`).join('')}</select></label>
        <label><span>Numeric field</span><select id="sweep-field">${(sel?.fields||[]).map((f)=>`<option value="${f.key}" ${f.key===state.sweep.fieldKey?'selected':''}>${f.label}</option>`).join('')}</select></label>
        <label><span>Score chart</span><select id="sweep-metric"><option value="deployedRoi" ${state.sweep.metric==='deployedRoi'?'selected':''}>ROI on gross deployed</option><option value="avgPnlPerContract" ${state.sweep.metric==='avgPnlPerContract'?'selected':''}>P/L per contract</option><option value="avgPnl" ${state.sweep.metric==='avgPnl'?'selected':''}>Expectancy per trade</option><option value="totalReturn" ${state.sweep.metric==='totalReturn'?'selected':''}>Portfolio return</option></select></label>
        <label><span>Venue / window / fill</span><div class="inline-selects three-way"><select id="sweep-venue"><option ${state.sweep.venue==='Kalshi'?'selected':''}>Kalshi</option><option ${state.sweep.venue==='Polymarket'?'selected':''}>Polymarket</option></select><select id="sweep-years">${[1,2,3].map(y=>`<option value="${y}" ${state.sweep.years===y?'selected':''}>${y}Y</option>`).join('')}</select><select id="sweep-fill"><option value="ask" ${state.sweep.fill==='ask'?'selected':''}>Ask</option><option value="last" ${state.sweep.fill==='last'?'selected':''}>Last</option><option value="midpoint" ${state.sweep.fill==='midpoint'?'selected':''}>Mid</option></select></div></label>
        <label><span>Start${Number.isFinite(field?.min)?` · min ${field.min}`:''}</span><input id="sweep-start" type="number" step="${field?.step ?? 'any'}" min="${field?.min ?? ''}" max="${field?.max ?? ''}" value="${state.sweep.start}"></label>
        <label><span>End${Number.isFinite(field?.max)?` · max ${field.max}`:''}</span><input id="sweep-end" type="number" step="${field?.step ?? 'any'}" min="${field?.min ?? ''}" max="${field?.max ?? ''}" value="${state.sweep.end}"></label>
        <label><span>Step</span><input id="sweep-step" type="number" step="${field?.step ?? 'any'}" min="${field?.step ?? 0.000001}" value="${state.sweep.step}"></label>
        <div class="button-control"><span>Baseline ${Number.isFinite(current)?fmtNum(current,4):'—'}</span><div class="sweep-actions"><button id="reset-sweep-range" class="ghost-btn" ${!field?'disabled':''}>Smart range</button><button id="run-sweep" class="run-btn" ${!sel?.fields.length?'disabled':''}>Run sweep</button></div></div>
      </div>
      ${state.sweep.error ? `<div class="truth-note error-note"><strong>Sweep not run:</strong> ${state.sweep.error}</div>` : ''}
      <div class="truth-note"><strong>What changes:</strong> only “${field?.label || '—'}” on factor ${state.factors.indexOf(sel?.factor)+1}. All other factors, execution, venue-fee formula, sizing and data stay fixed. The selected ${state.sweep.fill === 'ask' ? 'executable Ask' : state.sweep.fill === 'midpoint' ? 'Midpoint' : 'Last'} fill assumption is held constant across the sweep. Zero-trade parameter values are treated as missing evidence, not a 0% result.</div>
    </section>
    ${state.sweep.result ? renderSweepResults() : `<section class="empty-subpanel"><strong>No sweep run yet.</strong><p>The Smart range button derives a valid range from the field's current value, min/max and native step, so switching from a 45¢ price to something like a 5-second lookback no longer reuses nonsense 0.30→0.70 bounds.</p></section>`}
    <section class="card"><div class="section-head"><div><span class="eyebrow">EXECUTION ROBUSTNESS</span><h2>Ask / last / midpoint</h2></div></div>${base ? `<div class="evidence-card ${base.large?'warn':'good'}"><strong>${base.large?'Sensitive':'Within alert'}</strong><p>3Y ${state.execution.tradeVenue}: max return gap ${fmtPct(base.maxReturn)} · max settlement-win gap ${fmtPts(base.maxWin)}.</p></div>` : '<p class="muted">Run the base backtest first to populate fill sensitivity.</p>'}</section>
  </section>`;
}

function renderSweepResults() {
  const points = state.sweep.result || [];
  const metric = sweepMetricConfig();
  const eligible = points.filter((p) => p.trades > 0 && Number.isFinite(Number(p[metric.key])));
  const best = [...eligible].sort((a,b)=>(Number(b[metric.key])-Number(a[metric.key]))*metric.direction)[0];
  const selected = state.factors.find((f)=>f.instanceId===state.sweep.factorId);
  const current = Number(selected?.values?.[state.sweep.fieldKey]);
  const nearest = [...eligible].sort((a,b)=>Math.abs(a.value-current)-Math.abs(b.value-current))[0];
  const step = Math.abs(Number(state.sweep.step)) || 0;
  const local = eligible.filter((p)=>Number.isFinite(current) && Math.abs(p.value-current) <= step*2.01);
  const localScores = local.map((p)=>Number(p[metric.key]));
  const localTrades = local.map((p)=>p.trades);
  const localMin = localScores.length ? Math.min(...localScores) : null, localMax = localScores.length ? Math.max(...localScores) : null;
  const signFlip = localMin !== null && localMax !== null && localMin < 0 && localMax > 0;
  const pctMetric = ['deployedRoi','totalReturn'].includes(metric.key);
  const localSpread = localMin === null ? 0 : localMax-localMin;
  const unstable = signFlip || (pctMetric ? localSpread > 0.05 : localSpread > Math.max(0.02, Math.abs(Number(nearest?.[metric.key]||0))));
  const stability = local.length >= 2 ? `<div class="sweep-stability ${unstable?'warn':'good'}"><strong>Local stability · ${unstable?'UNSTABLE / CHOPPY':'RELATIVELY STABLE'}</strong><span>${local.length} nearby points · ${metric.label} ${metric.format(localMin)} → ${metric.format(localMax)} · trades ${Math.min(...localTrades)} → ${Math.max(...localTrades)}</span><small>A narrow price-band sweep can jump because each target price selects a different contract sample; smoothness is not assumed.</small></div>` : '';
  return `<section class="card"><div class="section-head inline"><div><span class="eyebrow">SWEEP RESULT</span><h2>${points.length} tested values · ${metric.label}</h2><p>Read the shape and trade-count stability. A single tall point surrounded by weak neighbors is a warning, not a discovery.</p></div><div class="sweep-kpis">${nearest?`<div class="mini-kpi"><span>Baseline area</span><strong>${fmtNum(nearest.value,4)} → ${metric.format(nearest[metric.key])}</strong></div>`:''}${best?`<div class="mini-kpi"><span>Highest demo score</span><strong>${fmtNum(best.value,4)} → ${metric.format(best[metric.key])}</strong></div>`:''}</div></div>${stability}<div class="sweep-canvas-shell"><canvas id="sweep-chart"></canvas></div><div class="heat-strip" id="sweep-heat">${points.map((p)=>`<i data-value="${p.value}" data-score="${p[metric.key]}" data-trades="${p.trades}" title="${p.value}: ${p.trades ? metric.format(p[metric.key]) : 'no trades'} · ${p.trades} trades"></i>`).join('')}</div><div class="table-wrap"><table><thead><tr><th>Value</th><th>Trades</th><th>Deployed ROI</th><th>P/L / contract</th><th>Expectancy</th><th>Portfolio return</th><th>Max DD</th></tr></thead><tbody>${points.map((p)=>`<tr class="${p.trades===0?'no-evidence-row':''}"><td>${fmtNum(p.value,4)}${Number.isFinite(current)&&Math.abs(p.value-current)<1e-9?' · current':''}</td><td>${p.trades}</td><td class="${p.deployedRoi>=0?'positive':'negative'}">${p.trades?fmtPct(p.deployedRoi):'N/A'}</td><td class="${p.avgPnlPerContract>=0?'positive':'negative'}">${p.trades?fmtMoney(p.avgPnlPerContract,3):'N/A'}</td><td>${p.trades?fmtMoney(p.avgPnl,2):'N/A'}</td><td>${p.trades?fmtPct(p.totalReturn):'N/A'}</td><td>${p.trades?fmtPct(p.maxDrawdown):'N/A'}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderDiscrepancyPage() {
  const rows = discrepancyRows();
  const q = rows.filter((r)=>Math.abs(r.kalshiYesMid-r.polyYesMid)>=state.discrepancy.threshold);
  const meanAbs = q.length ? q.reduce((s,r)=>s+Math.abs(r.kalshiYesMid-r.polyYesMid),0)/q.length : 0;
  const kalshiHigh = q.length ? q.filter((r)=>r.kalshiYesMid>r.polyYesMid).length/q.length : 0;
  return `<section class="page-stack"><section class="card"><div class="section-head"><div><span class="eyebrow">DISCREPANCY</span><h2>Equivalent snapshot disagreement</h2><p>This demo compares normalized synthetic snapshots. Real research must also prove contract/rule equivalence.</p></div></div><div class="control-grid three"><label><span>|spread| ≥</span><input id="disc-threshold" type="number" min="0" max=".99" step=".01" value="${state.discrepancy.threshold}"></label><label><span>Horizon</span><select id="disc-horizon">${['5m','15m','1h'].map(h=>`<option ${h===state.discrepancy.horizon?'selected':''}>${h}</option>`).join('')}</select></label><div class="info-control"><span>Timestamp matching</span><strong>Normalized demo row</strong><small>Real backend keeps raw timestamps/tolerance.</small></div></div></section><div class="metric-grid four"><div class="metric-tile"><span>Qualifying snapshots</span><strong>${q.length.toLocaleString()}</strong></div><div class="metric-tile"><span>Mean |spread|</span><strong>${fmtPts(meanAbs)}</strong></div><div class="metric-tile"><span>Kalshi higher</span><strong>${fmtPct(kalshiHigh)}</strong></div><div class="metric-tile"><span>Settlement source</span><strong>Different</strong></div></div><section class="card"><div class="section-head"><div><span class="eyebrow">SPREAD PATH</span><h2>Kalshi − Polymarket midpoint</h2></div></div><div class="sweep-canvas-shell tall"><canvas id="discrepancy-chart"></canvas></div><p class="truth-note">A gap is not automatically arbitrage. Rules, reference source, fees, liquidity and timestamp quality must match.</p></section></section>`;
}

function renderDataPage() {
  const first = state.data[0], last = state.data[state.data.length-1];
  const contracts = new Set(state.data.map((r)=>r.contractId)).size;
  const horizons = Object.fromEntries(['5m','15m','1h'].map((h)=>[h,state.data.filter((r)=>r.marketHorizon===h).length]));
  const explicitNo = state.data.filter((r)=>Number.isFinite(r.polyNoAsk)&&Number.isFinite(r.kalshiNoAsk)).length/state.data.length;
  const refs = state.data.filter((r)=>Number.isFinite(r.kalshiReferencePrice)&&Number.isFinite(r.polyReferencePrice)).length/state.data.length;
  return `<section class="page-stack"><div class="metric-grid four"><div class="metric-tile"><span>Rows</span><strong>${state.data.length.toLocaleString()}</strong></div><div class="metric-tile"><span>Contracts</span><strong>${contracts.toLocaleString()}</strong></div><div class="metric-tile"><span>Coverage</span><strong>${first?fmtDate(first.timestamp):'—'} → ${last?fmtDate(last.timestamp):'—'}</strong></div><div class="metric-tile"><span>Source</span><strong>Synthetic generator</strong></div></div><section class="card"><div class="section-head"><div><span class="eyebrow">FIELD HEALTH</span><h2>Current local dataset</h2><p>The engine is real; these source rows are synthetic.</p></div></div><div class="health-grid"><div><span>5m rows</span><strong>${horizons['5m'].toLocaleString()}</strong></div><div><span>15m rows</span><strong>${horizons['15m'].toLocaleString()}</strong></div><div><span>1h rows</span><strong>${horizons['1h'].toLocaleString()}</strong></div><div><span>Explicit YES/NO books</span><strong>${fmtPct(explicitNo)}</strong></div><div><span>Reference fields present</span><strong>${fmtPct(refs)}</strong></div><div><span>Exact reference provenance</span><strong class="negative">No — demo proxy</strong></div></div></section><section class="card"><div class="section-head inline"><div><span class="eyebrow">REGENERATE</span><h2>Deterministic seed</h2><p>Change the seed to exercise mechanics against a different synthetic path.</p></div><div class="run-actions"><label><span>Seed</span><input id="data-seed" type="number" value="${state.seed}"></label><button id="regenerate-data" class="accent-outline">Regenerate</button></div></div></section><section class="evidence-card critical"><strong>Historical ingestion is not loaded in this preview.</strong><p>No synthetic row should be treated as investment evidence. The committed repo's acquisition/backend work remains separate.</p></section></section>`;
}

function renderFeeVenueCard(venue) {
  const p = state.fees.profiles[venue];
  const sampleC = Math.max(0, Number(state.feeSample.contracts || 0));
  const sampleP = clamp(Number(state.feeSample.price || 0), 0, 1);
  let taker = 0, maker = 0, error = null;
  try {
    taker = sampleVenueFee(state.fees, venue, sampleC, sampleP, 'taker');
    maker = sampleVenueFee(state.fees, venue, sampleC, sampleP, 'maker');
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const roundingOptions = [
    ['kalshi_balance_cent','Kalshi fill + balance rounding'],
    ['round_5dp','Round to 5 decimals'],
    ['ceil_centicent','Ceil to $0.0001'],
    ['ceil_cent','Ceil to cent'],
    ['round_cent','Round to cent'],
    ['none','No rounding'],
  ];
  return `<section class="card fee-venue-card">
    <div class="section-head inline"><div><span class="eyebrow">${venue.toUpperCase()}</span><h2>${esc(p.label)}</h2><p>${esc(p.sourceNote)}</p></div><div class="fee-card-actions"><span class="badge ${feePresetStatus(venue)==='CUSTOMIZED'?'warning':''}">${feePresetStatus(venue)}</span><button class="ghost-btn reset-fee-preset" data-venue="${venue}">Reset preset</button></div></div>
    <div class="fee-form-grid">
      <label><span>Taker rate %</span><input class="fee-value" data-venue="${venue}" data-key="takerRatePct" type="number" min="0" max="100" step="0.01" value="${p.takerRatePct}"></label>
      <label><span>Maker rate %</span><input class="fee-value" data-venue="${venue}" data-key="makerRatePct" type="number" min="0" max="100" step="0.01" value="${p.makerRatePct}"></label>
      <label><span>Taker multiplier M</span><input class="fee-value" data-venue="${venue}" data-key="takerMultiplier" type="number" min="0" max="100" step="0.01" value="${p.takerMultiplier}"></label>
      <label><span>Maker multiplier M</span><input class="fee-value" data-venue="${venue}" data-key="makerMultiplier" type="number" min="0" max="100" step="0.01" value="${p.makerMultiplier}"></label>
      <label><span>Entry liquidity</span><select class="fee-value" data-venue="${venue}" data-key="entryLiquidity"><option value="taker" ${p.entryLiquidity==='taker'?'selected':''}>Taker / immediate</option><option value="maker" ${p.entryLiquidity==='maker'?'selected':''}>Maker / resting</option></select></label>
      <label><span>Exit liquidity</span><select class="fee-value" data-venue="${venue}" data-key="exitLiquidity"><option value="taker" ${p.exitLiquidity==='taker'?'selected':''}>Taker / immediate</option><option value="maker" ${p.exitLiquidity==='maker'?'selected':''}>Maker / resting</option></select></label>
      <label class="formula-field"><span>Fee formula</span><input class="fee-value fee-formula-input" data-venue="${venue}" data-key="formula" type="text" value="${esc(p.formula)}"><small>Allowed variables: C = contracts/shares, p = execution price, rate = selected decimal rate, M = multiplier. Operators: + − × ÷ ^ and parentheses.</small></label>
      <label><span>Rounding</span><select class="fee-value" data-venue="${venue}" data-key="rounding">${roundingOptions.map(([v,l])=>`<option value="${v}" ${p.rounding===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <label><span>Fee rebate %</span><input class="fee-value" data-venue="${venue}" data-key="rebatePct" type="number" min="0" max="100" step="0.1" value="${p.rebatePct||0}"><small>Default 0. Use only if you actually expect a rebate.</small></label>
      <div class="fee-sample-box"><span>Sample · ${fmtNum(sampleC,2)} @ ${(sampleP*100).toFixed(1)}¢</span><strong>${error?'Formula error':`Taker ${fmtMoney(taker,4)} · Maker ${fmtMoney(maker,4)}`}</strong><small>${error?esc(error):`Effective preset date: ${p.effectiveDate || 'custom'}`}</small></div>
    </div>
  </section>`;
}

function renderFeeAnalytics() {
  if (!state.results) return `<section class="empty-subpanel"><strong>No completed run yet.</strong><p>Run the strategy first, then this tab will break out entry fees, exit fees, total fees, average fee/trade, and the ending-equity difference between fee-on and fee-off counterfactuals for both venues.</p></section>`;
  const rows = ['Kalshi','Polymarket'].map((venue) => {
    const net = resultFor(state.viewYears, venue, state.viewFill);
    const gross = grossResultFor(state.viewYears, venue, state.viewFill);
    const nm = net.metrics, gm = gross.metrics;
    return { venue, nm, gm, drag: gm.endingCapital - nm.endingCapital, returnDrag: gm.totalReturn - nm.totalReturn };
  });
  return `<section class="card"><div class="section-head"><div><span class="eyebrow">FEE ANALYTICS</span><h2>${state.viewYears}Y · ${state.viewFill} · current strategy</h2><p>“No fees” reruns the same strategy/fill/slippage with venue trading fees disabled. With dynamic sizing, ending-equity drag can differ from the literal fee sum because fees also change later position size/cash capacity.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Venue</th><th>Net return</th><th>No-fee return</th><th>Entry fees</th><th>Exit fees</th><th>Total fees</th><th>Avg fee/trade</th><th>Ending-equity drag</th></tr></thead><tbody>${rows.map(({venue,nm,gm,drag,returnDrag})=>`<tr><td><strong>${venue}</strong></td><td class="${nm.totalReturn>=0?'positive':'negative'}">${fmtPct(nm.totalReturn)}</td><td>${fmtPct(gm.totalReturn)}</td><td>${fmtMoney(nm.totalEntryFees,2)}</td><td>${fmtMoney(nm.totalExitFees,2)}</td><td><strong>${fmtMoney(nm.totalFees,2)}</strong></td><td>${fmtMoney(nm.avgFeePerTrade,3)}</td><td class="${drag>0?'negative':''}">${fmtMoney(drag,2)} · ${fmtPts(returnDrag)}</td></tr>`).join('')}</tbody></table></div>
    <div class="metric-grid four">${rows.map(({venue,nm})=>`<div class="metric-tile"><span>${venue} fees / gross cost</span><strong>${fmtPct(nm.feesPctGrossDeployed,2)}</strong><small>${fmtMoney(nm.totalFees,2)} total</small></div>`).join('')}<div class="metric-tile"><span>Fee state</span><strong>${state.fees.enabled?'ON':'OFF'}</strong><small>Master toggle applies to both venues</small></div><div class="metric-tile"><span>Historical regime</span><strong class="negative">Not versioned yet</strong><small>Current/custom presets only</small></div></div>
  </section>`;
}

function renderFeesPage() {
  return `<section class="page-stack fees-page">
    <section class="card fee-master-card"><div class="section-head inline"><div><span class="eyebrow">MASTER FEE MODEL</span><h2>Trading-fee engine</h2><p>Fees are cash charges calculated from each simulated execution price and quantity. They are separate from slippage. Turn them off for the explicit no-fee counterfactual.</p></div><label class="master-switch"><input id="fee-enabled" type="checkbox" ${state.fees.enabled?'checked':''}><span>${state.fees.enabled?'Fees ON':'Fees OFF'}</span></label></div>
      ${state.feeError?`<div class="truth-note error-note"><strong>Fee formula error:</strong> ${esc(state.feeError)}</div>`:''}
      <div class="control-grid three"><label><span>Sample contracts / shares</span><input id="fee-sample-contracts" type="number" min="0" step="1" value="${state.feeSample.contracts}"></label><label><span>Sample execution price</span><input id="fee-sample-price" type="number" min="0" max="1" step="0.001" value="${state.feeSample.price}"></label><div class="info-control"><span>Presets verified</span><strong>Current, not historical</strong><small>Kalshi July 7, 2026 schedule · Polymarket current crypto docs. Historical backtests still need date/market-specific fee metadata.</small></div></div>
      <div class="truth-note"><strong>Important:</strong> a 45¢ fill does not become 46.74¢ because “fee” is not price slippage. The engine debits the contract cost at the simulated fill, then separately debits the venue fee. Early-exit trades can incur a second trading fee on the exit; ordinary binary settlement does not.</div>
    </section>
    <div class="fee-venue-grid">${renderFeeVenueCard('Kalshi')}${renderFeeVenueCard('Polymarket')}</div>
    <section class="card"><div class="section-head"><div><span class="eyebrow">EXTRA CUSTOM COST</span><h2>Optional flat add-on</h2><p>Use only for an additional broker/FCM/platform fee not captured by the venue formula. Defaults to zero.</p></div></div><div class="control-grid two"><label><span>Extra entry ¢ / contract</span><input class="fee-root-value" data-key="extraEntryCentsPerContract" type="number" min="0" step="0.01" value="${state.fees.extraEntryCentsPerContract||0}"></label><label><span>Extra exit ¢ / contract</span><input class="fee-root-value" data-key="extraExitCentsPerContract" type="number" min="0" step="0.01" value="${state.fees.extraExitCentsPerContract||0}"></label></div></section>
    ${renderFeeAnalytics()}
  </section>`;
}

function renderSettingsPage() {
  return `<section class="page-stack"><section class="card"><div class="section-head"><div><span class="eyebrow">SOURCE DEFAULTS</span><h2>Backtest inputs</h2><p>Only controls that the current engine actually honors are editable here.</p></div></div><div class="control-grid three">${selectControl('data-value','btcSource','BTC source',state.dataSettings.btcSource,['Composite (Binance + Coinbase)','Binance','Coinbase'])}${selectControl('data-value','referenceMode','Reference mode',state.dataSettings.referenceMode,['Venue rule','BTC spot only (diagnostic)','Reference only when available'])}<label><span>Prediction source</span><select disabled><option>Both · demo rows</option></select><small class="field-note">The browser demo contains both venues; venue-specific production ingestion belongs in the backend.</small></label><label><span>Timestamp resolution</span><select disabled><option>Raw generated timestamps</option></select><small class="field-note">Aggregation should happen in the backend after raw ordering is preserved.</small></label>${numControl('data-value','largeFillSensitivityPts','Fill alert · win pts',state.dataSettings.largeFillSensitivityPts,0,50,.5)}${numControl('data-value','largeReturnSensitivityPct','Fill alert · return %',state.dataSettings.largeReturnSensitivityPct,0,100,1)}</div></section><section class="card"><div class="section-head"><div><span class="eyebrow">SESSION / FEATURE GUARDRAILS</span><h2>Not falsely editable</h2></div></div><div class="truth-note">Arbitrary VWAP sessions/confirmation bars, arbitrary EMA lengths/timeframes, L2 depth, realized-vol lookback and source-specific residual recomputation are not yet production raw-feature calculations. The factor catalog exposes the intended research vocabulary, but this preview does not pretend those advanced parameters are all independently recomputed from raw history.</div></section></section>`;
}

function renderMethodologyPage() {
  return `<section class="page-stack methodology"><section class="card"><span class="eyebrow">LOGIC</span><h2>Execution invariants in this local candidate</h2><ol><li>Ask is the conservative buy assumption; early exits use the executable sell side.</li><li>Repeat/limited re-entry means another cycle after the prior same-contract position closes. It does not silently pyramid overlapping positions.</li><li>A target exit cannot re-enter on the exact same observation.</li><li>Multiple contracts settling between sparse rows update Kelly history in chronological expiry order.</li><li>Explicit NO books are preferred over 1−YES reconstruction.</li><li>Selected Binance/Coinbase data fails closed rather than silently substituting the composite.</li><li>Settlement-specific reference studies fail closed when the exact requested reference field is unavailable.</li><li>Venue trading fees are cash debits calculated from simulated execution price and quantity; they are not folded into slippage. Early exits can pay another trading fee, while ordinary binary settlement does not.</li></ol></section><section class="card"><span class="eyebrow">CHART</span><h2>Animation semantics</h2><p>The complete result is computed first. X and Y domains are derived from every currently visible equity series before animation begins. The animation clips/reveals the already-computed paths; it does not rescale the axis from partial history and does not invent a smooth Bezier trajectory between observations. Net, no-fee, other-venue and drawdown lines can be toggled independently.</p></section><section class="card"><span class="eyebrow">EVIDENCE</span><h2>What this preview proves</h2><p>It proves the UI can drive the actual JavaScript backtest engine and display its returned trade/equity/metric objects. It does not prove a real edge because the current preview data is generated synthetically.</p></section></section>`;
}

function runParameterControls() {
  document.querySelectorAll('.factor-value').forEach((el)=>el.addEventListener('change',()=>{
    const f=state.factors.find((x)=>x.instanceId===el.dataset.factorId); if(!f)return;
    f.values[el.dataset.key]=el.type==='number'?Number(el.value):el.value; invalidateResults(); render();
  }));
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((b)=>b.addEventListener('click',()=>{state.tab=b.dataset.tab;render();}));
  document.querySelectorAll('[data-lens]').forEach((b)=>b.addEventListener('click',()=>{resetLens(b.dataset.lens);render();}));
  document.querySelectorAll('[data-join]').forEach((b)=>b.addEventListener('click',()=>{state.joinMode=b.dataset.join;invalidateResults();render();}));
  document.querySelector('#add-factor')?.addEventListener('click',()=>{const f=createFactor(document.querySelector('#add-factor-select').value);state.factors.push(f);setAutomaticExecutionSideForFactorChange({addedPriceRule:f.type==='pm_price'});invalidateResults();render();});
  document.querySelectorAll('.remove-factor').forEach((b)=>b.addEventListener('click',()=>{state.factors=state.factors.filter((f)=>f.instanceId!==b.dataset.factorId);setAutomaticExecutionSideForFactorChange();invalidateResults();render();}));
  document.querySelectorAll('.factor-type').forEach((el)=>el.addEventListener('change',()=>{const f=state.factors.find((x)=>x.instanceId===el.dataset.factorId);const wasPrice=f.type==='pm_price';const n=createFactor(el.value);f.type=n.type;f.values=n.values;setAutomaticExecutionSideForFactorChange({addedPriceRule:!wasPrice&&n.type==='pm_price'});invalidateResults();render();}));
  runParameterControls();
  document.querySelectorAll('.execution-value').forEach((el)=>el.addEventListener('change',()=>{state.execution[el.dataset.key]=el.type==='number'?Number(el.value):el.value;if(el.dataset.key==='tradeSide'&&state.execution.tradeSide==='AUTO'&&!hasPriceSideRule())state.execution.tradeSide='YES';invalidateResults();render();}));
  document.querySelectorAll('.risk-value').forEach((el)=>el.addEventListener('change',()=>{state.risk[el.dataset.key]=el.type==='number'?Number(el.value):el.value;invalidateResults();render();}));
  document.querySelectorAll('.data-value').forEach((el)=>el.addEventListener('change',()=>{state.dataSettings[el.dataset.key]=el.type==='number'?Number(el.value):el.value;invalidateResults();render();}));
  document.querySelector('#fee-enabled')?.addEventListener('change',(e)=>{state.fees.enabled=e.target.checked;state.feeError=null;invalidateResults();render();});
  document.querySelectorAll('.fee-value').forEach((el)=>el.addEventListener('change',()=>{
    const profile=state.fees.profiles[el.dataset.venue];if(!profile)return;
    profile[el.dataset.key]=el.type==='number'?Number(el.value):el.value;
    const check=validateFeeProfile(profile);state.feeError=check.valid?null:`${el.dataset.venue}: ${check.error}`;
    invalidateResults();render();
  }));
  document.querySelectorAll('.fee-root-value').forEach((el)=>el.addEventListener('change',()=>{state.fees[el.dataset.key]=Number(el.value)||0;invalidateResults();render();}));
  document.querySelectorAll('.reset-fee-preset').forEach((b)=>b.addEventListener('click',()=>{resetVenueFeePreset(state.fees,b.dataset.venue);state.feeError=null;invalidateResults();render();}));
  document.querySelector('#fee-sample-contracts')?.addEventListener('change',(e)=>{state.feeSample.contracts=Math.max(0,Number(e.target.value)||0);render();});
  document.querySelector('#fee-sample-price')?.addEventListener('change',(e)=>{state.feeSample.price=clamp(Number(e.target.value)||0,0,1);render();});
  document.querySelector('#seed-input')?.addEventListener('change',(e)=>{state.seed=Number(e.target.value)||42;state.data=generateDemoDataset(3,state.seed);invalidateResults();render();});
  document.querySelector('#run-backtest')?.addEventListener('click',executeAll);
  document.querySelectorAll('.period-btn').forEach((b)=>b.addEventListener('click',()=>{state.viewYears=Number(b.dataset.years);state.run.reveal=1;state.chartHoverIndex=null;render();}));
  document.querySelectorAll('.venue-btn').forEach((b)=>b.addEventListener('click',()=>{state.viewVenue=b.dataset.venue;state.run.reveal=1;state.chartHoverIndex=null;render();}));
  document.querySelectorAll('.fill-btn').forEach((b)=>b.addEventListener('click',()=>{state.viewFill=b.dataset.fill;state.run.reveal=1;state.chartHoverIndex=null;render();}));
  document.querySelectorAll('[data-chart-line]').forEach((el)=>el.addEventListener('change',()=>{state.chartLines[el.dataset.chartLine]=el.checked;state.chartHoverIndex=null;drawEquityChart();}));
  document.querySelectorAll('[data-line-info]').forEach((b)=>b.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();state.chartInfo=b.dataset.lineInfo;render();}));
  document.querySelector('#close-chart-info')?.addEventListener('click',()=>{state.chartInfo=null;render();});
  document.querySelector('#toggle-fill-details')?.addEventListener('click',()=>{state.showFillDetails=!state.showFillDetails;render();});
  document.querySelectorAll('.advanced-card').forEach((d)=>d.addEventListener('toggle',()=>{state.showAdvanced=d.open;}));
  bindChartHover();

  document.querySelector('#sweep-factor')?.addEventListener('change',(e)=>{state.sweep.factorId=e.target.value;const f=state.factors.find(x=>x.instanceId===state.sweep.factorId);const field=numericSweepFields(f)[0]||null;state.sweep.fieldKey=field?.key||null;if(field)setSweepDefaults(f,field);state.sweep.result=null;render();});
  document.querySelector('#sweep-field')?.addEventListener('change',(e)=>{state.sweep.fieldKey=e.target.value;const f=state.factors.find(x=>x.instanceId===state.sweep.factorId);const field=sweepFieldMeta(f);if(field)setSweepDefaults(f,field);render();});
  document.querySelector('#sweep-venue')?.addEventListener('change',(e)=>{state.sweep.venue=e.target.value;state.sweep.result=null;});
  document.querySelector('#sweep-metric')?.addEventListener('change',(e)=>{state.sweep.metric=e.target.value;if(state.sweep.result)render();});
  document.querySelector('#sweep-years')?.addEventListener('change',(e)=>{state.sweep.years=Number(e.target.value);state.sweep.result=null;});
  document.querySelector('#sweep-fill')?.addEventListener('change',(e)=>{state.sweep.fill=e.target.value;state.sweep.result=null;});
  document.querySelector('#sweep-start')?.addEventListener('change',(e)=>state.sweep.start=Number(e.target.value));
  document.querySelector('#sweep-end')?.addEventListener('change',(e)=>state.sweep.end=Number(e.target.value));
  document.querySelector('#sweep-step')?.addEventListener('change',(e)=>state.sweep.step=Number(e.target.value));
  document.querySelector('#reset-sweep-range')?.addEventListener('click',()=>{const f=state.factors.find(x=>x.instanceId===state.sweep.factorId);const field=sweepFieldMeta(f);if(field)setSweepDefaults(f,field);render();});
  document.querySelector('#run-sweep')?.addEventListener('click',runSweep);

  document.querySelector('#disc-threshold')?.addEventListener('change',(e)=>{state.discrepancy.threshold=Number(e.target.value);render();});
  document.querySelector('#disc-horizon')?.addEventListener('change',(e)=>{state.discrepancy.horizon=e.target.value;render();});
  document.querySelector('#data-seed')?.addEventListener('change',(e)=>state.seed=Number(e.target.value)||42);
  document.querySelector('#regenerate-data')?.addEventListener('click',()=>{state.data=generateDemoDataset(3,state.seed);invalidateResults();render();});
  document.querySelector('#reset-app')?.addEventListener('click',()=>{Object.assign(state.execution,{...defaultExecutionSettings});Object.assign(state.risk,{...defaultRiskSettings,sizingMode:'fixed_contracts'});Object.assign(state.dataSettings,{...defaultDataSettings});state.fees=cloneFeeSettings(defaultFeeSettings);state.feeSample={contracts:100,price:.45};state.seed=42;state.data=generateDemoDataset(3,42);state.tab='test';resetLens('prediction');render();});
  document.querySelector('#export-strategy')?.addEventListener('click',exportStrategy);
}

function exportStrategy() {
  const payload = { exportedAt:new Date().toISOString(), note:'Local UI candidate. Synthetic demo data is not included.', joinMode:state.joinMode, factors:state.factors, execution:state.execution, risk:state.risk, feeSettings:state.fees, dataSettings:state.dataSettings };
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download='btc-lab-strategy.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}

function downsample(points, max=1000) {
  if (!points || points.length<=max) return points || [];
  const step=Math.ceil(points.length/max);return points.filter((_,i)=>i%step===0||i===points.length-1);
}
function alignedPointAt(points, targetTs) {
  if (!points?.length) return null;
  let lo=0,hi=points.length-1,best=points[0];
  while(lo<=hi){const mid=(lo+hi)>>1,ts=Date.parse(points[mid].timestamp);if(ts<=targetTs){best=points[mid];lo=mid+1}else hi=mid-1;}return best;
}
function drawEquityChart() {
  const canvas = document.querySelector('#equity-chart');
  if (!canvas || !state.results) return;
  const netResult = resultFor();
  const grossResult = grossResultFor();
  const otherVenue = state.viewVenue === 'Kalshi' ? 'Polymarket' : 'Kalshi';
  const otherResult = resultFor(state.viewYears, otherVenue, state.viewFill);
  const base = downsample(netResult.equity, 1100);
  if (base.length < 2) return;

  const series = [];
  if (state.chartLines.net) series.push({ key:'net', points:downsample(netResult.equity,1100), color:'#66e0b5', width:2.2, fill:true });
  if (state.chartLines.gross) series.push({ key:'gross', points:downsample(grossResult.equity,1100), color:'#f2c069', width:1.7, fill:false });
  if (state.chartLines.other) series.push({ key:'other', points:downsample(otherResult.equity,1100), color:'#67bff5', width:1.45, fill:false });

  const shell = canvas.parentElement;
  const w = Math.max(320, Math.floor(shell.getBoundingClientRect().width));
  const h = Math.max(360, Math.floor(shell.getBoundingClientRect().height));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);

  const pad={l:108,r:22,t:28,b:34};
  const ddEnabled = Boolean(state.chartLines.drawdown);
  const ddH = ddEnabled ? 78 : 0;
  const gap = ddEnabled ? 20 : 0;
  const eqBottom = h - pad.b - ddH - gap;
  const eqTop = pad.t;
  const axisSeries = series.length ? series : [{ points: base }];
  const allValues = axisSeries.flatMap((line)=>line.points.map((p)=>p.equity));
  let min=Math.min(...allValues),max=Math.max(...allValues);
  const span=Math.max(1,max-min);min-=span*.08;max+=span*.08;
  const startTs=Date.parse(base[0].timestamp),endTs=Date.parse(base[base.length-1].timestamp);
  const xTs=(ts)=>pad.l+(ts-startTs)/Math.max(1,endTs-startTs)*(w-pad.l-pad.r);
  const y=(v)=>eqTop+(max-v)/Math.max(1e-12,max-min)*(eqBottom-eqTop);
  const revealEndTs=startTs+clamp(state.run.reveal,0,1)*(endTs-startTs);

  ctx.font='11px ui-sans-serif,system-ui';ctx.textBaseline='middle';
  for(let g=0;g<5;g++){
    const f=g/4,yy=eqTop+f*(eqBottom-eqTop),val=max-f*(max-min);
    ctx.strokeStyle='rgba(150,170,184,.10)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();
    ctx.fillStyle='rgba(175,191,201,.68)';ctx.textAlign='right';const ret=(val/Number(state.risk.startingCapital)-1)*100;ctx.fillText(`${fmtMoney(val,0)}  ${ret>=0?'+':''}${ret.toFixed(1)}%`,pad.l-9,yy);
  }
  [0,.5,1].forEach((f)=>{const xx=pad.l+f*(w-pad.l-pad.r),ts=startTs+f*(endTs-startTs);ctx.fillStyle='rgba(175,191,201,.62)';ctx.textAlign=f===0?'left':f===1?'right':'center';ctx.fillText(fmtDate(ts),xx,h-12);});

  function drawPath(line) {
    const points=line.points.filter((p)=>Date.parse(p.timestamp)<=revealEndTs);
    if(points.length<2)return;
    ctx.beginPath();
    points.forEach((p,i)=>{const xx=xTs(Date.parse(p.timestamp)),yy=y(p.equity);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});
    if(line.fill){
      const last=points[points.length-1];ctx.lineTo(xTs(Date.parse(last.timestamp)),eqBottom);ctx.lineTo(xTs(Date.parse(points[0].timestamp)),eqBottom);ctx.closePath();
      const grad=ctx.createLinearGradient(0,eqTop,0,eqBottom);grad.addColorStop(0,'rgba(93,220,177,.13)');grad.addColorStop(1,'rgba(93,220,177,0)');ctx.fillStyle=grad;ctx.fill();
      ctx.beginPath();points.forEach((p,i)=>{const xx=xTs(Date.parse(p.timestamp)),yy=y(p.equity);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});
    }
    ctx.strokeStyle=line.color;ctx.lineWidth=line.width;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
  }
  // Draw comparisons first so the selected net path remains visually dominant.
  series.filter((l)=>l.key!=='net').forEach(drawPath);
  series.filter((l)=>l.key==='net').forEach(drawPath);

  let peak=-Infinity;
  const dd=base.map((p)=>{peak=Math.max(peak,p.equity);return peak>0?p.equity/peak-1:0;});
  let ddy=null,ddTop=null,ddBottom=null;
  if(ddEnabled){
    const minDd=Math.min(-.001,...dd),ddT=eqBottom+gap,ddB=h-pad.b;ddTop=ddT;ddBottom=ddB;
    ddy=(v)=>ddT+((0-v)/(0-minDd))*(ddB-ddT);
    ctx.fillStyle='rgba(175,191,201,.55)';ctx.textAlign='right';ctx.fillText('DD',pad.l-9,ddT+5);ctx.fillText(`${(minDd*100).toFixed(1)}%`,pad.l-9,ddB-3);
    ctx.strokeStyle='rgba(255,122,139,.72)';ctx.lineWidth=1.2;ctx.beginPath();let begun=false;
    base.forEach((p,i)=>{const ts=Date.parse(p.timestamp);if(ts>revealEndTs)return;const xx=xTs(ts),yy=ddy(dd[i]);if(!begun){ctx.moveTo(xx,yy);begun=true}else ctx.lineTo(xx,yy);});ctx.stroke();
    ctx.strokeStyle='rgba(150,170,184,.10)';ctx.beginPath();ctx.moveTo(pad.l,ddT);ctx.lineTo(w-pad.r,ddT);ctx.stroke();
  }

  const visibleBase=base.filter((p)=>Date.parse(p.timestamp)<=revealEndTs);
  const endPoint=visibleBase[visibleBase.length-1];
  if(endPoint&&state.chartLines.net){ctx.fillStyle='#66e0b5';ctx.beginPath();ctx.arc(xTs(Date.parse(endPoint.timestamp)),y(endPoint.equity),3.5,0,Math.PI*2);ctx.fill();}
  canvas._chart={base,series,pad,w,h,eqTop,eqBottom,min,max,xTs,y,visibleBase,dd,ddy,ddTop,ddBottom,startTs,endTs,revealEndTs};
  if(state.chartHoverIndex!==null) drawHoverOverlay(canvas,state.chartHoverIndex);
}
function drawHoverOverlay(canvas,index){
  const m=canvas._chart;if(!m||!m.visibleBase.length)return;
  const i=clamp(index,0,m.visibleBase.length-1),p=m.visibleBase[i],ts=Date.parse(p.timestamp),xx=m.xTs(ts),ctx=canvas.getContext('2d');
  ctx.save();ctx.strokeStyle='rgba(220,235,241,.24)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,m.eqTop);ctx.lineTo(xx,m.h-34);ctx.stroke();
  const chosen=state.chartLines.net?alignedPointAt(resultFor().equity,ts):state.chartLines.gross?alignedPointAt(grossResultFor().equity,ts):p;
  if(chosen){ctx.fillStyle='#f3fbf8';ctx.beginPath();ctx.arc(xx,m.y(chosen.equity),4,0,Math.PI*2);ctx.fill();}ctx.restore();
}
function bindChartHover(){
  const shell=document.querySelector('#equity-chart-shell'),canvas=document.querySelector('#equity-chart'),tip=document.querySelector('#chart-tooltip');if(!shell||!canvas||!tip)return;
  let hoverRaf=null,lastX=null;
  const update=(clientX)=>{
    const m=canvas._chart;if(!m||!m.visibleBase.length)return;
    const r=canvas.getBoundingClientRect(),localX=clientX-r.left,fraction=clamp((localX-m.pad.l)/(m.w-m.pad.l-m.pad.r),0,1);
    const targetTs=m.startTs+fraction*(m.endTs-m.startTs);
    let idx=0;for(let i=1;i<m.visibleBase.length;i++){if(Math.abs(Date.parse(m.visibleBase[i].timestamp)-targetTs)<Math.abs(Date.parse(m.visibleBase[idx].timestamp)-targetTs))idx=i;else if(Date.parse(m.visibleBase[i].timestamp)>targetTs)break;}
    state.chartHoverIndex=idx;drawEquityChart();
    const updated=canvas._chart,p=updated?.visibleBase[idx];if(!p)return;const ts=Date.parse(p.timestamp);
    const net=alignedPointAt(resultFor().equity,ts),gross=alignedPointAt(grossResultFor().equity,ts),otherVenue=state.viewVenue==='Kalshi'?'Polymarket':'Kalshi',other=alignedPointAt(resultFor(state.viewYears,otherVenue,state.viewFill).equity,ts);
    let peak=-Infinity;for(const q of resultFor().equity){if(Date.parse(q.timestamp)>ts)break;peak=Math.max(peak,q.equity);}const dd=net&&peak>0?net.equity/peak-1:0;
    const lines=[];if(state.chartLines.net&&net)lines.push(`<span>Net ${fmtMoney(net.equity,0)}</span>`);if(state.chartLines.gross&&gross)lines.push(`<span>No fees ${fmtMoney(gross.equity,0)}</span>`);if(state.chartLines.other&&other)lines.push(`<span>${otherVenue} ${fmtMoney(other.equity,0)}</span>`);
    tip.innerHTML=`<strong>${new Date(ts).toLocaleString()}</strong>${lines.join('')}<small>${state.chartLines.drawdown?`Net DD ${fmtPct(dd)} · `:''}fixed chart scale</small>`;tip.style.opacity='1';tip.style.left=`${clamp(updated.xTs(ts),125,updated.w-130)}px`;tip.style.top=`${clamp(updated.y((net||gross||p).equity)-14,36,updated.eqBottom-20)}px`;
  };
  const schedule=(clientX)=>{lastX=clientX;if(hoverRaf)return;hoverRaf=requestAnimationFrame(()=>{hoverRaf=null;update(lastX);});};
  shell.addEventListener('mousemove',(e)=>schedule(e.clientX));shell.addEventListener('click',(e)=>update(e.clientX));shell.addEventListener('mouseleave',()=>{if(hoverRaf)cancelAnimationFrame(hoverRaf);hoverRaf=null;state.chartHoverIndex=null;tip.style.opacity='0';drawEquityChart();});
}

function updateLiveEndpoint(){if(!state.results)return;const result=resultFor(),points=downsample(result.equity,1100),idx=Math.min(points.length-1,Math.max(0,Math.floor((points.length-1)*state.run.reveal))),eq=points[idx]?.equity??Number(state.risk.startingCapital),start=Number(state.risk.startingCapital),pnl=eq-start,ret=eq/start-1;const e=document.querySelector('#live-ending-equity'),r=document.querySelector('#live-ending-return');if(e)e.textContent=fmtMoney(eq,0);if(r){r.textContent=`${pnl>=0?'+':''}${fmtMoney(pnl,0)} · ${ret>=0?'+':''}${fmtPct(ret)}`;r.className=pnl>=0?'positive':'negative';}}

function drawSweepChart(){
  const canvas=document.querySelector('#sweep-chart'),points=state.sweep.result;if(!canvas||!points?.length)return;
  const shell=canvas.parentElement,w=Math.max(320,Math.floor(shell.clientWidth)),h=Math.max(220,Math.floor(shell.clientHeight)),dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const metric=sweepMetricConfig(),eligible=points.filter(p=>p.trades>0&&Number.isFinite(Number(p[metric.key]))),pad={l:68,r:20,t:24,b:42};
  if(!eligible.length){ctx.fillStyle='rgba(175,191,201,.65)';ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText('No tested parameter value produced a completed trade.',w/2,h/2);return;}
  const xMin=Math.min(...points.map(p=>p.value)),xMax=Math.max(...points.map(p=>p.value));let min=Math.min(...eligible.map(p=>Number(p[metric.key]))),max=Math.max(...eligible.map(p=>Number(p[metric.key])));const span=Math.max(metric.key.includes('Roi')||metric.key==='totalReturn'?0.005:0.01,max-min||0);min-=span*.12;max+=span*.12;
  const x=v=>pad.l+(v-xMin)/Math.max(1e-12,xMax-xMin)*(w-pad.l-pad.r),y=v=>pad.t+(max-v)/Math.max(1e-12,max-min)*(h-pad.t-pad.b);
  ctx.font='10px system-ui';ctx.textBaseline='middle';for(let g=0;g<4;g++){const yy=pad.t+g/3*(h-pad.t-pad.b),v=max-g/3*(max-min);ctx.strokeStyle='rgba(150,170,184,.1)';ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();ctx.fillStyle='rgba(175,191,201,.65)';ctx.textAlign='right';ctx.fillText(metric.format(v),pad.l-8,yy);}
  if(min<0&&max>0){ctx.strokeStyle='rgba(230,235,239,.28)';ctx.beginPath();ctx.moveTo(pad.l,y(0));ctx.lineTo(w-pad.r,y(0));ctx.stroke();}
  const selected=state.factors.find(f=>f.instanceId===state.sweep.factorId),current=Number(selected?.values?.[state.sweep.fieldKey]);if(Number.isFinite(current)&&current>=xMin&&current<=xMax){ctx.strokeStyle='rgba(242,192,105,.55)';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x(current),pad.t);ctx.lineTo(x(current),h-pad.b);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(242,192,105,.8)';ctx.textAlign='center';ctx.fillText('current',x(current),pad.t-9);}
  ctx.strokeStyle='#66e0b5';ctx.lineWidth=2;ctx.beginPath();let drawing=false;points.forEach((p)=>{if(!p.trades||!Number.isFinite(Number(p[metric.key]))){drawing=false;return;}const xx=x(p.value),yy=y(Number(p[metric.key]));if(!drawing){ctx.moveTo(xx,yy);drawing=true;}else ctx.lineTo(xx,yy);});ctx.stroke();
  points.forEach((p)=>{const xx=x(p.value);if(!p.trades){ctx.strokeStyle='rgba(175,191,201,.38)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,h-pad.b-4);ctx.lineTo(xx,h-pad.b+4);ctx.stroke();return;}ctx.fillStyle='#66e0b5';ctx.beginPath();ctx.arc(xx,y(Number(p[metric.key])),2.6,0,Math.PI*2);ctx.fill();});
  [0,.25,.5,.75,1].forEach(f=>{const v=xMin+f*(xMax-xMin),xx=x(v);ctx.fillStyle='rgba(175,191,201,.65)';ctx.textAlign=f===0?'left':f===1?'right':'center';ctx.fillText(fmtNum(v,4),xx,h-14);});
  document.querySelectorAll('#sweep-heat i').forEach((el)=>{const trades=Number(el.dataset.trades),v=Number(el.dataset.score);if(!trades||!Number.isFinite(v)){el.style.background='rgba(175,191,201,.12)';return;}const t=clamp((v-min)/Math.max(1e-12,max-min),0,1);el.style.background=t>.62?`rgba(102,224,181,${.25+t*.65})`:t>.38?`rgba(242,192,105,${.22+t*.55})`:`rgba(255,122,139,${.28+(1-t)*.55})`;});
}

function discrepancyRows(){return state.data.filter(r=>r.marketHorizon===state.discrepancy.horizon&&Number.isFinite(r.kalshiYesMid)&&Number.isFinite(r.polyYesMid));}
function drawDiscrepancyChart(){const canvas=document.querySelector('#discrepancy-chart');if(!canvas)return;const rows=discrepancyRows();if(rows.length<2)return;const shell=canvas.parentElement,w=Math.max(320,Math.floor(shell.clientWidth)),h=Math.max(220,Math.floor(shell.clientHeight)),dpr=devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);const pad={l:58,r:18,t:20,b:28},vals=rows.map(x=>x.kalshiYesMid-x.polyYesMid),maxAbs=Math.max(state.discrepancy.threshold*1.2,...vals.map(Math.abs),.01),x=i=>pad.l+i/(rows.length-1)*(w-pad.l-pad.r),y=v=>pad.t+(maxAbs-v)/(2*maxAbs)*(h-pad.t-pad.b);for(const t of [-state.discrepancy.threshold,0,state.discrepancy.threshold]){ctx.strokeStyle=t===0?'rgba(230,235,239,.26)':'rgba(242,192,105,.25)';ctx.setLineDash(t===0?[]:[4,4]);ctx.beginPath();ctx.moveTo(pad.l,y(t));ctx.lineTo(w-pad.r,y(t));ctx.stroke();ctx.setLineDash([]);}ctx.strokeStyle='#67bff5';ctx.lineWidth=1.45;ctx.beginPath();vals.forEach((v,i)=>{if(i===0)ctx.moveTo(x(i),y(v));else ctx.lineTo(x(i),y(v));});ctx.stroke();ctx.font='10px system-ui';ctx.fillStyle='rgba(175,191,201,.65)';ctx.textAlign='right';ctx.fillText(`${(maxAbs*100).toFixed(1)} pts`,pad.l-7,pad.t+3);ctx.fillText(`${(-maxAbs*100).toFixed(1)} pts`,pad.l-7,h-pad.b-3);}

window.addEventListener('resize',()=>{if(state.tab==='test')drawEquityChart();if(state.tab==='robustness')drawSweepChart();if(state.tab==='discrepancy')drawDiscrepancyChart();});

state.data = generateDemoDataset(3, state.seed);
resetLens('prediction');
render();
