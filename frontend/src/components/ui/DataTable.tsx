import { cn } from '../../lib/cn'
import { Card } from './Card'

export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <Card padding={false} className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </Card>
  )
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
      <tr>{children}</tr>
    </thead>
  )
}

export function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>
}

export function Td({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={cn('border-b border-slate-800 px-4 py-3', className)}>
      {children}
    </td>
  )
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>
}
