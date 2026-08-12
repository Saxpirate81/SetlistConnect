import type { ReactNode } from 'react'

export function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      className={`flex min-h-[62px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-2 py-2 text-center ${
        active ? 'bg-teal-400/20 text-teal-200' : 'text-slate-300'
      }`}
      onClick={onClick}
    >
      <span className="text-[1.65rem] leading-none">{icon}</span>
      <span className="mt-1 text-xs font-semibold">{label}</span>
    </button>
  )
}
