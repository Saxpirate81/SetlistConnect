import type { ReactNode } from 'react'

type ModalBaseProps = {
  /** Called when the backdrop is clicked — should close the modal */
  onClose: () => void
  /** z-index class (default: z-[110]) */
  zClass?: string
  /** Max width class for the panel (default: max-w-md) */
  maxWidth?: string
  children: ReactNode
}

/**
 * Reusable modal shell: full-screen backdrop + centered white panel.
 * Handles backdrop click-to-close and stop-propagation on the panel.
 *
 * Usage:
 *   <ModalBase onClose={() => setShowX(false)}>
 *     <h3>My modal</h3>
 *     ...
 *   </ModalBase>
 */
export function ModalBase({
  onClose,
  zClass = 'z-[110]',
  maxWidth = 'max-w-md',
  children,
}: ModalBaseProps) {
  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-slate-950/80 px-4 py-6`}
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} rounded-3xl border border-white/10 bg-slate-900 p-5`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
