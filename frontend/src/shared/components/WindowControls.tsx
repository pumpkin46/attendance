import { useEffect, useState, type ReactNode } from 'react'
import {
  isDesktopApp,
  onMaximizedChange,
  requestWindowState,
  sendWindowAction,
  NO_DRAG_REGION,
} from '@/shared/lib/desktop'
import { cn } from '@/shared/lib/cn'

function ControlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid h-9 w-11 place-items-center text-slate-400 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500',
        danger ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-slate-700/70 hover:text-slate-100'
      )}
    >
      {children}
    </button>
  )
}

/**
 * Minimize / maximize-restore / close buttons for the frameless desktop window.
 * Renders nothing in a normal browser (the native chrome handles it there).
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const off = onMaximizedChange(setMaximized)
    requestWindowState() // sync the icon to the current state on mount
    return off
  }, [])

  if (!isDesktopApp()) return null

  return (
    <div className={cn('-mr-2 ml-1 flex items-center', NO_DRAG_REGION)}>
      <ControlButton label="Minimize" onClick={() => sendWindowAction('minimize')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </ControlButton>
      <ControlButton
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => sendWindowAction('maximize')}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <rect x="0.5" y="2.5" width="6" height="6" />
            <path d="M2.5 2.5V0.5h7v7h-2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </ControlButton>
      <ControlButton label="Close" danger onClick={() => sendWindowAction('close')}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </ControlButton>
    </div>
  )
}
