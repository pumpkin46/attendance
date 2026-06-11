import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Reports when the element first scrolls near the viewport (one-shot: once
 * true it stays true). Lets media defer network work until it can actually be
 * seen — e.g. a gallery of 50 thumbnails fetches only the visible dozen.
 *
 * `rootMargin` pre-loads slightly before the element enters the viewport so
 * the image is usually ready by the time it scrolls in.
 */
export function useInViewport<T extends Element>(
  rootMargin = '200px'
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  // Without IntersectionObserver (old browsers, some test DOMs) just load eagerly.
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView, rootMargin])

  return [ref, inView]
}
