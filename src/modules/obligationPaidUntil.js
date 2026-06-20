export const PAID_UNTIL_DEV_DIAGNOSTICS = false;

function comparePaymentsForLifoOrder(a, b) {
  const paidAtCompare = String(a.paidAt ?? '').localeCompare(String(b.paidAt ?? ''));
  if (paidAtCompare !== 0) {
    return paidAtCompare;
  }

  return String(a.transactionId ?? '').localeCompare(String(b.transactionId ?? ''));
}

export function computePaidUntilFromPayments(obligation) {
  const payments = Array.isArray(obligation?.payments) ? obligation.payments : [];

  if (payments.length === 0) {
    return obligation?.paidUntil ?? null;
  }

  const lastPayment = payments.reduce((latest, payment) => {
    if (!latest) {
      return payment;
    }

    return comparePaymentsForLifoOrder(payment, latest) > 0 ? payment : latest;
  }, null);

  return lastPayment?.paidUntil ?? obligation?.paidUntil ?? null;
}


export function syncObligationStatusFromPayments(obligation, todayIso) {
  const paidUntil = computePaidUntilFromPayments(obligation);
  if (!paidUntil) {
    return;
  }

  obligation.status = paidUntil >= todayIso ? 'active' : 'overdue';
}

/** Dev-only: snapshot drift when payments journal exists. Not used in production flow. */
export function diagnosePaidUntilSnapshotDrift(state, { log = PAID_UNTIL_DEV_DIAGNOSTICS } = {}) {
  const drifts = [];

  for (const obligation of state.obligations ?? []) {
    const payments = obligation.payments;
    if (!Array.isArray(payments) || payments.length === 0) {
      continue;
    }

    const computedPaidUntil = computePaidUntilFromPayments(obligation);
    const snapshotPaidUntil = obligation.paidUntil ?? null;

    if (computedPaidUntil !== snapshotPaidUntil) {
      const entry = {
        obligationId: obligation.id,
        computedPaidUntil,
        snapshotPaidUntil
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
