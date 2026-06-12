import { useLayoutEffect, useRef } from 'react'

/**
 * Mechanics for digit-mask inputs (phone numbers, ID numbers): reformat on
 * every change while keeping the caret anchored to the digit it followed, and
 * make backspacing over a separator delete the digit before it instead of
 * letting the formatter immediately restore the separator.
 *
 * `format` maps arbitrary text to the masked representation (digits +
 * separators only) and must be idempotent on its own output.
 */
export function useMaskedDigits(
  value: string,
  onChange: (value: string) => void,
  format: (text: string) => string
) {
  const innerRef = useRef<HTMLInputElement | null>(null)
  const caretRef = useRef<number | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target
    const caret = el.selectionStart ?? el.value.length
    let digitsBeforeCaret = el.value.slice(0, caret).replace(/\D/g, '').length
    let digits = el.value.replace(/\D/g, '')

    // Backspace landed on a separator: the digit count didn't change, only a
    // separator vanished. Re-formatting would just restore it, so delete the
    // digit before the caret as the user intended.
    const prevDigits = value.replace(/\D/g, '')
    if (digits === prevDigits && el.value.length < value.length && digitsBeforeCaret > 0) {
      digits = digits.slice(0, digitsBeforeCaret - 1) + digits.slice(digitsBeforeCaret)
      digitsBeforeCaret -= 1
    }

    const next = format(digits)

    // Place the caret after the same digit it followed before formatting.
    let pos = 0
    let seen = 0
    while (pos < next.length && seen < digitsBeforeCaret) {
      if (/\d/.test(next[pos])) seen += 1
      pos += 1
    }

    // Rejected keystroke (a letter, or a digit past the cap): the formatted
    // value is unchanged, so the parent's setState bails out and React never
    // re-renders — roll the DOM back to the controlled value ourselves.
    if (next === value) {
      el.value = next
      el.setSelectionRange(pos, pos)
      return
    }

    caretRef.current = pos
    onChange(next)
  }

  // Restore the caret after React re-renders with the formatted value.
  useLayoutEffect(() => {
    const el = innerRef.current
    if (el && caretRef.current !== null && document.activeElement === el) {
      el.setSelectionRange(caretRef.current, caretRef.current)
    }
    caretRef.current = null
  }, [value])

  return { innerRef, handleChange }
}
