import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms
 * of silence. Use this to avoid firing searches/filters on every keystroke.
 *
 * Usage:
 *   const debouncedSearch = useDebounce(searchInput, 200)
 *   // use debouncedSearch to filter — not searchInput
 */
export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debounced
}
