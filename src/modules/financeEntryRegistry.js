export const FINANCE_ENTRY_POINTS = {
  EXPENSE: 'createExpense',
  SAVINGS: 'updateSavings',
  OBLIGATION: 'payObligation',
  UNDO: 'undoTransaction',
  SPEND_SAVING: 'spendSaving',
  RESERVE: 'reserveCategory',
  UNRESERVE: 'unreserveCategory',
  CATEGORY_DELETE: 'deleteCategory',
  OBLIGATION_UNRESERVE: 'unreserveObligation',
  OBLIGATION_RESERVE: 'reserveObligation',
  SAVING_ADMIN: 'manageSaving',
  ACCOUNT: 'manageAccount',
  CATEGORY: 'manageCategory',
  SETTINGS: 'manageSettings',
  DEBT: 'manageDebt'
};

export const FINANCE_ENTRY_POINT_VALUES = new Set(Object.values(FINANCE_ENTRY_POINTS));

export const OPERATION_TO_ENTRY_POINT = {
  createExpense: FINANCE_ENTRY_POINTS.EXPENSE,
  updateSavings: FINANCE_ENTRY_POINTS.SAVINGS,
  payObligation: FINANCE_ENTRY_POINTS.OBLIGATION,
  undoTransaction: FINANCE_ENTRY_POINTS.UNDO,
  spendSaving: FINANCE_ENTRY_POINTS.SPEND_SAVING,
  reserveCategory: FINANCE_ENTRY_POINTS.RESERVE,
  unreserveCategory: FINANCE_ENTRY_POINTS.UNRESERVE,
  deleteCategory: FINANCE_ENTRY_POINTS.CATEGORY_DELETE,
  unreserveObligation: FINANCE_ENTRY_POINTS.OBLIGATION_UNRESERVE,
  reserveObligation: FINANCE_ENTRY_POINTS.OBLIGATION_RESERVE,
  manageSaving: FINANCE_ENTRY_POINTS.SAVING_ADMIN,
  depositAccount: FINANCE_ENTRY_POINTS.ACCOUNT,
  transferAccount: FINANCE_ENTRY_POINTS.ACCOUNT,
  createAccount: FINANCE_ENTRY_POINTS.ACCOUNT,
  updateAccount: FINANCE_ENTRY_POINTS.ACCOUNT,
  deleteAccount: FINANCE_ENTRY_POINTS.ACCOUNT,
  createCategory: FINANCE_ENTRY_POINTS.CATEGORY,
  updateCategory: FINANCE_ENTRY_POINTS.CATEGORY,
  createObligation: FINANCE_ENTRY_POINTS.OBLIGATION,
  updateObligation: FINANCE_ENTRY_POINTS.OBLIGATION,
  deleteObligation: FINANCE_ENTRY_POINTS.OBLIGATION,
  updateExchangeRate: FINANCE_ENTRY_POINTS.SETTINGS,
  manageDebt: FINANCE_ENTRY_POINTS.DEBT
};
