const app = document.querySelector('#app');
let preferredFill = 'ask';
let applying = false;

function labelFor(control) {
  return control?.closest('label')?.querySelector(':scope > span') || null;
}

function appendNote(container, key, text) {
  if (!container || container.querySelector(`[data-guardrail-note="${key}"]`)) return;
  const note = document.createElement('small');
  note.dataset.guardrailNote = key;
  note.textContent = text;
  note.style.display = 'block';
  note.style.marginTop = '5px';
  note.style.color = 'var(--muted)';
  note.style.fontSize = '8px';
  note.style.lineHeight = '1.45';
  container.appendChild(note);
}

function applyVersion() {
  document.querySelectorAll('.top-actions .pill.subtle').forEach((badge) => {
    if (/^v\d/i.test(badge.textContent.trim())) badge.textContent = 'v0.5';
  });
}

function applyEntryObservation() {
  const selector = document.querySelector('.execution-value[data-key="entryObservation"]');
  if (selector) {
    const label = labelFor(selector);
    if (label) label.textContent = 'Displayed primary result';
    appendNote(
      selector.closest('label'),
      'entry-observation',
      'All three variants still run. This control chooses which completed result is shown first; ask remains the default.'
    );
    preferredFill = selector.value || preferredFill;
  }

  const preferredButton = document.querySelector(`[data-fill="${preferredFill}"]`);
  if (preferredButton && !preferredButton.classList.contains('active')) {
    preferredButton.click();
  }
}

function applyPredictionSourceTruth() {
  const selector = document.querySelector('.data-setting[data-key="predictionSource"]');
  if (!selector) return;
  selector.value = 'Both';
  selector.disabled = true;
  const label = labelFor(selector);
  if (label) label.textContent = 'Prediction data (browser demo)';
  appendNote(
    selector.closest('label'),
    'prediction-source',
    'The browser demo intentionally compares Kalshi and Polymarket together. Real normalized backend studies are venue-specific and can be run on either source independently.'
  );
}

function applyTimestampTruth() {
  const selector = document.querySelector('.data-setting[data-key="timestampResolution"]');
  if (!selector) return;
  selector.value = 'Raw timestamps';
  selector.disabled = true;
  const label = labelFor(selector);
  if (label) label.textContent = 'Browser demo timestamp mode';
  appendNote(
    selector.closest('label'),
    'timestamp-resolution',
    'Raw/native timestamps are preserved first. 100 ms / 1 s / 1 m aggregation belongs in the normalized backend and is not simulated by this browser control.'
  );
}

function applyKellyTruth() {
  const edge = document.querySelector('.risk-value[data-key="minEdgePct"]');
  if (!edge) return;
  const sizing = document.querySelector('.risk-value[data-key="sizingMode"]');
  const isKelly = sizing?.value === 'kelly';
  edge.disabled = !isKelly;
  const label = labelFor(edge);
  if (label) label.textContent = 'Kelly min posterior edge (pts)';
  appendNote(
    edge.closest('label'),
    'kelly-edge',
    isKelly
      ? 'Applied to the posterior probability estimate used by expiry-only Kelly sizing.'
      : 'Not applied to fixed-percentage sizing; disabled here to avoid implying otherwise.'
  );
}

function applyEarlyExitAdvisorTruth() {
  const exitMode = document.querySelector('.execution-value[data-key="exitMode"]')?.value;
  const card = document.querySelector('.assistant-card');
  if (!card || !exitMode || exitMode === 'expiry') return;
  if (card.dataset.earlyExitGuardrail === exitMode) return;
  card.dataset.earlyExitGuardrail = exitMode;
  card.classList.remove('good', 'bad');
  card.classList.add('warn');
  card.innerHTML = `
    <div class="card-head"><div><strong>Early-exit robustness guardrail</strong><span>Settlement probability edge is not the acceptance rule for target/stop/time exits</span></div></div>
    <p>For this exit mode, realized payoff distribution matters more than settlement win rate minus entry cost. Evaluate total return, average P/L, profit factor, drawdown, trade count and ask-vs-last/midpoint sensitivity. The browser will not label an early-exit idea good or bad solely from the binary settlement-edge statistic.</p>
  `;
}

function applyResidualTruth() {
  document.querySelectorAll('.factor-card').forEach((card) => {
    const factorType = card.querySelector('.factor-type');
    if (factorType?.value !== 'pm_residual') return;
    appendNote(
      card,
      'pm-residual',
      'Demo residual values are precomputed features. Source-specific residual recomputation must come from the normalized feature engine before Binance/Coinbase residual comparisons are treated as production-valid.'
    );
  });
}

function applyFeatureEngineTruth() {
  const pending = new Set(['vwap_setup', 'ema_cross', 'pm_book_imbalance', 'realized_vol']);
  document.querySelectorAll('.factor-card').forEach((card) => {
    const type = card.querySelector('.factor-type')?.value;
    if (!pending.has(type)) return;
    appendNote(
      card,
      `feature-${type}`,
      'Some advanced parameter fields for this factor are demo/precomputed-feature controls. Production raw-data recomputation is tracked separately and is not implied by the synthetic test.'
    );
  });
}

function applyAll() {
  if (applying) return;
  applying = true;
  try {
    applyVersion();
    applyEntryObservation();
    applyPredictionSourceTruth();
    applyTimestampTruth();
    applyKellyTruth();
    applyEarlyExitAdvisorTruth();
    applyResidualTruth();
    applyFeatureEngineTruth();
  } finally {
    applying = false;
  }
}

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
  if (target.matches('.execution-value[data-key="entryObservation"]')) {
    preferredFill = target.value || 'ask';
    queueMicrotask(applyAll);
  }
  if (target.matches('.risk-value[data-key="sizingMode"], .execution-value[data-key="exitMode"]')) {
    queueMicrotask(applyAll);
  }
}, true);

const observer = new MutationObserver(() => queueMicrotask(applyAll));
if (app) observer.observe(app, { childList: true, subtree: true });
applyAll();
