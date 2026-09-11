import { UI } from './uiTheme.js';
import { calculateFreeBalance } from './financeEngine.js';
import { payObligation, unreserveObligation, reserveObligation } from './financeGate.js';
import { dispatch, ACTION_TYPES } from './actionRegistry.js';
import {
  MUTATION_DOMAINS,
  registerMutationStrategy,
  executeMutation
} from './mutationContract.js';
import {
  renderAccountSelectOptions,
  todayIso
} from './transactions.js';
import {
  computePaidUntilFromPayments,
  diagnosePaidUntilSnapshotDrift,
  diagnosePaidUntilShadow,
  validatePaidUntilConsistency
} from './obligationPaidUntil.js';
import { openModal, closeModal, isWithinAppUi, findAppForm, findInAppUi, findAppModal, queryAllInAppUi } from './modalLayer.js';
import {
  DISPLAY_MODULE_KEYS,
  renderDisplayModeList,
  renderDisplayModeRoot,
  renderModuleToolbar,
  getModuleDisplayContext
} from './displayMode.js';
import {
  ENTITY_TYPES,
  getDisplayRules,
  createRawMoney
} from './uiRulesEngine.js';
import { renderEntityCard } from './uiActionRenderer.js';

export {
  computePaidUntilFromPayments,
  diagnosePaidUntilSnapshotDrift,
  diagnosePaidUntilShadow,
  validatePaidUntilConsistency
} from './obligationPaidUntil.js';

const STATUS_CARD_CLASS = {
  current: 'border-emerald-300 bg-emerald-50/60',
  overdue: 'border-red-300 bg-red-50/60'
};

const DISPATCH_SOURCE = 'obligations.js';
const OBLIGATION_DOMAIN = MUTATION_DOMAINS.OBLIGATION;

