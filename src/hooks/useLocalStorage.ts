import { useState, useCallback } from 'react'

/**
 * Like useState but synced to localStorage.
 * The initializer runs only once (on mount).
 *
 * Usage:
 *   const [value, setValue, removeValue] = useLocalStorage<string>('my-key', 'default')
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          console.warn('[useLocalStorage] Failed to write:', key)
        }
        return next
      })
    },
    [key],
  )

  const removeValue = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
    setStoredValue(defaultValue)
  }, [key, defaultValue])

  return [storedValue, setValue, removeValue]
}
