import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Combobox } from '@/shared/ui/Combobox'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import type { OrgNode } from '@/features/security/types'

export const ORG_NODE_FORM_ID = 'org-node-form'

/** Node types offered in the form (free-text on the backend, curated here). */
const NODE_TYPES = ['company', 'division', 'branch', 'department', 'team', 'unit'] as const

/**
 * Sensible default node_type for a new child, based on the parent's type:
 * a company's child defaults to "department", deeper levels to "team".
 */
const NEXT_TYPE: Record<string, string> = {
  company: 'department',
  division: 'department',
  branch: 'department',
  department: 'team',
  team: 'unit',
}

export function defaultChildType(parent: OrgNode | null): string {
  if (!parent) return 'department'
  return NEXT_TYPE[parent.node_type] ?? 'department'
}

/** Fields shared by create + edit; create needs name/code, edit allows is_active. */
export type OrgNodeFormValues = {
  name: string
  code: string
  node_type: string
  timezone: string
  is_active?: boolean
}

interface OrgNodeFormProps {
  /** The node being edited, or null when creating a child. */
  record: OrgNode | null
  /** Parent node a new child is being created under (create mode only). */
  parent: OrgNode | null
  onSubmit: (values: OrgNodeFormValues) => void
}

export function OrgNodeForm({ record, parent, onSubmit }: OrgNodeFormProps) {
  const [name, setName] = useState(record?.name ?? '')
  const [code, setCode] = useState(record?.code ?? '')
  const [nodeType, setNodeType] = useState(record?.node_type ?? defaultChildType(parent))
  const [timezone, setTimezone] = useState(record?.timezone ?? parent?.timezone ?? 'UTC')
  const [active, setActive] = useState(record?.is_active ?? true)

  return (
    <form
      id={ORG_NODE_FORM_ID}
      onSubmit={(e) => {
        e.preventDefault()
        if (record) {
          onSubmit({ name, code, node_type: nodeType, timezone, is_active: active })
        } else {
          onSubmit({ name, code, node_type: nodeType, timezone })
        }
      }}
    >
      {parent && !record && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
          <span className="text-xs uppercase tracking-wide text-slate-500">Parent</span>
          <span className="text-sm font-medium text-slate-200">{parent.path || parent.name}</span>
        </div>
      )}
      <Label>
        Name
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" />
      </Label>
      <Label>
        Code
        <Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="ENG" />
      </Label>
      <Label>
        Type
        <Combobox
          value={nodeType}
          onChange={setNodeType}
          options={NODE_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
        />
      </Label>
      <Label>
        Timezone
        <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
      </Label>
      {record && (
        <div className="pt-1">
          <Checkbox
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            label="Active"
            description="Inactive units are kept for history but hidden from day-to-day workflows."
          />
        </div>
      )}
    </form>
  )
}

interface FormFooterProps {
  isEdit: boolean
  saving: boolean
  onCancel: () => void
}

/** Shared footer buttons for the side panel hosting the form. */
export function OrgNodeFormFooter({ isEdit, saving, onCancel }: FormFooterProps) {
  return (
    <>
      <Button variant="ghost" type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" form={ORG_NODE_FORM_ID} isLoading={saving}>
        {isEdit ? 'Save changes' : 'Create'}
      </Button>
    </>
  )
}