function formatMoney(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(amount ?? 0);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseLocalDate(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatPaidUntilLabel(iso) {
  if (!iso) return '—';
  const date = parseLocalDate(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('ru-RU', { month: 'long' });
  return `до ${day} ${month}`;
}

function syncStoredStatus(obligation) {
  const paidUntil = computePaidUntilFromPayments(obligation);
  if (!paidUntil) {
    return;
  }

  obligation.status = paidUntil >= todayIso() ? 'active' : 'overdue';
}

function getUiStatus(obligation) {
  const paidUntil = computePaidUntilFromPayments(obligation);

  if (!paidUntil || paidUntil >= todayIso()) {
    return { ui: 'current', label: 'К оплате' };
  }

  return { ui: 'overdue', label: 'Просрочено' };
}

export function getOverdueDays(paidUntil) {
  if (!paidUntil) return 0;
  const today = parseLocalDate(todayIso());
  const until = parseLocalDate(paidUntil);
  return Math.round((today - until) / 86400000);
}

export function isObligationOverdue(obligation) {
  const paidUntil = computePaidUntilFromPayments(obligation);
  if (!paidUntil) return false;
  return paidUntil <= todayIso();
}

export function formatOverdueDaysLabel(overdueDays) {
  if (overdueDays <= 0) return 'Просрочено сегодня';
  const n = overdueDays;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `Просрочено ${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `Просрочено ${n} дня`;
  return `Просрочено ${n} дней`;
}

export function getOverdueObligations(state) {
  return (state.obligations ?? [])
    .filter(isObligationOverdue)
    .map((obligation) => ({
      id: obligation.id,
      name: obligation.name,
      overdueDays: getOverdueDays(computePaidUntilFromPayments(obligation))
    }))
    .sort((a, b) => a.overdueDays - b.overdueDays);
}

function findObligation(state, obligationId) {
  return (state.obligations ?? []).find((item) => item.id === obligationId);
}

function normalizeObligation(obligation) {
  const item = {
    ...obligation,
    reserveAmount: obligation.reserveAmount ?? 0,
    targetAmount: obligation.targetAmount ?? null,
    comment: obligation.comment ?? '',
    payments: Array.isArray(obligation.payments) ? obligation.payments : []
  };
  syncStoredStatus(item);
  return item;
}

function reserveFunds(state, obligationId, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    alert('Сумма должна быть больше 0');
    return false;
  }

  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  const freeBalance = calculateFreeBalance(state);
  if (value > freeBalance) {
    alert('Недостаточно средств');
    return false;
  }

  const result = reserveObligation(
    state,
    obligationId,
    value,
    `Резерв: ${obligation.name}`,
    todayIso(),
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function unreserveFunds(state, obligationId, amount) {
  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    alert('Сумма возврата должна быть больше 0');
    return false;
  }

  const result = unreserveObligation(
    state,
    obligationId,
    value,
    '',
    todayIso(),
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function registerObligationMutationStrategies() {
  registerMutationStrategy(OBLIGATION_DOMAIN, ACTION_TYPES.OBLIGATION_CREATE, {
    resolveEntityId: (payload) => payload.obligationId ?? null,
    apply: () => true
  });

  registerMutationStrategy(OBLIGATION_DOMAIN, ACTION_TYPES.OBLIGATION_UPDATE, {
    resolveEntityId: (payload) => payload.obligationId ?? null,
    apply: () => true
  });

  registerMutationStrategy(OBLIGATION_DOMAIN, ACTION_TYPES.OBLIGATION_DELETE, {
    resolveEntityId: (payload) => payload.obligationId ?? null,
    apply: () => true
  });
}

registerObligationMutationStrategies();

function executeObligationMutation({
  actionType,
  obligationId,
  state,
  dispatchPayload,
  applyContext
}) {
  return executeMutation({
    domain: OBLIGATION_DOMAIN,
    actionType,
    entityId: obligationId,
    state,
    dispatchPayload,
    payload: applyContext,
    dispatchFn: dispatch,
    dispatchMeta: { source: DISPATCH_SOURCE }
  });
}

function createObligation(state, data) {
  if (!data.name || !String(data.name).trim()) {
    alert('Введите название обязательства');
    return false;
  }
  if (!data.paidUntil) {
    alert('Укажите срок оплаты');
    return false;
  }

  return executeObligationMutation({
    actionType: ACTION_TYPES.OBLIGATION_CREATE,
    obligationId: null,
    state,
    dispatchPayload: {
      state,
      data,
      author: state.profile
    },
    applyContext: { data }
  });
}

function updateObligation(state, obligationId, data) {
  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  if (!data.name || !String(data.name).trim()) {
    alert('Введите название обязательства');
    return false;
  }
  if (!data.paidUntil) {
    alert('Укажите срок оплаты');
    return false;
  }

  return executeObligationMutation({
    actionType: ACTION_TYPES.OBLIGATION_UPDATE,
    obligationId,
    state,
    dispatchPayload: {
      state,
      obligationId,
      data,
      author: state.profile
    },
    applyContext: { obligationId, data }
  });
}

function deleteObligation(state, obligationId) {
  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  return executeObligationMutation({
    actionType: ACTION_TYPES.OBLIGATION_DELETE,
    obligationId,
    state,
    dispatchPayload: {
      state,
      obligationId,
      author: state.profile
    },
    applyContext: { obligationId }
  });
}

function formatObligationDueMeta(item) {
  const paidUntilLabel = formatPaidUntilLabel(computePaidUntilFromPayments(item));
  const uiStatus = getUiStatus(item);
  const duePhrase = paidUntilLabel === '—' ? 'без срока' : `оплатить ${paidUntilLabel}`;

  if (uiStatus.ui === 'overdue') {
    return `просрочено · ${duePhrase}`;
  }

  return duePhrase;
}

function renderObligationCard(state, obligation) {
  const item = normalizeObligation(obligation);
  const uiStatus = getUiStatus(item);
  const cardClass = STATUS_CARD_CLASS[uiStatus.ui] ?? STATUS_CARD_CLASS.current;
  const reservedAmount = item.reserveAmount ?? 0;
  const paymentsTotal = (item.payments ?? []).reduce(
    (sum, payment) => sum + (Number(payment.amount) || 0),
    0
  );

  const displayContext = getModuleDisplayContext(DISPLAY_MODULE_KEYS.OBLIGATIONS, {
    entityType: ENTITY_TYPES.OBLIGATION
  });
  const displayRules = getDisplayRules(displayContext);

  const dueMeta = formatObligationDueMeta(item);

  return renderEntityCard({
    moduleKey: DISPLAY_MODULE_KEYS.OBLIGATIONS,
    entityType: ENTITY_TYPES.OBLIGATION,
    entityId: item.id,
    dataAttr: 'data-obligation-id',
    dataValue: item.id,
    itemClass: cardClass,
    title: escapeHtml(item.name),
    meta: dueMeta,
    currency: 'RUB',
    rawValues: {
      spent: createRawMoney(paymentsTotal),
      limit: createRawMoney(item.targetAmount ?? 0),
      reserve: createRawMoney(reservedAmount)
    },
    context: {
      paidUntil: computePaidUntilFromPayments(item)
    },
    viewMode: displayContext.viewMode,
    displayRules
  });
}

function renderFormModal(key, title, submitLabel, obligation = null) {
  const paidUntil = computePaidUntilFromPayments(obligation) ?? todayIso();
  const targetAmount = obligation?.targetAmount ?? '';

  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="${key}">
      <div class="${UI.modalShell} ${UI.modalBody} max-h-[90vh] overflow-y-auto">
        <h3 class="${UI.modalTitle} mb-4">${title}</h3>
        <form data-form="${key}" class="space-y-4">
          ${obligation ? `<input type="hidden" name="obligationId" value="${obligation.id}">` : ''}
          <div>
            <label class="${UI.label}">Название</label>
            <input type="text" name="name" required maxlength="80" value="${escapeHtml(obligation?.name ?? '')}" class="${UI.field}" placeholder="Например, Интернет">
          </div>
          <div>
            <label class="${UI.label}">Сумма (RUB)</label>
            <input type="number" name="targetAmount" min="0" step="1" value="${targetAmount}" class="${UI.field}" placeholder="Необязательно">
          </div>
          <div>
            <label class="${UI.label}">Срок оплаты</label>
            <input type="date" name="paidUntil" required value="${paidUntil}" class="${UI.field}">
          </div>
          <div>
            <label class="${UI.label}">Комментарий</label>
            <input type="text" name="comment" maxlength="200" value="${escapeHtml(obligation?.comment ?? '')}" class="${UI.field}" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="${key}" class="${UI.btnCancelBlock}">Отмена</button>
            <button type="submit" class="${UI.btnPrimaryBlock}">${submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderReserveObligationModal(freeBalance) {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="reserve-obligation">
      <div class="${UI.modalShell} ${UI.modalBody}">
        <h3 class="${UI.modalTitle} mb-4">Зарезервировать</h3>
        <p class="text-sm text-emerald-700 mb-4">Можно зарезервировать: <strong>${formatMoney(freeBalance)}</strong></p>
        <form data-form="reserve-obligation" class="space-y-4">
          <input type="hidden" name="obligationId" value="">
          <div>
            <label class="${UI.label}">Сумма</label>
            <input type="number" name="amount" required min="1" step="1" class="${UI.field}" placeholder="0">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="reserve-obligation" class="${UI.btnCancelBlock}">Отмена</button>
            <button type="submit" class="${UI.btnPrimaryBlock}">Зарезервировать</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderUnreserveObligationModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="unreserve-obligation">
      <div class="${UI.modalShell} ${UI.modalBody}">
        <h3 class="${UI.modalTitle} mb-4">Снять резерв</h3>
        <form data-form="unreserve-obligation" class="space-y-4">
          <input type="hidden" name="obligationId" value="">
          <div>
            <label class="${UI.label}">Сумма</label>
            <input type="number" name="amount" required min="1" step="1" class="${UI.field}" placeholder="0">
          </div>
          <p class="text-xs text-slate-400" data-unreserve-obligation-hint></p>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="unreserve-obligation" class="${UI.btnCancelBlock}">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700">Снять резерв</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderPayModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="pay-obligation">
      <div class="${UI.modalShell} ${UI.modalBody}">
        <h3 class="${UI.modalTitle} mb-1">Оплатить</h3>
        <p class="text-sm text-slate-500 mb-4" data-pay-obligation-title></p>
        <form data-form="pay-obligation" class="space-y-4">
          <input type="hidden" name="obligationId" value="">
          <div>
            <label class="${UI.label}">Сумма (RUB)</label>
            <input type="number" name="amount" required min="1" step="1" class="${UI.field}">
          </div>
          <div>
            <label class="${UI.label}">Счёт списания</label>
            <select name="accountId" required class="${UI.field} obligation-account-select">
              ${renderAccountSelectOptions({ accounts: [] })}
            </select>
          </div>
          <div>
            <label class="${UI.label}">Оплатить до</label>
            <input type="date" name="paidUntil" required class="${UI.field}">
          </div>
          <div>
            <label class="${UI.label}">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="${UI.field}" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="pay-obligation" class="${UI.btnCancelBlock}">Отмена</button>
            <button type="submit" class="${UI.btnPrimaryBlock}">Оплатить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderObligations(state, container) {
  const obligations = (state.obligations ?? []).map(normalizeObligation);
  const freeBalance = calculateFreeBalance(state);

  const list = obligations.length
    ? renderDisplayModeList(obligations.map((item) => renderObligationCard(state, item)).join(''))
    : `<div class="${UI.emptyState}"><p class="${UI.emptyTitle} text-sm">Обязательств пока нет</p></div>`;

  container.innerHTML = `
    ${renderDisplayModeRoot(DISPLAY_MODULE_KEYS.OBLIGATIONS, `
    <div class="${UI.panel} ${UI.panelPadding}">
      <div class="${UI.panelHeader}">
        <h2 class="${UI.panelTitle}">Обязательства</h2>
        ${renderModuleToolbar(DISPLAY_MODULE_KEYS.OBLIGATIONS, `<button type="button" data-action="open-add-obligation" class="${UI.btnPrimary}">Добавить</button>`)}
      </div>
      ${list}
    </div>
    `)}
    ${renderFormModal('add-obligation', 'Новое обязательство', 'Создать')}
    ${renderFormModal('edit-obligation', 'Редактирование', 'Сохранить')}
    ${renderPayModal()}
    ${renderReserveObligationModal(freeBalance)}
    ${renderUnreserveObligationModal()}
  `;

  refreshSelects(state, container);
}

function refreshSelects(state, container) {
  queryAllInAppUi('.obligation-account-select', container).forEach((select) => {
    const selected = select.value;
    select.innerHTML = renderAccountSelectOptions(state, selected);
  });
}

function readFormData(form) {
  const formData = new FormData(form);
  return {
    obligationId: formData.get('obligationId'),
    name: formData.get('name'),
    accountId: formData.get('accountId'),
    targetAmount: formData.get('targetAmount'),
    paidUntil: formData.get('paidUntil'),
    comment: formData.get('comment'),
    amount: formData.get('amount')
  };
}

export function initObligationsHandlers(state, container, onStateChange) {
  const refresh = () => {
    renderObligations(state, container);
    if (typeof onStateChange === 'function') {
      onStateChange();
    }
  };

  if (container.dataset.obligationsHandlersBound === 'true') {
    return;
  }
  container.dataset.obligationsHandlersBound = 'true';

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const closeBtn = event.target.closest('[data-action="close-modal"]');
    if (closeBtn) {
      closeModal(closeBtn.dataset.modal);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'open-add-obligation') {
      const form = findAppForm('add-obligation', container);
      if (form) form.reset();
      openModal('add-obligation');
      refreshSelects(state, container);
      return;
    }

    if (action === 'open-edit-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = findObligation(state, obligationId);
      if (!obligation) {
        alert('Обязательство не найдено');
        return;
      }

      const modal = findAppModal('edit-obligation', container);
      if (!modal) return;
      modal.outerHTML = renderFormModal('edit-obligation', 'Редактирование', 'Сохранить', obligation);
      openModal('edit-obligation');
      return;
    }

    if (action === 'open-pay-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = normalizeObligation(findObligation(state, obligationId) ?? {});
      if (!obligation.id) {
        alert('Обязательство не найдено');
        return;
      }

      const form = findAppForm('pay-obligation', container);
      if (!form) return;
      form.obligationId.value = obligation.id;
      form.amount.value = obligation.targetAmount != null && obligation.targetAmount > 0
        ? String(obligation.targetAmount)
        : '';
      form.accountId.value = '';
      form.paidUntil.value = computePaidUntilFromPayments(obligation) || todayIso();
      form.comment.value = '';
      const titleEl = findInAppUi('[data-pay-obligation-title]', container);
      if (titleEl) titleEl.textContent = obligation.name;

      openModal('pay-obligation');
      refreshSelects(state, container);
      return;
    }

    if (action === 'open-reserve-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const form = findAppForm('reserve-obligation', container);
      if (form) {
        form.obligationId.value = obligationId;
        form.amount.value = '';
      }
      openModal('reserve-obligation');
      return;
    }

    if (action === 'open-unreserve-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = findObligation(state, obligationId);
      const form = findAppForm('unreserve-obligation', container);
      if (form && obligation) {
        form.obligationId.value = obligationId;
        form.amount.value = '';
        const hint = findInAppUi('[data-unreserve-obligation-hint]', container);
        if (hint) {
          hint.textContent = `Доступно к снятию: ${formatMoney(obligation.reserveAmount ?? 0)}`;
        }
      }
      openModal('unreserve-obligation');
      return;
    }

    if (action === 'delete-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      if (!confirm('Удалить обязательство?')) {
        return;
      }
      if (deleteObligation(state, obligationId)) {
        refresh();
      }
    }
  });

  document.addEventListener('submit', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();

    const formKey = form.dataset.form;
    const data = readFormData(form);

    if (formKey === 'add-obligation') {
      if (createObligation(state, data)) {
        closeModal('add-obligation');
        refresh();
      }
      return;
    }

    if (formKey === 'edit-obligation') {
      if (updateObligation(state, data.obligationId, data)) {
        closeModal('edit-obligation');
        refresh();
      }
      return;
    }

    if (formKey === 'pay-obligation') {
      const result = payObligation(
        state,
        data.obligationId,
        data.amount,
        data.accountId,
        data.paidUntil,
        data.comment,
        todayIso(),
        state.profile
      );

      if (!result.ok) {
        alert(result.error);
        return;
      }

      closeModal('pay-obligation');
      refresh();
      return;
    }

    if (formKey === 'reserve-obligation') {
      if (reserveFunds(state, data.obligationId, data.amount)) {
        closeModal('reserve-obligation');
        refresh();
      }
      return;
    }

    if (formKey === 'unreserve-obligation') {
      if (unreserveFunds(state, data.obligationId, data.amount)) {
        closeModal('unreserve-obligation');
        refresh();
      }
    }
  });
}
