import { useCallback, useEffect, useRef, useState } from 'react'

type Options = {
  /** How long until session expires (ms). Default: 2 hours */
  timeoutMs?: number
  /** How early to warn before expiry (ms). Default: 5 minutes */
  warningMs?: number
  /** Called when the session actually expires */
  onExpire: () => void
  /** Whether to run the timer (set false when user is logged out) */
  enabled: boolean
}

type Return = {
  /** True when within `warningMs` of expiry — show a warning banner */
  showWarning: boolean
  /** Call this to extend the session (e.g. "Stay logged in" button) */
  extendSession: () => void
}

const LAST_ACTIVE_KEY = 'setlist:lastActive'

/**
 * Manages session timeout tracking.
 * Watches user activity events (mouse, keyboard, touch, scroll) and
 * triggers `onExpire` after `timeoutMs` of inactivity.
 * Shows a warning `warningMs` before expiry.
 */
export function useSessionTimeout({
  timeoutMs = 2 * 60 * 60 * 1000,
  warningMs = 5 * 60 * 1000,
  onExpire,
  enabled,
}: Options): Return {
  const [showWarning, setShowWarning] = useState(false)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  const updateActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
    setShowWarning(false)
  }, [])

  const extendSession = useCallback(() => {
    updateActivity()
  }, [updateActivity])

  useEffect(() => {
    if (!enabled) return

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach((event) => window.addEventListener(event, updateActivity))

    const interval = window.setInterval(() => {
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) ?? 0)
      const elapsed = Date.now() - lastActive
      if (elapsed > timeoutMs) {
        setShowWarning(false)
        onExpireRef.current()
      } else if (elapsed > timeoutMs - warningMs) {
        setShowWarning(true)
      }
    }, 30_000)

    return () => {
      events.forEach((event) => window.removeEventListener(event, updateActivity))
      window.clearInterval(interval)
    }
  }, [enabled, timeoutMs, warningMs, updateActivity])

  return { showWarning, extendSession }
}
