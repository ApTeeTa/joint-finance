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