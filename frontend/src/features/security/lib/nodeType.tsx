import type { ReactNode } from 'react'

/**
 * Shared visual language for org-node types — the glyph + tinted tile used by
 * both the org chart cards and the side-panel type picker, so a "department"
 * looks identical wherever it appears.
 */

/** Types offered in the UI (free-text on the backend, curated here). */
export const NODE_TYPES = ['company', 'division', 'branch', 'department', 'team', 'unit'] as const
export type NodeType = (typeof NODE_TYPES)[number]

export function typeLabel(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

const s = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const
const g = 'h-5 w-5'

export const CompanyIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 21V9h3a1 1 0 0 1 1 1v11" />
    <path d="M8 7h2M8 11h2M8 15h2" />
  </svg>
)
const DivisionIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
  </svg>
)
const BranchIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
)
const DepartmentIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
)
const TeamIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M21 19c0-2.6-1.6-4.4-3.8-4.9" />
  </svg>
)
const UnitIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </svg>
)
const NodeGlyph = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M4 10h16M10 4v16" />
  </svg>
)

/** Glyph + tinted tile classes for a node, keyed on its type (root = company). */
export function typeStyle(nodeType: string, isRoot = false): { icon: ReactNode; tile: string } {
  if (isRoot) return { icon: CompanyIcon, tile: 'bg-blue-500/15 text-blue-300' }
  switch (nodeType) {
    case 'company':
      return { icon: CompanyIcon, tile: 'bg-blue-500/15 text-blue-300' }
    case 'division':
      return { icon: DivisionIcon, tile: 'bg-violet-500/15 text-violet-300' }
    case 'branch':
      return { icon: BranchIcon, tile: 'bg-cyan-500/15 text-cyan-300' }
    case 'department':
      return { icon: DepartmentIcon, tile: 'bg-amber-500/15 text-amber-300' }
    case 'team':
      return { icon: TeamIcon, tile: 'bg-emerald-500/15 text-emerald-300' }
    case 'unit':
      return { icon: UnitIcon, tile: 'bg-slate-700/60 text-slate-300' }
    default:
      return { icon: NodeGlyph, tile: 'bg-slate-800 text-slate-400' }
  }
}
