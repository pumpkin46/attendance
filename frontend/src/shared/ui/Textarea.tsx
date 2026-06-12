import { forwardRef, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { cn } from '@/shared/lib/cn'
import { inputClass } from '@/shared/lib/inputClass'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Grow with content instead of showing a scrollbar (default true). Height is
   * clamped between `rows` and `maxRows`; beyond that it scrolls.
   */
  autoResize?: boolean
  /** Upper bound for auto-resize, in text rows. */
  maxRows?: number
  /** Show a live `used / max` character counter (requires `maxLength`). */
  showCount?: boolean
}

/** Line height (px) of the text-sm textarea content, for row clamping. */
const LINE_PX = 20

function fit(el: HTMLTextAreaElement, minRows: number, maxRows: number) {
  // Vertical padding + borders surround the content box scrollHeight measures.
  const chrome = el.offsetHeight - el.clientHeight + 16 // py-2 = 8px top + bottom
  el.style.height = 'auto'
  const target = Math.min(
    Math.max(el.scrollHeight, minRows * LINE_PX + chrome),
    maxRows * LINE_PX + chrome
  )
  el.style.height = `${target}px`
  el.style.overflowY = el.scrollHeight > target ? 'auto' : 'hidden'
}

/**
 * Themed multiline companion to {@link Input}: same border/focus treatment,
 * auto-growing height and an optional character counter. Use for descriptions,
 * notes and any free-form text where one line isn't enough.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoResize = true, rows = 3, maxRows = 8, showCount = false, ...props },
  ref
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)

  const setRefs = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as MutableRefObject<HTMLTextAreaElement | null>).current = node
  }

  // Refit on every committed value change (controlled inputs, resets, async fills).
  useLayoutEffect(() => {
    if (autoResize && innerRef.current) fit(innerRef.current, rows, maxRows)
  }, [autoResize, rows, maxRows, props.value])

  const used = String(props.value ?? '').length
  const counter = showCount && props.maxLength != null

  // Also refit on raw input so uncontrolled usage grows while typing.
  const handleInput: TextareaProps['onInput'] = (e) => {
    if (autoResize) fit(e.currentTarget, rows, maxRows)
    props.onInput?.(e)
  }

  const textarea = (
    <textarea
      ref={setRefs}
      rows={rows}
      className={cn(inputClass(className), 'resize-none leading-5')}
      {...props}
      onInput={handleInput}
    />
  )

  if (!counter) return textarea

  return (
    <div className="relative">
      {textarea}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-1.5 right-2.5 text-[10px] tabular-nums',
          used >= (props.maxLength ?? Infinity) ? 'text-amber-400' : 'text-slate-500'
        )}
      >
        {used}/{props.maxLength}
      </span>
    </div>
  )
})
