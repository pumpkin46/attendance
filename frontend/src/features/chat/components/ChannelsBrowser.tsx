import { SidePanel } from '@/shared/ui/SidePanel'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Loading'
import { useChannels, useJoinChannel } from '@/features/chat/api/queries'

export function ChannelsBrowser({
  open,
  onClose,
  onOpenChannel,
}: {
  open: boolean
  onClose: () => void
  onOpenChannel: (conversationId: number) => void
}) {
  const { data: channels, isLoading } = useChannels(open)
  const join = useJoinChannel()

  return (
    <SidePanel open={open} onClose={onClose} title="Channels" description="Company-wide channels you can join">
      {isLoading ? (
        <div className="grid h-32 place-items-center">
          <Spinner />
        </div>
      ) : (channels ?? []).length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">No channels yet. Create one from “New conversation”.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(channels ?? []).map((ch) => (
            <li
              key={ch.id}
              className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-700 text-slate-300">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M10 3 8 21M16 3l-2 18M4 8h16M3 16h16" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-100">{ch.name}</div>
                <div className="truncate text-xs text-slate-500">
                  {ch.member_count} member{ch.member_count === 1 ? '' : 's'}
                  {ch.topic ? ` · ${ch.topic}` : ''}
                </div>
              </div>
              {ch.joined ? (
                <Button size="sm" variant="ghost" onClick={() => onOpenChannel(ch.id)}>
                  Open
                </Button>
              ) : (
                <Button
                  size="sm"
                  isLoading={join.isPending}
                  onClick={async () => {
                    const conv = await join.mutateAsync(ch.id)
                    onOpenChannel(conv.id)
                  }}
                >
                  Join
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  )
}
