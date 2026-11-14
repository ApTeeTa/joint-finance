import { closeModal } from './modalLayer.js';
import { clearDraft } from './modalDraftStore.js';

const submittingModals = new Set();
const recentIdempotencyKeys = new Map();
const IDEMPOTENCY_TTL_MS = 8000;

function buildIdempotencyKey(modalName, form) {
  if (!form) return modalName;
  const data = new FormData(form);
  const parts = [modalName];
  for (const [key, value] of data.entries()) {
    if (String(key).toLowerCase().includes('passphrase')) continue;
    parts.push(`${key}=${String(value)}`);
  }
  return parts.join('|');
}

export function isModalSubmitting(modalName) {
  if (!modalName) return submittingModals.size > 0;
  return submittingModals.has(modalName);
}

export function isAnyModalSubmitting() {
  return submittingModals.size > 0;
}

function markIdempotentSuccess(key) {
  recentIdempotencyKeys.set(key, Date.now());
  for (const [k, ts] of recentIdempotencyKeys) {
    if (Date.now() - ts > IDEMPOTENCY_TTL_MS) {
      recentIdempotencyKeys.delete(k);
    }
  }
}

function wasRecentlySubmitted(key) {
  const ts = recentIdempotencyKeys.get(key);
  if (!ts) return false;
  if (Date.now() - ts > IDEMPOTENCY_TTL_MS) {
    recentIdempotencyKeys.delete(key);
    return false;
  }
  return true;
}

function setModalSubmittingUi(modalName, submitting) {
  const modal = document.querySelector(`[data-modal="${modalName}"]:not(.hidden)`)
    ?? document.querySelector(`[data-modal="${modalName}"]`);
  if (!modal) return;
  modal.dataset.submitting = submitting ? 'true' : 'false';
  const form = modal.querySelector('form');
  if (form) {
    form.querySelectorAll('button[type="submit"], button[data-action="close-modal"]').forEach((btn) => {
      btn.disabled = submitting;
    });
  }
}

/**
 * @param {string} modalName
 * @param {HTMLFormElement} form
 * @param {() => boolean | Promise<boolean>} task — true = success
 */
export async function runGuardedModalSubmit(modalName, form, task) {
  if (!modalName || !form) return false;
  if (isModalSubmitting(modalName)) return false;

  const idempotencyKey = buildIdempotencyKey(modalName, form);
  if (wasRecentlySubmitted(idempotencyKey)) return false;

  submittingModals.add(modalName);
  setModalSubmittingUi(modalName, true);

  try {
    const result = await task();
    const ok = result === true;
    if (ok) {
      markIdempotentSuccess(idempotencyKey);
      clearDraft(modalName);
      form.reset();
      closeModal(modalName);
    }
    return ok;
  } finally {
    submittingModals.delete(modalName);
    setModalSubmittingUi(modalName, false);
  }
}