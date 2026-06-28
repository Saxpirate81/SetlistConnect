type InfoModalProps = {
  title: string
  /** Message body — can be a string or JSX */
  message: string | React.ReactNode
  onClose: () => void
  zClass?: string
  /** Extra content between message and button */
  children?: React.ReactNode
}

import type React from 'react'

/**
 * Simple informational modal: title + message + "Got it" button.
 * Used for warnings and guidance dialogs that only require acknowledgement.
 */
export function InfoModal({ title, message, onClose, zClass = 'z-[80]', children }: InfoModalProps) {
  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-slate-950/80 px-4 py-6`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[80vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <div className="max-h-[calc(80vh-64px)] overflow-auto px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
          <p className="mt-2 text-sm text-slate-300">{message}</p>
          {children}
          <div className="mt-4">
            <button
              className="w-full rounded-xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950"
              onClick={onClose}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
