import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/cn'
import { Field, Switch, ToggleRow } from '@/features/security/components/PanelKit'
import { NODE_TYPES, typeStyle } from '@/features/security/lib/nodeType'
import type { OrgNode } from '@/features/security/types'

export const ORG_NODE_FORM_ID = 'org-node-form'

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

function defaultChildType(parent: OrgNode | null): string {
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

// ── Building blocks ────────────────────────────────────────────────────────────

function TypePicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {NODE_TYPES.map((t) => {
        const { icon, tile } = typeStyle(t)
        const selected = value === t
        return (
          <button
            key={t}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(t)}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
              selected
                ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40'
                : 'border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800/50'
            )}
          >
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tile)}>
              {icon}
            </span>
            <span className="truncate text-sm font-medium capitalize text-slate-200">{t}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Live mirror of how the unit will appear as a card in the org chart. */
function NodePreview({ name, code, type }: { name: string; code: string; type: string }) {
  const { icon, tile } = typeStyle(type)
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 shadow-lg shadow-black/20">
      <div className="flex items-center gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', tile)}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">
            {name.trim() || 'Unit name'}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-mono text-[11px] uppercase">{code.trim() || 'CODE'}</span>
            <span aria-hidden>·</span>
            <span className="capitalize">{type}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ParentChip({ parent }: { parent: OrgNode }) {
  const { icon, tile } = typeStyle(parent.node_type, parent.parent_id === null)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tile)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          New sub-unit under
        </div>
        <div className="truncate text-sm font-medium text-slate-200">{parent.name}</div>
      </div>
    </div>
  )
}

// ── Form ─────────────────────────────────────────────────────────────────────

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
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (record) {
          onSubmit({ name, code, node_type: nodeType, timezone, is_active: active })
        } else {
          onSubmit({ name, code, node_type: nodeType, timezone })
        }
      }}
    >
      {parent && !record && <ParentChip parent={parent} />}

      <Field label="Unit type" hint="How it shows on the chart">
        <TypePicker value={nodeType} onChange={setNodeType} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="on-name" required autoFocus>
          <Input
            id="on-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
          />
        </Field>
        <Field label="Code" htmlFor="on-code" hint="Short & unique" required>
          <Input
            id="on-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ENG"
            className="font-mono uppercase"
          />
        </Field>
      </div>

      <Field label="Timezone" htmlFor="on-tz">
        <Input
          id="on-tz"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="UTC"
        />
      </Field>

      <Field label="Preview">
        <NodePreview name={name} code={code} type={nodeType} />
      </Field>

      {record && (
        <ToggleRow
          title="Active"
          description="Inactive units are kept for history but hidden from day-to-day workflows."
        >
          <Switch checked={active} onChange={setActive} id="on-active" />
        </ToggleRow>
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
