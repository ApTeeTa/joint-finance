function trimCompactNumber(value) {
  return Number(value.toFixed(2))
    .toString()
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1');
}

export function formatFullMoney(amount, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0
  }).format(amount ?? 0);
}

/** UI-only compact money labels (does not affect stored values). */
export function formatUiMoney(amount, currency = 'RUB') {
  const value = Number(amount) || 0;
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';

  if (abs < 1000) {
    return formatFullMoney(value, currency);
  }

  let compactNumber;
  let suffix;

  if (abs >= 1_000_000) {
    compactNumber = trimCompactNumber(abs / 1_000_000);
    suffix = 'M';
  } else {
    compactNumber = trimCompactNumber(abs / 1_000);
    suffix = 'k';
  }

  const compact = `${sign}${compactNumber}${suffix}`;

  if (currency === 'USD') {
    return `$${compact.replace(/^−/, '−$')}`;
  }

  if (currency === 'EUR') {
    return `${compact} €`;
  }

  return `${compact} ₽`;
}

/** Rule-driven money formatting; falls back to formatUiMoney when rules are absent. */
export function formatDisplayMoney(amount, currency = 'RUB', rules = null) {
  if (!rules?.moneyFormat) {
    return formatUiMoney(amount, currency);
  }

  if (rules.moneyFormat === 'none') {
    return '';
  }

  if (rules.moneyFormat === 'full') {
    return formatFullMoney(amount, currency);
  }

  return formatUiMoney(amount, currency);
}
