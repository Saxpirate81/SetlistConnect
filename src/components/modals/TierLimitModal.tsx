import { ModalBase } from './ModalBase'

type TierLimitModalProps = {
  onClose: () => void
}

/**
 * Shown when a user tries to exceed their plan tier limits.
 * During beta, limits are paused — this explains that to the user.
 */
export function TierLimitModal({ onClose }: TierLimitModalProps) {
  return (
    <ModalBase onClose={onClose} zClass="z-[109]">
      <h3 className="text-lg font-semibold">Beta access is free</h3>
      <p className="mt-2 text-sm text-slate-300">
        Plan limits are paused during beta, so you can keep testing with more gigs and musicians.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        Paid storage and pro features will come later after the core app flow is ready.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200"
          onClick={onClose}
        >
          Got it
        </button>
      </div>
    </ModalBase>
  )
}
