import { useEffect, useState } from 'react'

// Shows a sticky warning at the top of the screen when the device is offline.
// Disappears automatically when connectivity is restored.
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div
      role="alert"
      className="fixed left-0 right-0 top-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 shadow-md"
    >
      <span>⚠</span>
      <span>You&apos;re offline — changes won&apos;t be saved until you reconnect.</span>
    </div>
  )
}
