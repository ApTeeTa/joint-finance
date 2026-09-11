/**
 * Warm Ledger design system — shared Tailwind class bundles (desktop-first).
 * Shell tokens live in index.html :root; components use primary/surface from tailwind.config.
 */
export const UI = Object.freeze({
  panel: 'bg-surface rounded-2xl border border-surface-border shadow-card',
  panelPadding: 'p-6',
  panelHeader: 'flex flex-wrap items-center justify-between gap-3 mb-4',
  panelHeaderSpaced: 'flex flex-wrap items-center justify-between gap-3 mb-6',
  panelTitle: 'text-lg font-semibold text-slate-900 tracking-tight',
  inlineBar:
    'flex items-center gap-3 mb-6 p-3 bg-surface-muted rounded-xl border border-surface-border',
  listFooter: 'mt-6 pt-4 border-t border-surface-border text-center text-sm text-slate-500',

  btnPrimary:
    'inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0',
  btnPrimaryBlock:
    'flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors',
  btnSecondary:
    'inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-xl border border-surface-border bg-white text-slate-700 hover:bg-surface-muted transition-colors',
  btnSecondaryBlock:
    'flex-1 px-4 py-2.5 text-sm font-medium rounded-xl border border-surface-border bg-white text-slate-700 hover:bg-surface-muted transition-colors',
  btnCancelBlock:
    'flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-surface-muted text-slate-700 hover:bg-slate-200 transition-colors',
  btnHero:
    'px-6 py-3 text-sm font-medium rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors',
  btnAction: 'px-3 py-2 text-sm font-medium rounded-xl transition-colors',
  btnActionPrimary: 'bg-primary-600 text-white hover:bg-primary-700',
  btnActionDestructive: 'bg-red-50 text-red-700 hover:bg-red-100',

  field:
    'w-full px-3 py-2.5 border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-500',
  label: 'block text-sm font-medium text-slate-700 mb-1',

  modalShell:
    'bg-surface rounded-2xl border border-surface-border shadow-card w-full max-w-md overflow-hidden',
  modalBody: 'p-6 space-y-4',
  modalTitle: 'text-lg font-semibold text-slate-900 tracking-tight',
  modalActions: 'flex gap-2 pt-2',

  emptyState: 'text-center py-12 px-4',
  emptyTitle: 'text-slate-600 mb-4',

  displayToggle:
    'inline-flex items-center gap-0.5 p-1 rounded-xl bg-surface-muted border border-surface-border',
  displayToggleBtn:
    'px-2.5 py-1.5 text-sm rounded-lg transition-all duration-150 text-slate-500 hover:text-slate-700',
  displayToggleBtnActive: 'bg-white text-primary-700 shadow-sm font-medium',

  cardItem:
    'display-item bg-surface rounded-xl border border-surface-border p-4 shadow-sm hover:border-primary-100 transition-colors'
});

export function uiPanel(innerHtml, { padding = true } = {}) {
  return `<div class="${UI.panel}${padding ? ` ${UI.panelPadding}` : ''}">${innerHtml}</div>`;
}
