/**
 * Единый календарь приложения — Asia/Dubai (UTC+4).
 * «Сегодня» и текущий месяц для лимитов не зависят от TZ устройства и не от UTC.
 */
export const APP_TIMEZONE = 'Asia/Dubai';

const dtfCache = new Map();

function getDateTimeFormat(options) {
  const key = JSON.stringify(options);
  if (!dtfCache.has(key)) {
    dtfCache.set(key, new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, ...options }));
  }
  return dtfCache.get(key);
}

/** Календарная дата YYYY-MM-DD в Asia/Dubai для момента reference (по умолчанию — сейчас). */
export function getAppCalendarIsoDate(reference = new Date()) {
  return getDateTimeFormat({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(reference);
}

/** Текущий календарный месяц YYYY-MM в Asia/Dubai. */
export function getAppYearMonth(reference = new Date()) {
  return getAppCalendarIsoDate(reference).slice(0, 7);
}

/** Алиас для финансовых операций «сегодня». */
export function todayIsoApp(reference = new Date()) {
  return getAppCalendarIsoDate(reference);
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Проверка календарной даты YYYY-MM-DD без сдвига по часовым поясам. */
export function isValidTransactionIsoDate(value) {
  const match = ISO_DATE_RE.exec(String(value ?? '').trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day
  );
}

/** Нормализует ввод `<input type="date">` и строки к YYYY-MM-DD. */
export function normalizeTransactionIsoDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return isValidTransactionIsoDate(raw) ? raw : '';
}

/** Подпись даты операции для UI (без local/UTC сдвига от `new Date('YYYY-MM-DD')`). */
export function formatTransactionDateLabel(iso) {
  const normalized = normalizeTransactionIsoDate(iso);
  if (!normalized) return '—';
  const [year, month, day] = normalized.split('-');
  return `${day}.${month}.${year}`;
}