import { cn } from '../../lib/cn'

type Variant = 'primary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed',
  ghost:
    'border border-slate-600 bg-transparent text-slate-400 hover:border-slate-500 hover:text-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-500',
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
