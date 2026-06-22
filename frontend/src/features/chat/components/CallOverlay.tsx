import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/lib/cn'
import { Avatar } from '@/features/chat/components/Avatar'
import type { CallState } from '@/features/chat/hooks/useCall'

function Video({
  stream,
  muted,
  mirror,
  className,
}: {
  stream: MediaStream | null
  muted?: boolean
  mirror?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.srcObject = stream ?? null
    return () => {
      if (el) el.srcObject = null
    }
  }, [stream])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={cn(className, mirror && 'scale-x-[-1]')}
    />
  )
}

function useElapsed(startedAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    // First tick at +1s; the clamped value reads 0:00 until then, which is the
    // correct display for a call that just connected, then counts up accurately.
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  if (!startedAt) return null
  const s = Math.max(0, Math.round((now - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function RoundButton({
  label,
  onClick,
  tone = 'neutral',
  children,
}: {
  label: string
  onClick: () => void
  tone?: 'neutral' | 'danger' | 'active'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid h-12 w-12 place-items-center rounded-full text-white transition-colors',
        tone === 'danger' && 'bg-red-600 hover:bg-red-500',
        tone === 'active' && 'bg-white text-slate-900 hover:bg-slate-200',
        tone === 'neutral' && 'bg-white/15 hover:bg-white/25',
      )}
    >
      {children}
    </button>
  )
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)
const MicOffIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 9v-3a3 3 0 0 1 5.1-2.1M15 11.1V11M5 11a7 7 0 0 0 10.3 6.2M19 11a7 7 0 0 1-.5 2.6M12 18v3" />
    <path d="m2 2 20 20" />
  </svg>
)
const CamIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 9.5 5-3v11l-5-3z" />
  </svg>
)
const CamOffIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1m4 0h0M21 6.5l-5 3v5" />
    <path d="m2 2 20 20" />
  </svg>
)
const HangUpIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
    <path d="M12 9c-1.6 0-3.15.25-4.6.7v3.1c0 .39-.23.74-.56.88-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.66-1.85.998.998 0 0 1-.56-.88v-3.1A16.1 16.1 0 0 0 12 9z" />
  </svg>
)
const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
)

export function CallOverlay({
  call,
  localStream,
  remoteStream,
  onAccept,
  onReject,
  onHangUp,
  onToggleMute,
  onToggleCamera,
}: {
  call: CallState | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  onAccept: () => void
  onReject: () => void
  onHangUp: () => void
  onToggleMute: () => void
  onToggleCamera: () => void
}) {
  const elapsed = useElapsed(call?.startedAt ?? null)
  if (!call) return null

  // ── Incoming, not yet answered: compact ringing card ──────────────────────
  if (call.direction === 'incoming' && call.status === 'ringing') {
    return createPortal(
      <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm">
        <div className="w-[320px] rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
          <div className="relative mx-auto mb-4 w-fit">
            <span className="absolute -inset-2 animate-ping rounded-full bg-blue-500/20" />
            <Avatar name={call.peer.name} seed={call.peer.id} size="lg" />
          </div>
          <div className="text-lg font-semibold text-slate-100">{call.peer.name}</div>
          <div className="mt-1 text-sm text-slate-400">
            Incoming {call.video ? 'video' : 'voice'} call…
          </div>
          <div className="mt-6 flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={onReject}
              aria-label="Decline"
              className="grid h-14 w-14 place-items-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
            >
              <HangUpIcon />
            </button>
            <button
              type="button"
              onClick={onAccept}
              aria-label="Accept"
              className="grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-500"
            >
              {call.video ? <CamIcon /> : <PhoneIcon />}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  // ── Outgoing / connecting / active / ended: full call surface ─────────────
  const statusText =
    call.status === 'ended'
      ? 'Call ended'
      : call.status === 'active'
        ? elapsed ?? '0:00'
        : call.direction === 'outgoing'
          ? 'Calling…'
          : 'Connecting…'

  const showRemoteVideo = call.video && !!remoteStream && call.status === 'active'
  const showLocalVideo = call.video && !call.cameraOff && !!localStream

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950">
      {/* Remote video / avatar stage */}
      <div className="relative flex-1 overflow-hidden">
        {showRemoteVideo ? (
          <Video stream={remoteStream} className="h-full w-full bg-black object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-b from-slate-900 to-slate-950">
            <div className="text-center">
              <div className="mx-auto mb-4 w-fit">
                <Avatar name={call.peer.name} seed={call.peer.id} size="lg" />
              </div>
              <div className="text-xl font-semibold text-slate-100">{call.peer.name}</div>
              <div className="mt-1 text-sm text-slate-400">{statusText}</div>
            </div>
          </div>
        )}

        {/* Top status bar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-white">{call.peer.name}</div>
            <div className="text-xs text-slate-300">{statusText}</div>
          </div>
        </div>

        {/* Local picture-in-picture */}
        {showLocalVideo && (
          <div className="absolute bottom-4 right-4 h-32 w-24 overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg sm:h-36 sm:w-52">
            <Video stream={localStream} muted mirror className="h-full w-full object-cover" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 bg-slate-900/95 py-5">
        <RoundButton label={call.muted ? 'Unmute' : 'Mute'} onClick={onToggleMute} tone={call.muted ? 'active' : 'neutral'}>
          {call.muted ? <MicOffIcon /> : <MicIcon />}
        </RoundButton>
        {call.video && (
          <RoundButton
            label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
            onClick={onToggleCamera}
            tone={call.cameraOff ? 'active' : 'neutral'}
          >
            {call.cameraOff ? <CamOffIcon /> : <CamIcon />}
          </RoundButton>
        )}
        <button
          type="button"
          aria-label="End call"
          title="End call"
          onClick={onHangUp}
          className="grid h-14 w-14 place-items-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
        >
          <HangUpIcon />
        </button>
      </div>
    </div>,
    document.body,
  )
}
