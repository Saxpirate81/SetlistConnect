import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

type WriteGate = {
  begin: () => void
  end: () => void
  isInFlight: () => boolean
  inProgressRef: MutableRefObject<boolean>
}

/**
 * Cooldown-gated write lock used to suppress realtime full reloads while a
 * local mutation is still settling (and briefly after it finishes).
 */
export function useWriteGate(cooldownMs = 900): WriteGate {
  const inProgressRef = useRef(false)
  const cooldownTimerRef = useRef<number | null>(null)

  const begin = useCallback(() => {
    inProgressRef.current = true
    if (cooldownTimerRef.current) {
      window.clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = null
    }
  }, [])

  const end = useCallback(() => {
    if (cooldownTimerRef.current) {
      window.clearTimeout(cooldownTimerRef.current)
    }
    cooldownTimerRef.current = window.setTimeout(() => {
      inProgressRef.current = false
      cooldownTimerRef.current = null
    }, cooldownMs)
  }, [cooldownMs])

  const isInFlight = useCallback(() => Boolean(inProgressRef.current), [])

  useEffect(
    () => () => {
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    },
    [],
  )

  return { begin, end, isInFlight, inProgressRef }
}
