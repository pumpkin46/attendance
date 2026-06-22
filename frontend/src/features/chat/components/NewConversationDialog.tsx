import { useState } from 'react'
import { SidePanel } from '@/shared/ui/SidePanel'
import { Tabs } from '@/shared/ui/Tabs'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { Label } from '@/shared/ui/Label'
import { Spinner } from '@/shared/ui/Loading'
import { Avatar } from '@/features/chat/components/Avatar'
import { ContactMultiSelect } from '@/features/chat/components/ContactMultiSelect'
import { useContacts, useCreateConversation } from '@/features/chat/api/queries'

type Mode = 'direct' | 'group' | 'channel'

export function NewConversationDialog({
  open,
  onClose,
  presence,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  presence: Set<number>
  onCreated: (conversationId: number) => void
}) {
  const [mode, setMode] = useState<Mode>('direct')
  const [search, setSearch] = useState('')
  const [members, setMembers] = useState<number[]>([])
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const create = useCreateConversation()
  const { data: contacts, isLoading } = useContacts(search, mode === 'direct')

  const reset = () => {
    setMembers([])
    setName('')
    setTopic('')
    setSearch('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const done = (id: number) => {
    reset()
    onCreated(id)
  }

  const startDirect = async (userId: number) => {
    const conv = await create.mutateAsync({ type: 'direct', user_id: userId })
    done(conv.id)
  }

  const createGroup = async () => {
    if (!name.trim() || members.length === 0) return
    const conv = await create.mutateAsync({ type: 'group', name: name.trim(), member_ids: members })
    done(conv.id)
  }

  const createChannel = async () => {
    if (!name.trim()) return
    const conv = await create.mutateAsync({
      type: 'channel',
      name: name.trim(),
      topic: topic.trim() || undefined,
    })
    done(conv.id)
  }

  return (
    <SidePanel
      open={open}
      onClose={close}
      title="New conversation"
      description="Start a direct message, group, or channel"
    >
      <Tabs
        tabs={[
          { id: 'direct', label: 'Direct' },
          { id: 'group', label: 'Group' },
          { id: 'channel', label: 'Channel' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'direct' && (
        <div data-autofocus>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people"
            className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="scrollbar-styled max-h-[60vh] overflow-y-auto rounded-lg border border-slate-700">
            {isLoading ? (
              <div className="grid h-24 place-items-center">
                <Spinner size="sm" />
              </div>
            ) : (contacts ?? []).length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">No people found</p>
            ) : (
              (contacts ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={create.isPending}
                  onClick={() => void startDirect(c.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-slate-800/60 disabled:opacity-50"
                >
                  <Avatar name={c.name} seed={c.id} size="sm" online={presence.has(c.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">{c.name}</div>
                    {c.email && <div className="truncate text-xs text-slate-500">{c.email}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {mode === 'group' && (
        <div className="flex flex-col gap-4">
          <Label>
            Group name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project Falcon" />
          </Label>
          <div>
            <span className="mb-1.5 block text-sm text-slate-400">
              Members {members.length > 0 && `(${members.length})`}
            </span>
            <ContactMultiSelect
              selected={members}
              onToggle={(id) =>
                setMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
              }
              presence={presence}
            />
          </div>
          <Button onClick={() => void createGroup()} disabled={!name.trim() || members.length === 0} isLoading={create.isPending}>
            Create group
          </Button>
        </div>
      )}

      {mode === 'channel' && (
        <div className="flex flex-col gap-4">
          <Label>
            Channel name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. announcements" />
          </Label>
          <Label>
            Topic (optional)
            <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxRows={4} placeholder="What is this channel about?" />
          </Label>
          <p className="text-xs text-slate-500">
            Channels are visible to everyone in your company and anyone can join.
          </p>
          <Button onClick={() => void createChannel()} disabled={!name.trim()} isLoading={create.isPending}>
            Create channel
          </Button>
        </div>
      )}
    </SidePanel>
  )
}
