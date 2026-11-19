import {
  CATEGORY_RESERVE_INSUFFICIENT_ERROR,
  assessCategoryMonthlyExpense
} from './categoryMonth.js';
import { notifyError, showJfConfirm } from './jfNotifyModal.js';

export const CATEGORY_LIMIT_CONFIRM_TITLE = 'Лимит категории превышен. Провести операцию?';

export function confirmCategoryLimitExceeded() {
  return showJfConfirm(CATEGORY_LIMIT_CONFIRM_TITLE);
}

/**
 * Диалог до проведения расхода / переноса при превышении месячного лимита.
 * @returns {Promise<{ proceed: boolean, monthlyLimitAcknowledged: boolean }>}
 */
export async function resolveCategoryMonthlyLimitBeforeExpense(state, categoryId, rubAmount, expenseDate) {
  const assessment = assessCategoryMonthlyExpense(state, categoryId, rubAmount, expenseDate);
  if (!assessment.exceedsMonthlyLimit) {
    return { proceed: true, monthlyLimitAcknowledged: false };
  }

  const confirmed = await confirmCategoryLimitExceeded();
  if (!confirmed) {
    return { proceed: false, monthlyLimitAcknowledged: false };
  }

  if (!assessment.sufficientReserve) {
    await notifyError(CATEGORY_RESERVE_INSUFFICIENT_ERROR);
    return { proceed: false, monthlyLimitAcknowledged: true };
  }

  return { proceed: true, monthlyLimitAcknowledged: true };
}