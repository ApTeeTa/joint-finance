export const PAID_UNTIL_DEV_DIAGNOSTICS = false;

function comparePaymentsForLifoOrder(a, b) {
  const paidAtCompare = String(a.paidAt ?? '').localeCompare(String(b.paidAt ?? ''));
  if (paidAtCompare !== 0) {
    return paidAtCompare;
  }

  return String(a.transactionId ?? '').localeCompare(String(b.transactionId ?? ''));
}

/** Latest paidUntil from payment journal only (ignores manual snapshot). */
export function computePaidUntilFromPaymentJournal(obligation) {
  const payments = Array.isArray(obligation?.payments) ? obligation.payments : [];
  if (payments.length === 0) {
    return null;
  }

  let latest = null;
  for (const payment of payments) {
    const iso = payment?.paidUntil;
    if (!iso) continue;
    if (!latest || iso > latest) {
      latest = iso;
    }
  }
  return latest;
}

/** Manual / admin date stored on obligation entity (not a payment row). */
export function getManualPaidUntil(obligation) {
  const value = obligation?.paidUntil;
  return value ? String(value) : null;
}

export function maxIsoDate(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Effective «Оплачено до»: поздняя из ручной даты и журнала платежей.
 */
export function resolveEffectivePaidUntil(obligation) {
  const manual = getManualPaidUntil(obligation);
  const fromJournal = computePaidUntilFromPaymentJournal(obligation);
  return maxIsoDate(manual, fromJournal);
}

/** @deprecated Use resolveEffectivePaidUntil — kept for existing imports. */
export function computePaidUntilFromPayments(obligation) {
  return resolveEffectivePaidUntil(obligation);
}

export function diffCalendarDaysUntilPaidUntil(paidUntilIso, todayIso) {
  if (!paidUntilIso || !todayIso) return null;
  const [y1, m1, d1] = String(todayIso).split('-').map(Number);
  const [y2, m2, d2] = String(paidUntilIso).split('-').map(Number);
  const today = Date.UTC(y1, m1 - 1, d1);
  const until = Date.UTC(y2, m2 - 1, d2);
  return Math.round((until - today) / 86400000);
}

/**
 * UI status from effective paidUntil and today (calendar days).
 * green: >7 days left; yellow: 0–7; red: overdue (today after paidUntil).
 */
export function getObligationDueUiStatus(obligation, todayIso) {
  const paidUntil = resolveEffectivePaidUntil(obligation);
  if (!paidUntil) {
    return { tier: 'neutral', label: 'Без срока', paidUntil: null, daysLeft: null };
  }

  const daysLeft = diffCalendarDaysUntilPaidUntil(paidUntil, todayIso);
  if (daysLeft === null) {
    return { tier: 'neutral', label: 'Без срока', paidUntil, daysLeft: null };
  }

  if (daysLeft < 0) {
    return { tier: 'overdue', label: 'Просрочено', paidUntil, daysLeft };
  }
  if (daysLeft <= 7) {
    return { tier: 'warning', label: 'Скоро срок', paidUntil, daysLeft };
  }
  return { tier: 'paid', label: 'Оплачено', paidUntil, daysLeft };
}

export function isObligationOverdueByDate(obligation, todayIso) {
  const paidUntil = resolveEffectivePaidUntil(obligation);
  if (!paidUntil) return false;
  const daysLeft = diffCalendarDaysUntilPaidUntil(paidUntil, todayIso);
  return daysLeft !== null && daysLeft < 0;
}

export function syncObligationStatusFromPayments(obligation, todayIso) {
  const paidUntil = resolveEffectivePaidUntil(obligation);
  if (!paidUntil) {
    return;
  }

  obligation.status = isObligationOverdueByDate(obligation, todayIso) ? 'overdue' : 'active';
}

/** Dev-only: snapshot drift when payments journal exists. Not used in production flow. */
export function diagnosePaidUntilSnapshotDrift(state, { log = PAID_UNTIL_DEV_DIAGNOSTICS } = {}) {
  const drifts = [];

  for (const obligation of state.obligations ?? []) {
    const payments = obligation.payments;
    if (!Array.isArray(payments) || payments.length === 0) {
      continue;
    }

    const computedPaidUntil = computePaidUntilFromPaymentJournal(obligation);
    const snapshotPaidUntil = obligation.paidUntil ?? null;

    if (computedPaidUntil !== snapshotPaidUntil && snapshotPaidUntil !== resolveEffectivePaidUntil(obligation)) {
      const entry = {
        obligationId: obligation.id,
        computedPaidUntil,
        snapshotPaidUntil,
        effectivePaidUntil: resolveEffectivePaidUntil(obligation)
      };
      drifts.push(entry);

      if (log) {
        console.info({
          type: 'DEV_SNAPSHOT_DRIFT',
          ...entry
        });
      }
    }
  }

  return drifts;
}

/** @deprecated Dev tool alias kept for existing test imports */
export function validatePaidUntilConsistency(state, options) {
  const drifts = diagnosePaidUntilSnapshotDrift(state, options);
  const obligations = state.obligations ?? [];

  return {
    report: {
      total: obligations.length,
      matches: obligations.length - drifts.length,
      mismatches: drifts.length
    },
    mismatches: drifts
  };
}

/** @deprecated Dev tool alias kept for existing test imports */
export function diagnosePaidUntilShadow(state, options) {
  return diagnosePaidUntilSnapshotDrift(state, options);
}