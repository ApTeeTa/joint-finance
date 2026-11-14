const DEFAULT_INCOME_CATEGORIES = [
  { id: 'income-salary', name: 'Зарплата', isSystem: true },
  { id: 'income-freelance', name: 'Подработка', isSystem: true },
  { id: 'income-bonus', name: 'Премия', isSystem: true },
  { id: 'income-benefits', name: 'Пособия', isSystem: true },
  { id: 'income-other', name: 'Прочий доход', isSystem: true }
];

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `income-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ensureDefaultIncomeCategories(state) {
  if (!Array.isArray(state.incomeCategories)) {
    state.incomeCategories = [];
  }
  if (state.incomeCategories.length === 0) {
    state.incomeCategories = DEFAULT_INCOME_CATEGORIES.map((item) => ({ ...item }));
  }
}

export function getIncomeCategories(state) {
  ensureDefaultIncomeCategories(state);
  return state.incomeCategories;
}

export function findIncomeCategory(state, categoryId) {
  return getIncomeCategories(state).find((item) => item.id === categoryId) ?? null;
}

export function resolveIncomeCategoryName(state, categoryId, fallback) {
  if (fallback) return fallback;
  return findIncomeCategory(state, categoryId)?.name ?? 'Без категории';
}

export function renderIncomeCategoryOptions(state, selectedId = '') {
  const options = getIncomeCategories(state).map((cat) => {
    const selected = cat.id === selectedId ? ' selected' : '';
    return `<option value="${cat.id}"${selected}>${cat.name}</option>`;
  }).join('');
  return `<option value="">Без категории</option>${options}`;
}

export function addIncomeCategory(state, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Введите название' };
  ensureDefaultIncomeCategories(state);
  if (state.incomeCategories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: 'Категория уже существует' };
  }
  const category = { id: createId(), name: trimmed, isSystem: false };
  state.incomeCategories.push(category);
  return { ok: true, category };
}

export function renameIncomeCategory(state, categoryId, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Введите название' };
  const category = findIncomeCategory(state, categoryId);
  if (!category) return { ok: false, error: 'Категория не найдена' };
  category.name = trimmed;
  return { ok: true, category };
}