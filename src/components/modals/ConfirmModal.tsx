import type React from 'react'

type ConfirmModalProps = {
  title: string
  message: string | React.ReactNode
  onCancel: () => void
  onConfirm: () => void
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' = red confirm button, 'primary' = teal confirm button */
  variant?: 'danger' | 'primary'
  zClass?: string
  maxWidth?: string
  /** Extra content between message and action buttons */
  children?: React.ReactNode
}

/**
 * Generic two-button confirm dialog: cancel + confirm actions.
 * Use `variant="danger"` for destructive actions (delete, remove),
 * `variant="primary"` (default) for neutral confirmations.
 */
export function ConfirmModal({
  title,
  message,
  onCancel,
  onConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  zClass = 'z-[80]',
  maxWidth = 'max-w-sm',
  children,
}: ConfirmModalProps) {
  const confirmClasses =
    variant === 'danger'
      ? 'flex-1 rounded-xl bg-red-500/80 px-3 py-2 text-sm font-semibold text-red-100'
      : 'flex-1 rounded-xl bg-teal-400/90 px-3 py-2 text-sm font-semibold text-slate-950'

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-slate-950/80 px-4 py-6`}
      onClick={onCancel}
    >
      <div
        className={`w-full ${maxWidth} max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
          <p className="mt-2 text-sm text-slate-300">{message}</p>
          {children}
          <div className="mt-4 flex items-center gap-2">
            <button
              className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button className={confirmClasses} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
