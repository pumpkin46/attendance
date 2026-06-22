import { useState } from 'react'
import { SidePanel } from '@/shared/ui/SidePanel'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { Label } from '@/shared/ui/Label'
import { Badge } from '@/shared/ui/Badge'
import { Avatar } from '@/features/chat/components/Avatar'
import { ContactMultiSelect } from '@/features/chat/components/ContactMultiSelect'
import {
  useAddMembers,
  useRemoveMember,
  useUpdateConversation,
} from '@/features/chat/api/queries'
import type { ChatConversation } from '@/features/chat/types'

export function ConversationInfoPanel({
  open,
  onClose,
  conversation,
  meId,
  presence,
  onLeft,
}: {
  open: boolean
  onClose: () => void
  conversation: ChatConversation
  meId: number | null
  presence: Set<number>
  onLeft: () => void
}) {
  const c = conversation
  const isManager = c.my_role === 'owner' || c.my_role === 'admin'
  const editable = c.type !== 'direct' && isManager

  const [name, setName] = useState(c.name ?? '')
  const [topic, setTopic] = useState(c.topic ?? '')
  const [adding, setAdding] = useState(false)
  const [toAdd, setToAdd] = useState<number[]>([])
  const [trackedId, setTrackedId] = useState(c.id)

  const update = useUpdateConversation()
  const addMembers = useAddMembers()
  const removeMember = useRemoveMember()

  // Reset the edit fields when switching to a different conversation (render-phase
  // reset, mirroring the codebase's AuthImage/SidebarNav pattern).
  if (trackedId !== c.id) {
    setTrackedId(c.id)
    setName(c.name ?? '')
    setTopic(c.topic ?? '')
    setAdding(false)
    setToAdd([])
  }

  const memberIds = (c.members ?? []).map((m) => m.user_id)

  const saveDetails = () => {
    update.mutate({
      conversationId: c.id,
      changes: { name: name.trim(), topic: topic.trim() },
    })
  }

  const submitAdd = async () => {
    if (toAdd.length === 0) return
    await addMembers.mutateAsync({ conversationId: c.id, userIds: toAdd })
    setToAdd([])
    setAdding(false)
  }

  const leave = async () => {
    if (meId == null) return
    await removeMember.mutateAsync({ conversationId: c.id, userId: meId })
    onLeft()
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={c.type === 'direct' ? 'Conversation' : c.type === 'channel' ? 'Channel details' : 'Group details'}
    >
      <div className="flex flex-col gap-6">
        {editable && (
          <div className="flex flex-col gap-3">
            <Label>
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Label>
            <Label>
              Topic
              <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxRows={4} />
            </Label>
            <Button
              size="sm"
              onClick={saveDetails}
              isLoading={update.isPending}
              disabled={name.trim() === (c.name ?? '') && topic.trim() === (c.topic ?? '')}
            >
              Save changes
            </Button>
          </div>
        )}

        {c.type !== 'direct' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                Members ({c.member_count})
              </h3>
              {isManager && (
                <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)}>
                  {adding ? 'Cancel' : 'Add people'}
                </Button>
              )}
            </div>

            {adding && (
              <div className="mb-3 rounded-lg border border-slate-700 p-3">
                <ContactMultiSelect
                  selected={toAdd}
                  excludeIds={memberIds}
                  presence={presence}
                  onToggle={(id) =>
                    setToAdd((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
                  }
                />
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() => void submitAdd()}
                  disabled={toAdd.length === 0}
                  isLoading={addMembers.isPending}
                >
                  Add {toAdd.length > 0 ? `(${toAdd.length})` : ''}
                </Button>
              </div>
            )}

            <ul className="flex flex-col gap-1">
              {(c.members ?? []).map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                  <Avatar name={m.name} seed={m.user_id} size="sm" online={presence.has(m.user_id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">
                      {m.name}
                      {m.user_id === meId && <span className="text-slate-500"> (you)</span>}
                    </div>
                    {m.email && <div className="truncate text-xs text-slate-500">{m.email}</div>}
                  </div>
                  {m.role !== 'member' && <Badge tone="neutral">{m.role}</Badge>}
                  {isManager && m.user_id !== meId && (
                    <button
                      type="button"
                      aria-label={`Remove ${m.name}`}
                      title="Remove"
                      onClick={() => removeMember.mutate({ conversationId: c.id, userId: m.user_id })}
                      className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-red-400"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {c.type === 'direct' && c.counterpart && (
          <div className="flex items-center gap-3">
            <Avatar name={c.counterpart.name} seed={c.counterpart.id} size="lg" online={presence.has(c.counterpart.id)} />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-slate-100">{c.counterpart.name}</div>
              {c.counterpart.email && <div className="truncate text-sm text-slate-400">{c.counterpart.email}</div>}
            </div>
          </div>
        )}

        {c.type !== 'direct' && (
          <div className="border-t border-slate-800 pt-4">
            <Button variant="danger" size="sm" onClick={() => void leave()} isLoading={removeMember.isPending}>
              Leave {c.type}
            </Button>
          </div>
        )}
      </div>
    </SidePanel>
  )
}
