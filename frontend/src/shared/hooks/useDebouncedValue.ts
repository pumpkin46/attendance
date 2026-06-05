import { useEffect, useState } from 'react'

/**
 * Returns `value` after it has stopped changing for `delayMs`. Use to keep an
 * input responsive while throttling the work it drives (e.g. a search query
 * key) so we don't fire a request on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
