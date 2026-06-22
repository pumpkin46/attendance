import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { cn } from '@/shared/lib/cn'
import { ancestorIds, descendantIds, flattenTree } from '@/features/security/lib/tree'
import { CompanyIcon, typeStyle } from '@/features/security/lib/nodeType'
import {
  layoutOrgChart,
  type OrgChartEdge,
  type OrgChartLayout,
  type OrgChartNode,
} from '@/features/security/lib/orgChartLayout'
import type { OrgNode } from '@/features/security/types'

// ── Layout constants (pre-zoom pixels) ────────────────────────────────────────
const NODE_W = 236
const NODE_H = 88
const H_GAP = 26
const V_GAP = 64
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const FIT_PADDING = 64
const CORNER_R = 14
const ANIM_MS = 320
const DRAG_THRESHOLD = 5

// ── Small inline icons ─────────────────────────────────────────────────────────
const ic = 'h-3.5 w-3.5'
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const PlusIcon = (
  <svg viewBox="0 0 24 24" className={ic} {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const EditIcon = (
  <svg viewBox="0 0 24 24" className={ic} {...stroke}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
const MoveIcon = (
  <svg viewBox="0 0 24 24" className={ic} {...stroke}>
    <path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
  </svg>
)
const AssignUsersIcon = (
  <svg viewBox="0 0 24 24" className={ic} {...stroke}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5" />
    <path d="M17 11h5M19.5 8.5v5" />
  </svg>
)
const TrashIcon = (
  <svg viewBox="0 0 24 24" className={ic} {...stroke}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
  </svg>
)
const ChevronUpIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...stroke}>
    <path d="m6 15 6-6 6 6" />
  </svg>
)
const MinusIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
    <path d="M5 12h14" />
  </svg>
)
const PlusSmIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const FitIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </svg>
)
const FullscreenIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 0-2 2h-3" />
  </svg>
)
const GripIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
    <circle cx="9" cy="6" r="1.6" />
    <circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" />
    <circle cx="15" cy="18" r="1.6" />
  </svg>
)
const SearchIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)
const XIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...stroke}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
const PlusCircleIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...stroke}>
    <path d="M12 8v8M8 12h8" />
  </svg>
)

// ── Helpers ───────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/** Naive but readable pluralizer for node-type labels ("branch" -> "branches"). */
function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

/** Label for a collapse pill: "+3 teams", falling back to "+N units" when mixed. */
function hiddenChildLabel(node: OrgNode): string {
  const kids = node.children ?? []
  if (kids.length === 0) return ''
  const types = new Set(kids.map((k) => k.node_type))
  const noun = types.size === 1 ? pluralize([...types][0]) : 'units'
  return `+${kids.length} ${noun}`
}

/** Rounded orthogonal elbow from a parent's bottom-center to a child's top-center. */
function elbowPath(e: OrgChartEdge): string {
  const dx = e.x2 - e.x1
  // Near-aligned parent/child (sub-pixel centering) → drop a clean vertical,
  // never the slanted stub a tiny-radius elbow would degenerate into.
  if (Math.abs(dx) < 2) return `M${e.x1},${e.y1} L${e.x1},${e.y2}`
  const midY = (e.y1 + e.y2) / 2
  const r = Math.min(CORNER_R, Math.abs(dx) / 2, Math.abs(e.y2 - e.y1) / 2)
  const dir = dx > 0 ? 1 : -1
  return [
    `M ${e.x1},${e.y1}`,
    `L ${e.x1},${midY - r}`,
    `Q ${e.x1},${midY} ${e.x1 + dir * r},${midY}`,
    `L ${e.x2 - dir * r},${midY}`,
    `Q ${e.x2},${midY} ${e.x2},${midY + r}`,
    `L ${e.x2},${e.y2}`,
  ].join(' ')
}

type Pt = { x: number; y: number }
interface RenderState {
  nodes: OrgChartNode[]
  edges: OrgChartEdge[]
  width: number
  height: number
}

const snapshot = (l: OrgChartLayout): RenderState => ({
  nodes: l.nodes,
  edges: l.edges,
  width: l.width,
  height: l.height,
})

