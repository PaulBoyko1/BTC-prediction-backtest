const EPS = 1e-12;

export const OFFICIAL_FEE_PRESETS = {
  Kalshi: {
    label: 'Kalshi BTC 15m · current general event-contract preset',
    effectiveDate: '2026-07-07',
    takerRatePct: 7,
    makerRatePct: 1.75,
    takerMultiplier: 1,
    makerMultiplier: 0,
    formula: 'M*rate*C*p*(1-p)',
    rounding: 'kalshi_balance_cent',
    entryLiquidity: 'taker',
    exitLiquidity: 'taker',
    rebatePct: 0,
    sourceNote: 'KXBTC15M is not listed among July 7, 2026 non-standard fee series. General taker multiplier defaults to 1; maker multiplier defaults to 0 unless otherwise indicated.',
  },
  Polymarket: {
    label: 'Polymarket crypto · current preset',
    effectiveDate: '2026-08-23',
    takerRatePct: 7,
    makerRatePct: 0,
    takerMultiplier: 1,
    makerMultiplier: 1,
    formula: 'rate*C*p*(1-p)',
    rounding: 'round_5dp',
    entryLiquidity: 'taker',
    exitLiquidity: 'taker',
    rebatePct: 0,
    sourceNote: 'Crypto takers pay the market fee; makers are not charged. Taker rebate programs are not assumed unless you explicitly enter a rebate percentage.',
  },
};

export const defaultFeeSettings = {
  enabled: true,
  extraEntryCentsPerContract: 0,
  extraExitCentsPerContract: 0,
  profiles: {
    Kalshi: { ...OFFICIAL_FEE_PRESETS.Kalshi },
    Polymarket: { ...OFFICIAL_FEE_PRESETS.Polymarket },
  },
};

export function cloneFeeSettings(settings = defaultFeeSettings) {
  return {
    ...settings,
    profiles: {
      Kalshi: { ...OFFICIAL_FEE_PRESETS.Kalshi, ...(settings.profiles?.Kalshi || {}) },
      Polymarket: { ...OFFICIAL_FEE_PRESETS.Polymarket, ...(settings.profiles?.Polymarket || {}) },
    },
  };
}

export function resetVenueFeePreset(settings, venue) {
  if (!settings?.profiles || !OFFICIAL_FEE_PRESETS[venue]) return;
  settings.profiles[venue] = { ...OFFICIAL_FEE_PRESETS[venue] };
}

function tokenize(expression) {
  const text = String(expression || '').trim();
  if (!text) throw new Error('Fee formula is empty.');
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j])) {
        const candidate = text.slice(i, j + 1);
        if (!/^\d*\.?\d*(?:[eE][+-]?\d*)?$/.test(candidate)) break;
        j += 1;
      }
      const raw = text.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Invalid number “${raw}”.`);
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      const name = text.slice(i, j);
      if (!['C', 'p', 'rate', 'M'].includes(name)) throw new Error(`Unknown variable “${name}”. Use C, p, rate, or M.`);
      tokens.push({ type: 'var', value: name });
      i = j;
      continue;
    }
    if ('+-*/^()'.includes(ch)) {
      tokens.push({ type: ch, value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unsupported character “${ch}”.`);
  }
  return tokens;
}

