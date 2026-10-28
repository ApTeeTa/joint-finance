/**
 * Joint Finance design system — shared Tailwind class bundles.
 * Shell tokens: index.html + src/styles/jf-design-system.css
 */
export const UI = Object.freeze({
  panel:
    'bg-white rounded-2xl border border-surface-border shadow-card transition-shadow duration-200 hover:shadow-[0_8px_28px_rgba(20,24,22,0.09)]',
  panelPadding: 'p-5 sm:p-6',
  panelHeader: 'flex flex-wrap items-center justify-between gap-3 mb-4',
  panelHeaderSpaced: 'flex flex-wrap items-center justify-between gap-3 mb-6',
  panelTitle: 'text-lg font-semibold text-slate-900 tracking-tight',
  inlineBar:
    'flex flex-wrap items-center gap-3 mb-6 p-3 bg-surface-muted rounded-xl border border-surface-border',
  listFooter: 'mt-6 pt-4 border-t border-surface-border text-center text-sm text-slate-500',

  btnPrimary:
    'jf-interactive inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] text-sm font-semibold rounded-xl bg-slate-900 text-white hover:bg-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-45 disabled:cursor-not-allowed shrink-0',
  btnPrimaryBlock:
    'jf-interactive flex-1 px-4 py-2.5 min-h-[44px] text-sm font-semibold rounded-xl bg-slate-900 text-white hover:bg-primary-600 disabled:opacity-45',
  btnSecondary:
    'jf-interactive inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] text-sm font-medium rounded-xl border border-surface-border bg-white text-slate-800 hover:border-accent-500/40 hover:bg-accent-500/5 shrink-0',
  btnSecondaryBlock:
    'jf-interactive flex-1 px-4 py-2.5 min-h-[44px] text-sm font-medium rounded-xl border border-surface-border bg-white text-slate-800 hover:bg-surface-muted',
  btnCancelBlock:
    'jf-interactive flex-1 px-4 py-2.5 min-h-[44px] text-sm font-medium rounded-xl bg-surface-muted text-slate-700 hover:bg-primary-50',
  btnHero:
    'jf-interactive px-6 py-3 min-h-[48px] text-sm font-semibold rounded-xl bg-slate-900 text-white hover:bg-primary-600',
  btnAction: 'jf-interactive px-3 py-2 min-h-[40px] text-sm font-medium rounded-xl transition-colors',
  btnActionPrimary: 'bg-primary-600 text-white hover:bg-primary-700',
  btnActionDestructive: 'bg-red-50 text-red-700 hover:bg-red-100',

  field:
    'w-full px-3 py-2.5 min-h-[44px] border border-surface-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-600 transition-[border-color,box-shadow] duration-200 jf-field',
  label: 'block text-sm font-medium text-slate-700 mb-1',

  modalShell:
    'jf-modal-panel bg-white rounded-2xl border border-surface-border shadow-card w-full max-w-md overflow-hidden',
  modalBody: 'p-6 space-y-4',
  modalTitle: 'text-lg font-semibold text-slate-900 tracking-tight',
  modalActions: 'flex gap-2 pt-2',

  emptyState: 'text-center py-12 px-4 rounded-2xl border border-dashed border-surface-border bg-surface-muted/50',
  emptyTitle: 'text-slate-600 mb-4 font-medium',

  displayToggle:
    'inline-flex items-center gap-0.5 p-1 rounded-xl bg-surface-muted border border-surface-border',
  displayToggleBtn:
    'jf-interactive px-2.5 py-1.5 text-sm rounded-lg text-slate-500 hover:text-slate-800',
  displayToggleBtnActive: 'bg-white text-primary-700 shadow-sm font-medium ring-1 ring-primary-100',

  cardItem:
    'display-item jf-card-hover bg-white rounded-xl border border-surface-border p-4 shadow-sm'
});

export function uiPanel(innerHtml, { padding = true } = {}) {
  return `<div class="${UI.panel}${padding ? ` ${UI.panelPadding}` : ''}">${innerHtml}</div>`;
}
