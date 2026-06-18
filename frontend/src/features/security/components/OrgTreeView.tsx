import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { SidePanel } from '@/shared/ui/SidePanel'
import { TreeGrid, type TreeColumn } from '@/shared/ui/TreeGrid'
import { confirmDialog } from '@/shared/ui/dialogs'
import { cn } from '@/shared/lib/cn'
import type { OrgNode } from '@/features/security/types'
import {
  useCreateOrgNode,
  useDeleteOrgNode,
  useMoveOrgNode,
  useUpdateOrgNode,
} from '@/features/security/api/queries'
import { OrgNodeForm, OrgNodeFormFooter } from '@/features/security/components/OrgNodeForm'
import { MoveNodeFooter, MoveNodePanel } from '@/features/security/components/MoveNodePanel'

type Mode =
  | { kind: 'create'; parent: OrgNode }
  | { kind: 'edit'; node: OrgNode }
  | { kind: 'move'; node: OrgNode }

export function OrgTreeView({
  tree,
  loading,
  canManage,
  onEditCompany,
  onDeleteCompany,
}: {
  tree: OrgNode[]
  loading: boolean
  canManage: boolean
  /** Edit a company root — routed to the organizations endpoint, not nodes. */
  onEditCompany?: (root: OrgNode) => void
  /** Delete a company root. Omit to hide the action (e.g. the lone org). */
  onDeleteCompany?: (root: OrgNode) => void
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const createNode = useCreateOrgNode()
  const updateNode = useUpdateOrgNode()
  const moveNode = useMoveOrgNode()
  const deleteNode = useDeleteOrgNode()

  const saving = createNode.isPending || updateNode.isPending || moveNode.isPending
  const closePanel = () => setPanelOpen(false)
  const open = (next: Mode) => {
    setMode(next)
    setPanelOpen(true)
  }

  const removeNode = async (node: OrgNode) => {
    const ok = await confirmDialog({
      title: 'Delete org unit',
      message: `"${node.name}" will be permanently removed. Units that still have sub-units, employees, users, or locations cannot be deleted — move those first.`,
      confirmLabel: 'Delete unit',
    })
    if (ok) deleteNode.mutate(node.id)
  }

  const isRoot = (n: OrgNode) => n.parent_id === null

  const columns: TreeColumn<OrgNode>[] = [
    {
      key: 'name',
      header: 'Org unit',
      tree: true,
      cell: (n) => (
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'truncate font-medium',
              n.is_active ? 'text-slate-100' : 'text-slate-500'
            )}
          >
            {n.name}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-slate-500">{n.code}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '9rem',
      cell: (n) => (
        <Badge tone={isRoot(n) ? 'ok' : 'neutral'} className="capitalize">
          {n.node_type}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      cell: (n) => (
        <Badge tone={n.is_active ? 'ok' : 'warn'}>{n.is_active ? 'Active' : 'Inactive'}</Badge>
      ),
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: '13rem',
      align: 'right',
      cell: (n) => {
        const root = isRoot(n)
        return (
          <div
            className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Button variant="ghost" size="sm" onClick={() => open({ kind: 'create', parent: n })}>
              + Unit
            </Button>
            {(!root || onEditCompany) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (root ? onEditCompany?.(n) : open({ kind: 'edit', node: n }))}
              >
                Edit
              </Button>
            )}
            {!root && (
              <Button variant="ghost" size="sm" onClick={() => open({ kind: 'move', node: n })}>
                Move
              </Button>
            )}
            {root
              ? onDeleteCompany && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => onDeleteCompany(n)}
                  >
                    Delete
                  </Button>
                )
              : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteNode.isPending}
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => removeNode(n)}
                  >
                    Delete
                  </Button>
                )}
          </div>
        )
      },
    })
  }

  let panelTitle = ''
  if (mode?.kind === 'create') panelTitle = 'New org unit'
  else if (mode?.kind === 'edit') panelTitle = 'Edit org unit'
  else if (mode?.kind === 'move') panelTitle = 'Move org unit'

  let footer: React.ReactNode = null
  if (mode?.kind === 'create' || mode?.kind === 'edit') {
    footer = <OrgNodeFormFooter isEdit={mode.kind === 'edit'} saving={saving} onCancel={closePanel} />
  } else if (mode?.kind === 'move') {
    footer = <MoveNodeFooter saving={saving} onCancel={closePanel} />
  }

  return (
    <>
      <TreeGrid
        nodes={tree}
        columns={columns}
        getId={(n) => n.id}
        getChildren={(n) => n.children}
        getLabel={(n) => n.name}
        ariaLabel="Organization units"
        loading={loading}
        empty="No organizations yet"
        onActivate={
          canManage
            ? (n) => (isRoot(n) ? onEditCompany?.(n) : open({ kind: 'edit', node: n }))
            : undefined
        }
        rowClassName={(n) => (!n.is_active ? 'opacity-60' : undefined)}
      />

      <SidePanel
        open={panelOpen}
        title={panelTitle}
        description={
          mode?.kind === 'create'
            ? 'Add a sub-unit under the selected node.'
            : mode?.kind === 'edit'
              ? 'Update details for this org unit.'
              : mode?.kind === 'move'
                ? 'Re-parent this unit within its company.'
                : undefined
        }
        onClose={closePanel}
        footer={footer}
      >
        {mode?.kind === 'create' && (
          <OrgNodeForm
            key={`create-${mode.parent.id}`}
            record={null}
            parent={mode.parent}
            onSubmit={({ name, code, node_type, timezone }) =>
              createNode.mutate(
                { name, code, node_type, timezone, parent_id: mode.parent.id },
                { onSuccess: closePanel }
              )
            }
          />
        )}
        {mode?.kind === 'edit' && (
          <OrgNodeForm
            key={`edit-${mode.node.id}`}
            record={mode.node}
            parent={null}
            onSubmit={(values) =>
              updateNode.mutate({ id: mode.node.id, ...values }, { onSuccess: closePanel })
            }
          />
        )}
        {mode?.kind === 'move' && (
          <MoveNodePanel
            key={`move-${mode.node.id}`}
            node={mode.node}
            tree={tree}
            onSubmit={(newParentId) =>
              moveNode.mutate(
                { id: mode.node.id, new_parent_id: newParentId },
                { onSuccess: closePanel }
              )
            }
          />
        )}
      </SidePanel>
    </>
  )
}
