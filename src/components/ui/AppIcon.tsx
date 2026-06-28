export type AppIconName =
  | 'home'
  | 'songs'
  | 'mic'
  | 'account'
  | 'setlist'
  | 'sparkle'
  | 'dinner'
  | 'latin'
  | 'dance'
  | 'music'
  | 'plus'

export function AppIcon({ name, className = '' }: { name: AppIconName; className?: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.9,
  }
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
    >
      {name === 'home' && (
        <>
          <path {...common} d="M3.5 10.7 12 4l8.5 6.7" />
          <path {...common} d="M5.5 9.8V20h13V9.8" />
          <path {...common} d="M9.5 20v-6h5v6" />
        </>
      )}
      {name === 'songs' && (
        <>
          <path {...common} d="M9 18.5V5.2l10-2v13.2" />
          <path {...common} d="M9 9.2l10-2" />
          <ellipse {...common} cx="6.2" cy="18.5" rx="2.8" ry="2" />
          <ellipse {...common} cx="16.2" cy="16.4" rx="2.8" ry="2" />
        </>
      )}
      {name === 'mic' && (
        <>
          <rect {...common} x="9" y="3" width="6" height="11" rx="3" />
          <path {...common} d="M5 11a7 7 0 0 0 14 0" />
          <path {...common} d="M12 18v3" />
          <path {...common} d="M8.5 21h7" />
        </>
      )}
      {name === 'account' && (
        <>
          <circle {...common} cx="12" cy="8" r="4" />
          <path {...common} d="M4.5 20a7.8 7.8 0 0 1 15 0" />
        </>
      )}
      {name === 'setlist' && (
        <>
          <path {...common} d="M8 6h11" />
          <path {...common} d="M8 12h11" />
          <path {...common} d="M8 18h11" />
          <path {...common} d="M4.5 6h.01" />
          <path {...common} d="M4.5 12h.01" />
          <path {...common} d="M4.5 18h.01" />
        </>
      )}
      {name === 'sparkle' && (
        <>
          <path {...common} d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3Z" />
          <path {...common} d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Z" />
          <path {...common} d="M19 3l.6 1.7L21 5.3l-1.4.6L19 7.5l-.6-1.6L17 5.3l1.4-.6L19 3Z" />
        </>
      )}
      {name === 'dinner' && (
        <>
          <path {...common} d="M7 3v8" />
          <path {...common} d="M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3" />
          <path {...common} d="M7 11v10" />
          <path {...common} d="M15 3v18" />
          <path {...common} d="M15 3c3 1.3 4.5 4 4.5 7.5H15" />
        </>
      )}
      {name === 'latin' && (
        <>
          <path {...common} d="M7 20c4.8-2.3 6.8-6.2 6-11.5" />
          <path {...common} d="M13 8.5c2.2 1.2 4 3.6 4.8 7.5" />
          <path {...common} d="M9.2 6.2c2.8-2.4 5.7-2.4 8.6 0" />
          <path {...common} d="M8 9.5c2.5 1.8 5.3 1.8 8.4 0" />
          <path {...common} d="M5.5 20h13" />
        </>
      )}
      {name === 'dance' && (
        <>
          <circle {...common} cx="12" cy="5" r="2" />
          <path {...common} d="M8 11.5 12 8l4 3.5" />
          <path {...common} d="M12 8v6" />
          <path {...common} d="M12 14l-4 6" />
          <path {...common} d="M12 14l4 6" />
          <path {...common} d="M6 14c2 .8 4 .8 6 0 2-.8 4-.8 6 0" />
        </>
      )}
      {name === 'music' && (
        <>
          <path {...common} d="M9 18V5l10-2v13" />
          <ellipse {...common} cx="6" cy="18" rx="3" ry="2" />
          <ellipse {...common} cx="16" cy="16" rx="3" ry="2" />
        </>
      )}
      {name === 'plus' && (
        <>
          <path {...common} d="M12 5v14" />
          <path {...common} d="M5 12h14" />
        </>
      )}
    </svg>
  )
}
