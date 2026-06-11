export interface ConfirmOptions {
  title?: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Tone of the confirm button — 'danger' (default) for destructive actions. */
  tone?: 'danger' | 'primary'
}

export interface PromptOptions {
  title?: string
  message?: React.ReactNode
  /** Field label shown above the input. */
  label?: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Tone of the confirm button — 'primary' (default) unless the action is destructive. */
  tone?: 'danger' | 'primary'
  type?: 'text' | 'number'
  multiline?: boolean
  /** Disable the confirm button until the field is non-empty. */
  required?: boolean
}

export type DialogRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (confirmed: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

let dispatchRequest: ((req: DialogRequest) => void) | null = null

/** Wired up by <DialogHost /> on mount; not for direct use. */
export function registerDialogHost(dispatch: ((req: DialogRequest) => void) | null) {
  dispatchRequest = dispatch
}

/**
 * Imperative confirmation dialog — drop-in replacement for window.confirm:
 *
 *   if (await confirmDialog({ title: 'Delete camera', message: `Remove "${name}"?` })) …
 *
 * Requires <DialogHost /> mounted once at the app root. Falls back to
 * window.confirm if the host is missing so a confirmation is never skipped.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!dispatchRequest) {
    const text = typeof options.message === 'string' ? options.message : (options.title ?? 'Are you sure?')
    return Promise.resolve(window.confirm(text))
  }
  return new Promise<boolean>((resolve) => dispatchRequest?.({ kind: 'confirm', options, resolve }))
}

/**
 * Imperative input dialog — drop-in replacement for window.prompt.
 * Resolves with the entered string, or null if cancelled:
 *
 *   const reason = await promptDialog({ title: 'Reject visitor', label: 'Reason' })
 *   if (reason !== null) …
 */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  if (!dispatchRequest) {
    const text =
      typeof options.message === 'string' ? options.message : (options.title ?? options.label ?? '')
    return Promise.resolve(window.prompt(text, options.initialValue ?? ''))
  }
  return new Promise<string | null>((resolve) => dispatchRequest?.({ kind: 'prompt', options, resolve }))
}