function evaluateTokens(tokens, vars) {
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (type) => {
    const token = tokens[pos];
    if (!token || (type && token.type !== type)) throw new Error(`Expected ${type || 'token'} in fee formula.`);
    pos += 1;
    return token;
  };
  function primary() {
    const token = peek();
    if (!token) throw new Error('Unexpected end of fee formula.');
    if (token.type === 'number') return take().value;
    if (token.type === 'var') return Number(vars[take().value]);
    if (token.type === '(') {
      take('(');
      const value = expression();
      take(')');
      return value;
    }
    if (token.type === '+') { take('+'); return primary(); }
    if (token.type === '-') { take('-'); return -primary(); }
    throw new Error(`Unexpected token “${token.value}”.`);
  }
  function power() {
    let value = primary();
    if (peek()?.type === '^') { take('^'); value = value ** power(); }
    return value;
  }
  function term() {
    let value = power();
    while (['*', '/'].includes(peek()?.type)) {
      const op = take().type;
      const rhs = power();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }
  function expression() {
    let value = term();
    while (['+', '-'].includes(peek()?.type)) {
      const op = take().type;
      const rhs = term();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  const result = expression();
  if (pos !== tokens.length) throw new Error(`Unexpected token “${peek()?.value}”.`);
  if (!Number.isFinite(result)) throw new Error('Fee formula produced a non-finite value.');
  return result;
}

export function evaluateFeeFormula(expression, variables) {
  return evaluateTokens(tokenize(expression), variables);
}

function ceilTo(value, decimals) {
  const scale = 10 ** decimals;
  return Math.ceil((value - EPS) * scale) / scale;
}
function roundTo(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round((value + EPS) * scale) / scale;
}

export function applyFeeRounding(rawFee, { rounding = 'none', contracts = 0, price = 0, direction = 'buy' } = {}) {
  const nonnegative = Math.max(0, Number(rawFee) || 0);
  if (rounding === 'round_5dp') return roundTo(nonnegative, 5);
  if (rounding === 'ceil_cent') return ceilTo(nonnegative, 2);
  if (rounding === 'round_cent') return roundTo(nonnegative, 2);
  if (rounding === 'ceil_centicent') return ceilTo(nonnegative, 4);
  if (rounding === 'kalshi_balance_cent') {
    // Kalshi first ceilings the model fee to a centicent ($0.0001), then applies
    // balance rounding so the posted cash balance remains cent-aligned. This
    // assumes the backtest trade is one aggregated fill/order and does not
    // simulate a multi-fill fee accumulator/rebate sequence.
    const tradeFee = ceilTo(nonnegative, 4);
    const signedRevenue = (direction === 'sell' ? 1 : -1) * Number(contracts || 0) * Number(price || 0);
    const balanceChange = signedRevenue - tradeFee;
    const flooredCent = Math.floor((balanceChange + EPS) * 100) / 100;
    const roundingFee = Math.max(0, balanceChange - flooredCent);
    return roundTo(tradeFee + roundingFee, 6);
  }
  return nonnegative;
}

export function validateFeeProfile(profile) {
  try {
    const takerRate = Math.max(0, Number(profile?.takerRatePct || 0)) / 100;
    const makerRate = Math.max(0, Number(profile?.makerRatePct || 0)) / 100;
    evaluateFeeFormula(profile?.formula, { C: 100, p: 0.45, rate: takerRate, M: Number(profile?.takerMultiplier ?? 1) });
    evaluateFeeFormula(profile?.formula, { C: 100, p: 0.45, rate: makerRate, M: Number(profile?.makerMultiplier ?? 1) });
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function calculateVenueFee({ settings = defaultFeeSettings, venue, contracts, price, liquidity = 'taker', direction = 'buy', phase = 'entry' }) {
  const C = Math.max(0, Number(contracts || 0));
  const p = Math.min(1, Math.max(0, Number(price || 0)));
  if (!settings?.enabled || C <= 0 || !(p >= 0)) return 0;
  const profile = settings.profiles?.[venue];
  if (!profile) return 0;
  const isMaker = liquidity === 'maker';
  const ratePct = Number(isMaker ? profile.makerRatePct : profile.takerRatePct) || 0;
  const M = Number(isMaker ? profile.makerMultiplier : profile.takerMultiplier);
  const rate = Math.max(0, ratePct) / 100;
  const multiplier = Number.isFinite(M) ? Math.max(0, M) : 1;
  const raw = Math.max(0, evaluateFeeFormula(profile.formula, { C, p, rate, M: multiplier }));
  const rounded = applyFeeRounding(raw, { rounding: profile.rounding, contracts: C, price: p, direction });
  const rebatePct = Math.min(100, Math.max(0, Number(profile.rebatePct || 0)));
  const venueFee = rounded * (1 - rebatePct / 100);
  const extraCents = Number(phase === 'exit' ? settings.extraExitCentsPerContract : settings.extraEntryCentsPerContract) || 0;
  return Math.max(0, venueFee + C * extraCents / 100);
}

export function sampleVenueFee(settings, venue, contracts = 100, price = 0.45, liquidity = 'taker') {
  return calculateVenueFee({ settings, venue, contracts, price, liquidity, direction: 'buy', phase: 'entry' });
}
