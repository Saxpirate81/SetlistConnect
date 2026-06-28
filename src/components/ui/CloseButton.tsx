import type { MouseEvent, PointerEvent } from 'react'

export type CloseButtonProps = {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
  ariaLabel?: string
  title?: string
  className?: string
  alignRight?: boolean
}

export const CloseButton = ({
  onClick,
  onPointerDown,
  ariaLabel = 'Close',
  title = 'Close',
  className = '',
  alignRight = true,
}: CloseButtonProps) => {
  const baseClasses = 'app-close-button icon-header-btn'
  const alignmentClasses = alignRight ? 'ml-auto shrink-0' : ''
  return (
    <button
      type="button"
      className={`${baseClasses} ${alignmentClasses} ${className}`.trim()}
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={ariaLabel}
      title={title}
    >
      ✕
    </button>
  )
}