/** Recompute connector endpoints from an interpolated node-position map. */
function edgesFromPositions(pos: Map<number, Pt>, target: OrgChartLayout): OrgChartEdge[] {
  return target.edges.map((e) => {
    const p = pos.get(e.parentId) ?? { x: 0, y: 0 }
    const c = pos.get(e.childId) ?? { x: 0, y: 0 }
    return {
      parentId: e.parentId,
      childId: e.childId,
      x1: p.x + NODE_W / 2,
      y1: p.y + NODE_H,
      x2: c.x + NODE_W / 2,
      y2: c.y,
    }
  })
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5"
      style={{ width: NODE_W, height: NODE_H }}
    >
      <div className="flex h-full items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-3/4 rounded bg-slate-800" />
          <div className="h-2.5 w-2/5 rounded bg-slate-700/60" />
        </div>
      </div>
    </div>
  )
}

/** A faux org chart (root + 3 children with connectors) shown while loading. */
function ChartSkeleton() {
  return (
    <div className="flex animate-pulse flex-col items-center" aria-hidden>
      <SkeletonCard />
      <div className="h-7 w-px bg-slate-800" />
      <div className="relative flex" style={{ gap: H_GAP }}>
        <span
          className="absolute top-0 h-px bg-slate-800"
          style={{ left: NODE_W / 2, right: NODE_W / 2 }}
        />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="h-7 w-px bg-slate-800" />
            <SkeletonCard />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Drag-and-drop ───────────────────────────────────────────────────────────────

interface DragState {
  node: OrgNode
  sx: number
  sy: number
  pointerId: number
  active: boolean
  /** Snapshotted on activation so per-frame hit-tests are O(1) lookups, not
   *  a full subtree walk + tree search every pointer move. */
  descendants: Set<number>
  nodeById: Map<number, OrgNode>
}

/**
 * A unit may be dropped onto any same-company node that isn't itself, its
 * current parent, or one of its descendants. The server stays authoritative and
 * surfaces edge cases (cycles, cross-tenant) via a toast.
 */
function evaluateDrop(d: DragState, targetId: number): boolean {
  if (!Number.isFinite(targetId)) return false
  if (targetId === d.node.id || targetId === d.node.parent_id) return false
  const target = d.nodeById.get(targetId)
  if (!target || target.root_organization_id !== d.node.root_organization_id) return false
  return !d.descendants.has(targetId)
}

// ── Action toolbar ──────────────────────────────────────────────────────────────

interface NodeActions {
  onAddChild: (parent: OrgNode) => void
  onEdit: (node: OrgNode) => void
  onMove: (node: OrgNode) => void
  onDelete: (node: OrgNode) => void
  onEditCompany?: (root: OrgNode) => void
  onDeleteCompany?: (root: OrgNode) => void
  /** Assign existing users to this node (gated separately by users.manage). */
  onAssignUsers?: (node: OrgNode) => void
}

function ToolbarButton({
  label,
  tone = 'default',
  onClick,
  children,
}: {
  label: string
  tone?: 'default' | 'danger'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'grid h-6 w-6 cursor-pointer place-items-center rounded-md text-slate-400 transition-colors',
        tone === 'danger'
          ? 'hover:bg-red-500/15 hover:text-red-300'
          : 'hover:bg-slate-700 hover:text-slate-100'
      )}
    >
      {children}
    </button>
  )
}

// ── Node card ─────────────────────────────────────────────────────────────────

/** The icon tile + name + code·type line — shared by the card and the drag
 *  ghost so a dragged unit keeps the exact look of the real card. */
function CardFace({ node, isRoot }: { node: OrgNode; isRoot: boolean }) {
  const { icon, tile } = typeStyle(node.node_type, isRoot)
  return (
    <>
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', tile)}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'truncate text-sm font-semibold',
              node.is_active ? 'text-slate-100' : 'text-slate-400'
            )}
            title={node.name}
          >
            {node.name}
          </span>
          {!node.is_active && (
            <span className="shrink-0 rounded bg-slate-800 px-1.5 py-px text-[10px] font-medium text-slate-400">
              Inactive
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          <span className="font-mono text-[11px] uppercase">{node.code}</span>
          <span aria-hidden>·</span>
          <span className="capitalize">{node.node_type}</span>
        </div>
      </div>
    </>
  )
}

