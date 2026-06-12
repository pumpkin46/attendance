import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { registerDialogHost, type DialogRequest } from '@/shared/ui/dialogs'
import { cn } from '@/shared/lib/cn'

/** Must match the dialog-out / backdrop-out animation durations in index.css. */
const EXIT_MS = 150

/** Renders confirmDialog() / promptDialog() requests. Mount exactly once, at the app root. */
export function DialogHost() {
  const titleId = useId()
  const messageId = useId()
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  // Trails `open` so the dialog stays mounted while the exit animation plays.
  const [present, setPresent] = useState(false)
  const activeRef = useRef<DialogRequest | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const dismiss = useCallback(() => {
    const req = activeRef.current
    activeRef.current = null
    if (req?.kind === 'confirm') req.resolve(false)
    if (req?.kind === 'prompt') req.resolve(null)
    setOpen(false)
  }, [])

  useEffect(() => {
    registerDialogHost((req) => {
      // A new request supersedes any still-pending one.
      const prev = activeRef.current
      if (prev?.kind === 'confirm') prev.resolve(false)
      if (prev?.kind === 'prompt') prev.resolve(null)
      activeRef.current = req
      setRequest(req)
      setValue(req.kind === 'prompt' ? (req.options.initialValue ?? '') : '')
      setOpen(true)
    })
    return () => registerDialogHost(null)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setPresent(open), open ? 0 : EXIT_MS)
    return () => clearTimeout(timer)
  }, [open])

  // Focus the field (prompt) or the safe cancel action (confirm) on open;
  // Escape cancels; restore focus on close.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    if (fieldRef.current) {
      fieldRef.current.focus()
      fieldRef.current.select()
    } else {
      cancelRef.current?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      restoreFocusRef.current?.focus()
    }
  }, [open, dismiss])

  if (!request || (!open && !present)) return null

  const closing = !open
  const { kind, options } = request
  const tone = options.tone ?? (kind === 'confirm' ? 'danger' : 'primary')
  const valid = kind === 'confirm' || !options.required || value.trim().length > 0

  const submit = () => {
    const req = activeRef.current
    if (!req) return
    activeRef.current = null
    if (req.kind === 'confirm') req.resolve(true)
    else req.resolve(value)
    setOpen(false)
  }

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]',
        closing
          ? 'pointer-events-none animate-[backdrop-out_150ms_ease-in_both]'
          : 'animate-[backdrop-in_150ms_ease-out_both]'
      )}
      onClick={dismiss}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.message ? messageId : undefined}
        className={cn(
          'w-full max-w-md rounded-xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl shadow-black/50',
          closing
            ? 'animate-[dialog-out_150ms_ease-in_both]'
            : 'animate-[dialog-in_200ms_cubic-bezier(0.32,0.72,0,1)_both]'
        )}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) submit()
        }}
      >
        <div className="flex items-start gap-4">
          {kind === 'confirm' && (
            <span
              className={cn(
                'grid h-10 w-10 shrink-0 place-items-center rounded-full',
                tone === 'danger' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400'
              )}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-100">
              {options.title ?? (kind === 'confirm' ? 'Are you sure?' : 'Input required')}
            </h2>
            {options.message && (
              <p id={messageId} className="mt-1.5 text-sm leading-relaxed text-slate-400">
                {options.message}
              </p>
            )}
            {kind === 'prompt' && (
              <label className="mt-4 block">
                {options.label && (
                  <span className="mb-1.5 block text-xs font-medium text-slate-300">{options.label}</span>
                )}
                {options.multiline ? (
                  <Textarea
                    ref={(el) => {
                      fieldRef.current = el
                    }}
                    rows={3}
                    value={value}
                    placeholder={options.placeholder}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : (
                  <Input
                    ref={(el) => {
                      fieldRef.current = el
                    }}
                    type={options.type ?? 'text'}
                    value={value}
                    placeholder={options.placeholder}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
              </label>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="ghost" onClick={dismiss}>
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!valid}>
            {options.confirmLabel ?? (kind === 'confirm' ? 'Confirm' : 'Save')}
          </Button>
        </div>
      </form>
    </div>,
    document.body
  )
}
