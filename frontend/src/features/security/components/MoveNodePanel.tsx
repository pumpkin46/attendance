import { useMemo, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Combobox } from '@/shared/ui/Combobox'
import { Label } from '@/shared/ui/Label'
import type { OrgNode } from '@/features/security/types'
import { breadcrumbLabels, descendantIds, findNode, flattenTree } from '@/features/security/lib/tree'

export const MOVE_FORM_ID = 'org-node-move-form'

interface MoveNodePanelProps {
  /** The node being moved. */
  node: OrgNode
  /** The full company-root tree (top-level roots, each nested). */
  tree: OrgNode[]
  onSubmit: (newParentId: number) => void
}

/**
 * Pick a new parent for `node` from a flattened list of candidates in the SAME
 * company. The node itself, its descendants, and its current parent are
 * filtered out client-side; the server is still authoritative and surfaces 409
 * (cycle / cross-tenant / company-root) via a toast.
 */
export function MoveNodePanel({ node, tree, onSubmit }: MoveNodePanelProps) {
  const [parentId, setParentId] = useState('')

  // Anchor to the company root so candidates are tenant-scoped. Memoize on
  // stable inputs so the `[root]` literal does not recompute the breadcrumb /
  // options memos on every render.
  const root = findNode(tree, node.root_organization_id)
  const scope = useMemo(() => (root ? [root] : tree), [root, tree])
  const labels = useMemo(() => breadcrumbLabels(scope), [scope])
  const movingLabel = labels.get(node.id) ?? node.name

  const options = useMemo(() => {
    const blocked = descendantIds(node)
    blocked.add(node.id)
    return flattenTree(scope)
      .filter((candidate) => candidate.root_organization_id === node.root_organization_id)
      .filter((candidate) => !blocked.has(candidate.id))
      .filter((candidate) => candidate.id !== node.parent_id)
      .map((candidate) => ({
        value: String(candidate.id),
        label: labels.get(candidate.id) ?? candidate.name,
      }))
  }, [node, scope, labels])

  return (
    <form
      id={MOVE_FORM_ID}
      onSubmit={(e) => {
        e.preventDefault()
        if (parentId) onSubmit(Number(parentId))
      }}
    >
      <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
        <span className="text-xs uppercase tracking-wide text-slate-500">Moving</span>
        <span className="text-sm font-medium text-slate-200">{movingLabel}</span>
      </div>
      <Label>
        New parent
        <Combobox
          value={parentId}
          onChange={setParentId}
          required
          placeholder={options.length ? 'Select a new parent…' : 'No eligible parents'}
          options={options}
        />
      </Label>
      <p className="mt-1 text-xs text-slate-500">
        A unit can only move within its own company and cannot become a child of itself or its
        sub-units.
      </p>
    </form>
  )
}

interface MoveFooterProps {
  saving: boolean
  onCancel: () => void
}

export function MoveNodeFooter({ saving, onCancel }: MoveFooterProps) {
  return (
    <>
      <Button variant="ghost" type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" form={MOVE_FORM_ID} isLoading={saving}>
        Move unit
      </Button>
    </>
  )
}