function ChartCard({
  node,
  isRoot,
  collapsed,
  childCount,
  canManage,
  draggable,
  dragging,
  isDragging,
  isDropTarget,
  isSelected,
  onPath,
  isMatch,
  actions,
  onToggle,
}: {
  node: OrgNode
  isRoot: boolean
  collapsed: boolean
  childCount: number
  canManage: boolean
  draggable: boolean
  /** Some node (possibly another) is being dragged right now. */
  dragging: boolean
  isDragging: boolean
  isDropTarget: boolean
  isSelected: boolean
  /** An ancestor of the selected node (reporting-line highlight). */
  onPath: boolean
  /** Matches the active search query. */
  isMatch: boolean
  actions: NodeActions
  onToggle: () => void
}) {
  const showEdit = !isRoot || !!actions.onEditCompany
  const showDelete = isRoot ? !!actions.onDeleteCompany : true

  return (
    <div
      className={cn(
        'group/node relative h-full rounded-xl border bg-slate-900 px-3.5 py-2.5 text-left shadow-lg shadow-black/20 transition-[box-shadow,border-color] animate-[orgnode-in_220ms_ease-out]',
        // Drag opacity wins over the inactive dim (kept mutually exclusive so the
        // plain `cn` join never emits two conflicting opacity utilities).
        isDragging ? 'opacity-40' : !node.is_active ? 'opacity-60' : null,
        draggable && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        // Single border/ring decision — one class wins (plain cn has no merge).
        isDropTarget
          ? 'border-blue-400 ring-2 ring-blue-400/60'
          : isSelected
            ? 'border-blue-400 ring-2 ring-blue-400/50'
            : isMatch
              ? 'border-amber-400/70 ring-2 ring-amber-400/40'
              : onPath
                ? 'border-blue-400/60 ring-1 ring-blue-400/40'
                : isRoot
                  ? 'border-blue-500/50 ring-1 ring-blue-500/20'
                  : 'border-slate-700 hover:border-slate-600'
      )}
    >
      {/* Accent strip for company roots. */}
      {isRoot && (
        <span
          aria-hidden
          className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-gradient-to-r from-blue-500/0 via-blue-500 to-blue-500/0"
        />
      )}

      <div className="flex h-full items-center gap-3">
        <CardFace node={node} isRoot={isRoot} />
        {/* Drag affordance for movable units — faintly visible (so it's
            discoverable without hover, e.g. on touch), brightening on hover. */}
        {draggable && (
          <span
            aria-hidden
            className="shrink-0 text-slate-600 opacity-30 transition-opacity group-hover/node:opacity-100"
          >
            {GripIcon}
          </span>
        )}
      </div>

      {/* Hover / focus action toolbar. Shown when the viewer can manage the
          structure OR can assign users (a separate permission). */}
      {(canManage || actions.onAssignUsers) && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-950/90 p-0.5 opacity-0 shadow-lg shadow-black/30 backdrop-blur transition-opacity group-hover/node:opacity-100 group-focus-within/node:opacity-100">
          {actions.onAssignUsers && (
            <ToolbarButton label="Assign users" onClick={() => actions.onAssignUsers?.(node)}>
              {AssignUsersIcon}
            </ToolbarButton>
          )}
          {canManage && (
            <>
              <ToolbarButton label="Add sub-unit" onClick={() => actions.onAddChild(node)}>
                {PlusIcon}
              </ToolbarButton>
              {showEdit && (
                <ToolbarButton
                  label={isRoot ? 'Edit organization' : 'Edit unit'}
                  onClick={() => (isRoot ? actions.onEditCompany?.(node) : actions.onEdit(node))}
                >
                  {EditIcon}
                </ToolbarButton>
              )}
              {!isRoot && (
                <ToolbarButton label="Move unit" onClick={() => actions.onMove(node)}>
                  {MoveIcon}
                </ToolbarButton>
              )}
              {showDelete && (
                <ToolbarButton
                  label={isRoot ? 'Delete organization' : 'Delete unit'}
                  tone="danger"
                  onClick={() => (isRoot ? actions.onDeleteCompany?.(node) : actions.onDelete(node))}
                >
                  {TrashIcon}
                </ToolbarButton>
              )}
            </>
          )}
        </div>
      )}

      {/* Collapse / expand pill straddling the bottom edge. */}
      {childCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          aria-expanded={!collapsed}
          className={cn(
            'absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-sm transition-colors',
            collapsed
              ? 'border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25'
              : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
          )}
        >
          {collapsed ? hiddenChildLabel(node) : ChevronUpIcon}
        </button>
      )}

      {/* Inline add-child affordance on leaf nodes (hover) — mirrors the
          familiar "+" below a node in org-chart tools. */}
      {canManage && childCount === 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            actions.onAddChild(node)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Add a sub-unit under ${node.name}`}
          className="absolute -bottom-3 left-1/2 z-10 grid h-6 w-6 -translate-x-1/2 cursor-pointer place-items-center rounded-full border border-slate-700 bg-slate-800 text-slate-400 opacity-0 shadow-sm transition-[opacity,background-color,color] hover:bg-blue-500/20 hover:text-blue-300 group-hover/node:opacity-100 group-focus-within/node:opacity-100"
        >
          {PlusCircleIcon}
        </button>
      )}
    </div>
  )
}

// ── Canvas ──────────────────────────────────────────────────────────────────────

interface Transform {
  scale: number
  x: number
  y: number
}

export interface OrgChartProps {
  tree: OrgNode[]
  loading: boolean
  canManage: boolean
  onAddChild: (parent: OrgNode) => void
  onEdit: (node: OrgNode) => void
  onMove: (node: OrgNode) => void
  onDelete: (node: OrgNode) => void
  /** Re-parent via drag-and-drop. */
  onMoveTo: (node: OrgNode, newParentId: number) => void
  onEditCompany?: (root: OrgNode) => void
  onDeleteCompany?: (root: OrgNode) => void
  /** Assign existing users to a node (shown when the viewer has users.manage). */
  onAssignUsers?: (node: OrgNode) => void
}

export function OrgChart({
  tree,
  loading,
  canManage,
  onAddChild,
  onEdit,
  onMove,
  onDelete,
  onMoveTo,
  onEditCompany,
  onDeleteCompany,
  onAssignUsers,
}: OrgChartProps) {
  const actions: NodeActions = {
    onAddChild,
    onEdit,
    onMove,
    onDelete,
    onEditCompany,
    onDeleteCompany,
    onAssignUsers,
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const [tf, setTf] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [panning, setPanning] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [pendingCenter, setPendingCenter] = useState<number | null>(null)

  // Latest content extent, kept in a ref for the imperative fit math (synced in
  // the layout effect below — never written during render).
  const dimsRef = useRef({ w: 0, h: 0 })
  // True once the user has panned/zoomed — suppresses auto-recentre on resize.
  const interacted = useRef(false)
  // Current transform, mirrored for imperative reads (centre-on-node).
  const tfRef = useRef(tf)

  // id → node, for ancestor/path lookups, search, and drag validation.
  const nodeById = useMemo(
    () => new Map(flattenTree(tree).map((n) => [n.id, n])),
    [tree]
  )
  // Selected node + all its ancestors → the highlighted reporting line.
  const pathSet = useMemo(() => {
    if (selectedId == null) return new Set<number>()
    const s = ancestorIds(tree, selectedId)
    s.add(selectedId)
    return s
  }, [tree, selectedId])
  // Nodes matching the search query, in stable tree order.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as OrgNode[]
    return flattenTree(tree).filter(
      (n) => n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q)
    )
  }, [tree, search])
  const matchIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches])

  // The settled (target) layout, recomputed when the tree or collapse set changes.
  const targetLayout = useMemo(
    () =>
      layoutOrgChart(tree, {
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        hGap: H_GAP,
        vGap: V_GAP,
        collapsed,
      }),
    [tree, collapsed]
  )

  // `render` is what's actually painted — it tweens toward `targetLayout`.
  const [render, setRender] = useState<RenderState>(() => snapshot(targetLayout))
  const renderRef = useRef(render)
  // Mirror before paint so the tween's useLayoutEffect reads the just-displayed
  // extent (not a one-frame-stale value) when computing the from-size.
  useLayoutEffect(() => {
    renderRef.current = render
    tfRef.current = tf
  })
  const posRef = useRef<Map<number, Pt>>(new Map())
  const animRef = useRef<number | null>(null)

  // Animate node positions (and, with them, the connectors) toward the new
  // layout whenever it changes. New nodes grow out of their parent's old slot.
  // useLayoutEffect so the first (snap) render commits before paint.
  useLayoutEffect(() => {
    const target = targetLayout
    const toPos = new Map<number, Pt>(target.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }

    const prev = posRef.current
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // First paint (or reduced motion): snap, don't animate.
    if (prev.size === 0 || reduce) {
      posRef.current = toPos
      setRender(snapshot(target))
      return
    }

    const parentOf = new Map<number, number>(target.edges.map((e) => [e.childId, e.parentId]))
    const fromPos = new Map<number, Pt>()
    for (const n of target.nodes) {
      const was = prev.get(n.id)
      if (was) {
        fromPos.set(n.id, was)
        continue
      }
      const pid = parentOf.get(n.id)
      const pWas = pid != null ? prev.get(pid) : undefined
      fromPos.set(n.id, pWas ? { x: pWas.x, y: pWas.y } : { x: n.x, y: n.y })
    }
    const fromW = renderRef.current.width || target.width
    const fromH = renderRef.current.height || target.height
    const start = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_MS)
      const e = easeOutCubic(t)
      const pos = new Map<number, Pt>()
      const nodes = target.nodes.map((n) => {
        const f = fromPos.get(n.id) ?? { x: n.x, y: n.y }
        const to = toPos.get(n.id) ?? { x: n.x, y: n.y }
        const x = f.x + (to.x - f.x) * e
        const y = f.y + (to.y - f.y) * e
        pos.set(n.id, { x, y })
        return { ...n, x, y }
      })
      posRef.current = pos
      setRender({
        nodes,
        edges: edgesFromPositions(pos, target),
        width: fromW + (target.width - fromW) * e,
        height: fromH + (target.height - fromH) * e,
      })
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        animRef.current = null
        posRef.current = toPos
        setRender(snapshot(target))
      }
    }
    animRef.current = requestAnimationFrame(tick)
    return () => {
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
      }
    }
  }, [targetLayout])

  const toggle = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const collapseAll = useCallback(() => {
    setCollapsed(
      new Set(flattenTree(tree).filter((n) => (n.children?.length ?? 0) > 0).map((n) => n.id))
    )
  }, [tree])
  const expandAll = useCallback(() => setCollapsed(new Set()), [])

  // Select a node and bring it into view: expand its collapsed ancestors so it
  // renders, then centre once the layout reflects the expansion.
  const focusNode = useCallback(
    (id: number) => {
      setCollapsed((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const aid of ancestorIds(tree, id)) if (next.delete(aid)) changed = true
        return changed ? next : prev
      })
      setSelectedId(id)
      setPendingCenter(id)
    },
    [tree]
  )

  // Centre on the pending node once it exists in the settled layout (it may take
  // a render for newly-expanded ancestors to appear). Keeps the current zoom.
  useEffect(() => {
    if (pendingCenter == null) return
    // Wait (without clearing) until the node exists in the settled layout — its
    // collapsed ancestors expand a render earlier. Callers only ever request ids
    // that are in the tree, so this resolves within a render or two.
    const n = targetLayout.nodes.find((node) => node.id === pendingCenter)
    const vp = viewportRef.current
    if (!n || !vp) return
    const s = tfRef.current.scale
    setTf({
      scale: s,
      x: vp.clientWidth / 2 - (n.x + NODE_W / 2) * s,
      y: vp.clientHeight / 2 - (n.y + NODE_H / 2) * s,
    })
    interacted.current = true
    setPendingCenter(null)
  }, [pendingCenter, targetLayout])

  // Search-as-you-type: jump to the first match. Done in the input handler (a
  // user event), not an effect — it's a reaction to typing, not external sync.
  const runSearch = (q: string) => {
    setSearch(q)
    setMatchIdx(0)
    const query = q.trim().toLowerCase()
    if (!query) {
      setSelectedId(null) // emptying the query drops the highlight
      return
    }
    const first = flattenTree(tree).find(
      (n) => n.name.toLowerCase().includes(query) || n.code.toLowerCase().includes(query)
    )
    if (first) focusNode(first.id)
  }

  // matchIdx can outrun a shrunk result set after a tree edit — clamp on read.
  const curMatch = matches.length ? matchIdx % matches.length : 0
  const gotoNextMatch = () => {
    if (matches.length === 0) return
    const i = (curMatch + 1) % matches.length
    setMatchIdx(i)
    focusNode(matches[i].id)
  }

  const fitView = useCallback(() => {
    const vp = viewportRef.current
    const { w, h } = dimsRef.current
    if (!vp || w === 0 || h === 0) return
    const vw = vp.clientWidth
    const vh = vp.clientHeight
    // Never enlarge past 100% when fitting — small trees sit at natural size.
    const scale = clamp(Math.min((vw - FIT_PADDING * 2) / w, (vh - FIT_PADDING * 2) / h), MIN_ZOOM, 1)
    setTf({
      scale,
      x: (vw - w * scale) / 2,
      y: Math.max(FIT_PADDING, (vh - h * scale) / 2),
    })
  }, [])

  // Keep dims fresh and fit once (synchronously, before paint) as soon as the
  // tree has measurable extent — avoids a flash of unfitted content.
  const fitted = useRef(false)
  useLayoutEffect(() => {
    dimsRef.current = { w: targetLayout.width, h: targetLayout.height }
    if (fitted.current) return
    if (targetLayout.width > 0 && viewportRef.current && viewportRef.current.clientWidth > 0) {
      fitView()
      fitted.current = true
    }
  }, [targetLayout.width, targetLayout.height, fitView])

  // Refit on container resize: initial fit once the box first gains width, and
  // recentre on later resizes — but only while the user hasn't taken control.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!fitted.current) {
        if (vp.clientWidth > 0 && dimsRef.current.w > 0) {
          fitView()
          fitted.current = true
        }
      } else if (!interacted.current) {
        fitView()
      }
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [fitView])

  // Zoom by a factor, anchored on a viewport-relative point so the content under
  // it stays put. Reads only `prev`, so rapid wheel ticks compose correctly.
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    interacted.current = true
    setTf((prev) => {
      const scale = clamp(prev.scale * factor, MIN_ZOOM, MAX_ZOOM)
      const k = scale / prev.scale
      return { scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k }
    })
  }, [])

  const zoomByCenter = useCallback(
    (factor: number) => {
      const vp = viewportRef.current
      if (vp) zoomAt(factor, vp.clientWidth / 2, vp.clientHeight / 2)
    },
    [zoomAt]
  )

  // Wheel zoom — attached natively so it can preventDefault (React wheel is passive).
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = vp.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Drag-to-pan from any empty space (skips interactive controls). A press that
  // doesn't move is a tap: select the card under it, or clear selection on empty.
  const drag = useRef<
    { id: number; sx: number; sy: number; lastX: number; lastY: number; moved: boolean; downId: number } | null
  >(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a, input, [role="button"]')) return
    drag.current = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      // Record what was pressed; a tap selects that, not whatever drifts under
      // the cursor (cards may glide during the layout tween).
      downId: nodeUnderPointer(e.clientX, e.clientY, NaN),
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setPanning(true)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    d.lastX = e.clientX
    d.lastY = e.clientY
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= DRAG_THRESHOLD) d.moved = true
    interacted.current = true
    setTf((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
  }
  const endPan = (e: ReactPointerEvent<HTMLDivElement>, isUp: boolean) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    drag.current = null
    setPanning(false)
    if (isUp && !d.moved) {
      setSelectedId(Number.isFinite(d.downId) ? d.downId : null)
    }
  }

  // ── Drag-and-drop re-parenting ────────────────────────────────────────────
  const [dragNode, setDragNode] = useState<OrgNode | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [ghost, setGhost] = useState<Pt | null>(null)
  // The descendant set + id→node map are snapshotted when the drag activates so
  // hit-testing every pointer frame is a couple of Map/Set lookups, not a pair
  // of full tree walks.
  const dnd = useRef<DragState | null>(null)

  // First node under the pointer that isn't the drag source. `elementsFromPoint`
  // walks the whole stack, so the source card never shadows a target beneath it.
  const nodeUnderPointer = (clientX: number, clientY: number, excludeId: number): number => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const card = el.closest('[data-node-id]')
      if (!(card instanceof HTMLElement)) continue
      const id = Number(card.dataset.nodeId)
      if (id !== excludeId) return id
    }
    return NaN
  }

  const beginNodeDrag = (e: ReactPointerEvent<HTMLDivElement>, node: OrgNode) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a, input, [role="button"]')) return
    e.stopPropagation() // don't let the viewport start a pan
    dnd.current = {
      node,
      sx: e.clientX,
      sy: e.clientY,
      pointerId: e.pointerId,
      active: false,
      descendants: new Set(),
      nodeById: new Map(),
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveNodeDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dnd.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.active) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return
      d.active = true
      d.descendants = descendantIds(d.node)
      d.nodeById = nodeById
      setDragNode(d.node)
    }
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) setGhost({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    const targetId = nodeUnderPointer(e.clientX, e.clientY, d.node.id)
    setDropTargetId(evaluateDrop(d, targetId) ? targetId : null)
  }
  const endNodeDrag = (e: ReactPointerEvent<HTMLDivElement>, isUp: boolean) => {
    const d = dnd.current
    if (!d || d.pointerId !== e.pointerId) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    dnd.current = null
    if (d.active) {
      const targetId = nodeUnderPointer(e.clientX, e.clientY, d.node.id)
      if (evaluateDrop(d, targetId)) onMoveTo(d.node, targetId)
    } else if (isUp) {
      // A pointer-UP without movement is a tap → select (a cancel must not).
      setSelectedId(d.node.id)
    }
    setDragNode(null)
    setDropTargetId(null)
    setGhost(null)
  }

  // Fullscreen — keep our state in sync; the resize observer recentres.
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void el.requestFullscreen?.()
  }, [])

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current)
      // A fullscreen toggle is an explicit context change — release manual
      // control so the resize observer recentres for the new viewport size.
      interacted.current = false
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const ctlBtn =
    'grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-slate-700 bg-slate-900/90 text-slate-300 shadow-sm backdrop-blur transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100'

  const hasNodes = targetLayout.nodes.length > 0

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative overflow-hidden border border-slate-700 bg-slate-950',
        isFullscreen ? 'h-screen w-screen rounded-none' : 'h-[clamp(460px,68vh,820px)] rounded-xl'
      )}
    >
      {/* Pan/zoom viewport with a parallax dotted grid. */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPan(e, true)}
        onPointerCancel={(e) => endPan(e, false)}
        className={cn(
          'absolute inset-0 touch-none select-none',
          panning || dragNode ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(148 163 184 / 0.14) 1px, transparent 1.4px)',
          backgroundSize: `${22 * tf.scale}px ${22 * tf.scale}px`,
          backgroundPosition: `${tf.x}px ${tf.y}px`,
        }}
      >
        {!loading && render.nodes.length > 0 && (
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: render.width,
              height: render.height,
              transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`,
            }}
          >
            <svg
              className="absolute left-0 top-0 overflow-visible"
              width={render.width}
              height={render.height}
              aria-hidden
            >
              <g fill="none">
                {/* Dim edges first, then the "hot" reporting-line edges on top
                    (later siblings paint over earlier ones in SVG). */}
                {render.edges
                  .filter((e) => !(pathSet.has(e.parentId) && pathSet.has(e.childId)))
                  .map((e) => (
                    <path
                      key={`${e.parentId}-${e.childId}`}
                      d={elbowPath(e)}
                      stroke="rgb(71 85 105)"
                      strokeWidth={1.5}
                    />
                  ))}
                {render.edges
                  .filter((e) => pathSet.has(e.parentId) && pathSet.has(e.childId))
                  .map((e) => (
                    <path
                      key={`${e.parentId}-${e.childId}`}
                      d={elbowPath(e)}
                      stroke="#60a5fa"
                      strokeWidth={2.25}
                    />
                  ))}
              </g>
            </svg>

            {render.nodes.map((rn) => {
              const isRoot = rn.node.parent_id === null
              const draggable = canManage && !isRoot
              return (
                <div
                  key={rn.id}
                  data-node-id={rn.id}
                  className="absolute left-0 top-0"
                  style={{
                    width: NODE_W,
                    height: NODE_H,
                    transform: `translate(${rn.x}px, ${rn.y}px)`,
                    zIndex: dropTargetId === rn.id ? 20 : dragNode?.id === rn.id ? 25 : undefined,
                  }}
                  onPointerDown={draggable ? (e) => beginNodeDrag(e, rn.node) : undefined}
                  onPointerMove={draggable ? moveNodeDrag : undefined}
                  onPointerUp={draggable ? (e) => endNodeDrag(e, true) : undefined}
                  onPointerCancel={draggable ? (e) => endNodeDrag(e, false) : undefined}
                  onDoubleClick={() => focusNode(rn.id)}
                >
                  <ChartCard
                    node={rn.node}
                    isRoot={isRoot}
                    collapsed={rn.collapsed}
                    childCount={rn.childCount}
                    canManage={canManage}
                    draggable={draggable}
                    dragging={dragNode != null}
                    isDragging={dragNode?.id === rn.id}
                    isDropTarget={dropTargetId === rn.id}
                    isSelected={selectedId === rn.id}
                    onPath={pathSet.has(rn.id) && rn.id !== selectedId}
                    isMatch={matchIds.has(rn.id)}
                    actions={actions}
                    onToggle={() => toggle(rn.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Floating drag ghost — a faithful copy of the card (same style), scaled
          to the current zoom so it matches the on-canvas size, following the
          cursor relative to the chart box. */}
      {dragNode && ghost && (
        <div
          className="pointer-events-none absolute z-50"
          style={{
            left: ghost.x,
            top: ghost.y,
            width: NODE_W,
            height: NODE_H,
            transform: `translate(-50%, -50%) scale(${tf.scale})`,
          }}
        >
          <div className="h-full rounded-xl border border-blue-400/70 bg-slate-900 px-3.5 py-2.5 shadow-2xl shadow-black/60 ring-2 ring-blue-400/30">
            <div className="flex h-full items-center gap-3">
              <CardFace node={dragNode} isRoot={dragNode.parent_id === null} />
              {/* Reserve the grip's footprint so CardFace truncates exactly as
                  it does on the real (always-draggable) source card. */}
              <span aria-hidden className="h-3.5 w-3.5 shrink-0" />
            </div>
          </div>
        </div>
      )}

      {/* Drag hint banner. */}
      {dragNode && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1 text-xs text-slate-300 shadow-sm backdrop-blur">
          {dropTargetId != null ? 'Release to move here' : 'Drag onto a unit to make it the new parent'}
        </div>
      )}

      {/* Empty / loading overlays. */}
      {(loading || !hasNodes) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {loading ? (
            <div className="flex flex-col items-center gap-5">
              <ChartSkeleton />
              <p className="text-xs font-medium text-slate-500">Loading organization…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-slate-500">
                {CompanyIcon}
              </span>
              <p className="text-sm font-medium text-slate-400">No organizations yet</p>
              <p className="text-xs text-slate-500">Create an organization to start building your chart.</p>
            </div>
          )}
        </div>
      )}

      {/* Search + expand/collapse all. */}
      {hasNodes && !dragNode && (
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-2 py-1 shadow-sm backdrop-blur focus-within:border-blue-500/60">
            <span className="text-slate-500">{SearchIcon}</span>
            <input
              value={search}
              onChange={(e) => runSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  gotoNextMatch()
                } else if (e.key === 'Escape') {
                  runSearch('')
                  e.currentTarget.blur()
                }
              }}
              placeholder="Find a unit…"
              aria-label="Find a unit"
              className="w-36 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
            {search && (
              <>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                  {matches.length ? `${curMatch + 1}/${matches.length}` : '0/0'}
                </span>
                <button
                  type="button"
                  onClick={() => runSearch('')}
                  aria-label="Clear search"
                  className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
                >
                  {XIcon}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={expandAll}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              Collapse all
            </button>
          </div>
        </div>
      )}

      {/* Zoom / fit / fullscreen controls. */}
      {hasNodes && (
        <div className="absolute bottom-4 right-4 flex items-center gap-2">
          <button type="button" className={ctlBtn} onClick={fitView} title="Fit to screen" aria-label="Fit to screen">
            {FitIcon}
          </button>
          <button
            type="button"
            className={ctlBtn}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {FullscreenIcon}
          </button>
          <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/90 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => zoomByCenter(1 / 1.2)}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-l-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
              title="Zoom out"
              aria-label="Zoom out"
            >
              {MinusIcon}
            </button>
            <span className="w-12 text-center text-xs font-medium tabular-nums text-slate-300">
              {Math.round(tf.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomByCenter(1.2)}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-r-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
              title="Zoom in"
              aria-label="Zoom in"
            >
              {PlusSmIcon}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
