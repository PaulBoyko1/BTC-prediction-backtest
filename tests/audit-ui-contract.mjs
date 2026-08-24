import assert from 'node:assert/strict';
import '../src/auditPreload.js';
import { factorCatalog } from '../src/catalog.js';

const forbidden = new Set([
  'pm_book_imbalance.depthLevels',
  'vwap_setup.session',
  'vwap_setup.confirmationBars',
  'ema_cross.fast',
  'ema_cross.slow',
  'ema_cross.timeframe',
  'realized_vol.lookbackMinutes',
]);
for (const factor of factorCatalog) for (const field of factor.fields) {
  assert.ok(!forbidden.has(`${factor.id}.${field.key}`), `${factor.id}.${field.key} must not be exposed until raw recomputation exists`);
}
assert.ok(!factorCatalog.some((factor) => factor.id === 'pm_residual'), 'legacy generic residual factor must be hidden until BTC-source-aware production logic exists');
console.log('Browser capability-gate audit passed.');
