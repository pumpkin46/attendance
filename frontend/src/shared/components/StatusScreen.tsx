import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/shared/ui/Button'

export function StatusScreen({
  code,
  title,
  message,
  icon,
}: {
  code: string
  title: string
  message: string
  icon: ReactNode
}) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-slate-800 text-slate-400 ring-1 ring-slate-700">
          {icon}
        </div>
        <p className="text-5xl font-bold tracking-tight text-slate-700">{code}</p>
        <h1 className="mt-3 text-xl font-semibold text-slate-100">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">{message}</p>
        <Link to="/" className="mt-6 inline-block">
          <Button>Back to home</Button>
        </Link>
      </div>
    </div>
  )
}

const LockIcon = (
  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const CompassIcon = (
  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="m15 9-2 5-4 2 2-5 4-2Z" />
  </svg>
)

export function ForbiddenPage() {
  return (
    <StatusScreen
      code="403"
      title="Access denied"
      message="You don't have permission to view this page. Contact an administrator if you think this is a mistake."
      icon={LockIcon}
    />
  )
}

export function NotFoundPage() {
  return (
    <StatusScreen
      code="404"
      title="Page not found"
      message="The page you're looking for doesn't exist or may have been moved."
      icon={CompassIcon}
    />
  )
}
