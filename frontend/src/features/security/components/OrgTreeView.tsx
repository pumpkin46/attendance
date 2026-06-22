import { useState } from 'react'
import { SidePanel } from '@/shared/ui/SidePanel'
import { confirmDialog } from '@/shared/ui/dialogs'
import type { OrgNode } from '@/features/security/types'
import {
  useCreateOrgNode,
  useDeleteOrgNode,
  useMoveOrgNode,
  useUpdateOrgNode,
} from '@/features/security/api/queries'
import { OrgChart } from '@/features/security/components/OrgChart'
import { OrgNodeForm, OrgNodeFormFooter } from '@/features/security/components/OrgNodeForm'
import { MoveNodeFooter, MoveNodePanel } from '@/features/security/components/MoveNodePanel'
import { AssignUsersPanel } from '@/features/users/components/AssignUsersPanel'

type Mode =
  | { kind: 'create'; parent: OrgNode }
  | { kind: 'edit'; node: OrgNode }
  | { kind: 'move'; node: OrgNode }

export function OrgTreeView({
  tree,
  loading,
  canManage,
  canAssignUsers = false,
  onEditCompany,
  onDeleteCompany,
}: {
  tree: OrgNode[]
  loading: boolean
  canManage: boolean
  /** Viewer can assign existing users to org nodes (users.manage). */
  canAssignUsers?: boolean
  /** Edit a company root — routed to the organizations endpoint, not nodes. */
  onEditCompany?: (root: OrgNode) => void
  /** Delete a company root. Omit to hide the action (e.g. the lone org). */
  onDeleteCompany?: (root: OrgNode) => void
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  // Keep `assignNode` set while the panel slides out (open drives visibility) so
  // its content doesn't flash an empty/un-granted state during the exit.
  const [assignNode, setAssignNode] = useState<OrgNode | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)

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
      <OrgChart
        tree={tree}
        loading={loading}
        canManage={canManage}
        onAddChild={(n) => open({ kind: 'create', parent: n })}
        onEdit={(n) => open({ kind: 'edit', node: n })}
        onMove={(n) => open({ kind: 'move', node: n })}
        onMoveTo={(n, newParentId) => moveNode.mutate({ id: n.id, new_parent_id: newParentId })}
        onDelete={(n) => void removeNode(n)}
        onEditCompany={onEditCompany}
        onDeleteCompany={onDeleteCompany}
        onAssignUsers={
          canAssignUsers
            ? (n) => {
                setAssignNode(n)
                setAssignOpen(true)
              }
            : undefined
        }
      />

      <AssignUsersPanel open={assignOpen} node={assignNode} onClose={() => setAssignOpen(false)} />

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
