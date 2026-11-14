/**
 * Local modal form drafts (device-only). No secrets/passphrases/tokens.
 */
const STORAGE_PREFIX = 'jf-modal-draft-';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 300;

const timers = new Map();

function storageKey(modalName) {
  return `${STORAGE_PREFIX}${modalName}`;
}

function isSecretField(name) {
  const n = String(name ?? '').toLowerCase();
  return n.includes('passphrase')
    || n.includes('password')
    || n === 'token'
    || n.includes('secret');
}

export function readDraft(modalName) {
  try {
    const raw = localStorage.getItem(storageKey(modalName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) {
      localStorage.removeItem(storageKey(modalName));
      return null;
    }
    return parsed.fields ?? null;
  } catch {
    return null;
  }
}

export function hasDraft(modalName) {
  const fields = readDraft(modalName);
  if (!fields || typeof fields !== 'object') return false;
  return Object.values(fields).some((v) => String(v ?? '').trim() !== '');
}

export function clearDraft(modalName) {
  try {
    localStorage.removeItem(storageKey(modalName));
  } catch {
    /* noop */
  }
}

function serializeForm(form) {
  const fields = {};
  const elements = form?.elements ?? [];
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (!el.name || el.disabled || isSecretField(el.name)) continue;
    if (el.type === 'file') continue;
    if (el.type === 'checkbox') {
      fields[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) fields[el.name] = el.value;
    } else {
      fields[el.name] = el.value;
    }
  }
  return fields;
}

function saveDraft(modalName, form) {
  if (!modalName || !form) return;
  const fields = serializeForm(form);
  const hasValue = Object.values(fields).some((v) => String(v ?? '').trim() !== '');
  if (!hasValue) {
    clearDraft(modalName);
    return;
  }
  try {
    localStorage.setItem(storageKey(modalName), JSON.stringify({
      fields,
      savedAt: Date.now()
    }));
  } catch {
    /* quota */
  }
}

export function scheduleDraftSave(modalName, form) {
  const key = modalName;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    saveDraft(modalName, form);
    timers.delete(key);
  }, DEBOUNCE_MS));
}

export function restoreDraftIntoForm(form, modalName) {
  if (!form) return;
  const fields = readDraft(modalName);
  if (!fields) return;
  Object.entries(fields).forEach(([name, value]) => {
    const elements = form.elements?.namedItem?.(name);
    if (!elements) return;
    const list = elements.length != null ? [...elements] : [elements];
    list.forEach((el) => {
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else if (el.type === 'radio') {
        el.checked = el.value === String(value);
      } else {
        el.value = value ?? '';
      }
    });
  });
}

export function confirmDiscardDraft(modalName) {
  if (!hasDraft(modalName)) return true;
  return confirm('Отменить заполнение? Черновик будет удалён.');
}

let draftSystemBound = false;

export function initModalDraftSystem() {
  if (draftSystemBound) return;
  draftSystemBound = true;

  document.addEventListener('input', (event) => {
    const form = event.target.closest?.('form[data-form]');
    if (!form) return;
    const modal = form.closest('[data-modal]');
    const modalName = modal?.dataset?.modal;
    if (!modalName || modal.classList.contains('hidden')) return;
    scheduleDraftSave(modalName, form);
  }, true);

  document.addEventListener('change', (event) => {
    const form = event.target.closest?.('form[data-form]');
    if (!form) return;
    const modal = form.closest('[data-modal]');
    const modalName = modal?.dataset?.modal;
    if (!modalName || modal.classList.contains('hidden')) return;
    scheduleDraftSave(modalName, form);
  }, true);
}