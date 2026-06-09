import { useRef, useState, type DragEvent } from 'react'
import { cn } from '@/shared/lib/cn'

interface ImageDropzoneProps {
  /** Called with the chosen image file (from click-to-browse or drag-and-drop). */
  onFile: (file: File) => void
  /** Data URL of the current image. When set, a framed preview replaces the drop area. */
  preview?: string | null
  /** File name shown under the preview. */
  fileName?: string
  /** When provided, a "Remove" control is shown in preview mode. */
  onClear?: () => void
  /** Disables interaction (e.g. when a capture limit is reached). */
  disabled?: boolean
  /** Secondary helper line shown inside the empty drop area. */
  hint?: string
  /** Optional field label rendered above the control. */
  label?: string
  className?: string
}

/**
 * Professional image picker: a dashed drag-and-drop area that turns into a
 * framed preview once an image is selected. Shared by the recognition test and
 * face-enrollment flows so every upload surface looks and behaves the same.
 */
export function ImageDropzone({
  onFile,
  preview,
  fileName,
  onClear,
  disabled = false,
  hint = 'JPEG or PNG · one clear, front-facing face',
  label,
  className,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const browse = () => {
    if (!disabled) inputRef.current?.click()
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div className={className}>
      {label && <span className="mb-1.5 block text-sm text-slate-400">{label}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files?.[0]) onFile(e.target.files[0])
          e.target.value = ''
        }}
      />

      {!preview ? (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={browse}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && browse()}
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
            disabled
              ? 'cursor-not-allowed border-slate-800 bg-slate-950/40 opacity-60'
              : dragging
                ? 'cursor-pointer border-blue-500 bg-blue-500/10'
                : 'cursor-pointer border-slate-700 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-800/40'
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-400">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">
              Drop an image here, or <span className="text-blue-400">browse files</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">{hint}</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
          <div className="relative flex items-center justify-center bg-[radial-gradient(circle_at_center,_theme(colors.slate.800)_0%,_theme(colors.slate.950)_100%)] p-4">
            <img
              src={preview}
              alt="Selected face"
              className="max-h-72 w-auto rounded-lg object-contain shadow-lg"
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/80 px-4 py-2.5">
            <span className="truncate text-xs text-slate-400" title={fileName}>
              {fileName || 'Selected image'}
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={browse}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
              >
                Replace
              </button>
              {onClear && (
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
