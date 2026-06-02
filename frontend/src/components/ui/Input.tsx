import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export function inputClass(className?: string) {
  return cn(
    'w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100',
    'placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
    className
  )
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={inputClass(className)} {...props} />
  }
)

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={inputClass(className)} {...props} />
  }
)
