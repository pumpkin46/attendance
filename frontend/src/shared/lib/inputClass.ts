import { cn } from '@/shared/lib/cn'

/** Shared styling for text inputs and selects. */
export function inputClass(className?: string) {
  return cn(
    'w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100',
    'placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
    className
  )
}
