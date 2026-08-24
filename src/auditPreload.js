import { factorCatalog } from './catalog.js';

// Browser capability gate: do not expose controls that the current browser
// engine cannot independently recompute from raw data. Keeping them visible
// would make parameter sweeps appear meaningful when the underlying feature is
// actually a single precomputed value.
const unsupportedFields = {
  pm_book_imbalance: new Set(['depthLevels']),
  vwap_setup: new Set(['session', 'confirmationBars']),
  ema_cross: new Set(['fast', 'slow', 'timeframe']),
  realized_vol: new Set(['lookbackMinutes']),
};

for (const factor of factorCatalog) {
  const blocked = unsupportedFields[factor.id];
  if (blocked) factor.fields = factor.fields.filter((field) => !blocked.has(field.key));
}

// Source-specific residual fields exist in the synthetic rows, but the current
// committed runBacktest factor still reads the legacy generic residual. Hide the
// factor until the engine is source-aware rather than letting BTC-source changes
// silently leave the residual test unchanged.
const residualIndex = factorCatalog.findIndex((factor) => factor.id === 'pm_residual');
if (residualIndex >= 0) factorCatalog.splice(residualIndex, 1);
