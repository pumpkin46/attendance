import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/api/client'
import { toApiPath } from '@/shared/lib/authMedia'

const BAR_COUNT = 28

function fmt(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

/** Deterministic pseudo-waveform bar heights (we don't decode real samples). */
function barHeights(seed: string): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const out: number[] = []
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    out.push(25 + (h % 75)) // 25%..100%
  }
  return out
}

/**
 * Voice-message player: lazily fetches the (auth-gated) audio as a blob on first
 * play, then renders a play/pause control, a tap-to-seek waveform, and a timer.
 */
export function AudioPlayer({ src, own }: { src: string; own: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const loadingRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)

  const bars = useMemo(() => barHeights(src), [src])

  // Tear down (and revoke the blob URL) on unmount AND when src changes, so a
  // reused instance never plays a stale clip or leaks the previous URL.
  useEffect(
    () => () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      audioRef.current = null
      urlRef.current = null
      loadingRef.current = false
      setPlaying(false)
      setProgress(0)
      setCurrent(0)
      setDuration(0)
    },
    [src],
  )

  const ensureAudio = async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current
    if (loadingRef.current) return null // a fetch is already in flight
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await api.get<Blob>(toApiPath(src), { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      urlRef.current = url
      const audio = new Audio(url)
      audio.onloadedmetadata = () => setDuration(audio.duration || 0)
      audio.ontimeupdate = () => {
        setCurrent(audio.currentTime)
        setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
      }
      audio.onended = () => {
        setPlaying(false)
        setProgress(0)
        setCurrent(0)
      }
      audioRef.current = audio
      return audio
    } catch {
      return null
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  const toggle = async () => {
    const audio = await ensureAudio()
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      try {
        await audio.play()
        setPlaying(true)
      } catch {
        setPlaying(false)
      }
    }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * audio.duration
    setProgress(ratio)
  }

  const playedColor = own ? 'bg-white' : 'bg-blue-400'
  const restColor = own ? 'bg-white/40' : 'bg-slate-600'
  const timeShown = playing || current > 0 ? current : duration

  return (
    <div className="flex w-56 items-center gap-3">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        aria-label={playing ? 'Pause' : 'Play voice message'}
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-70',
          own ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-blue-600 text-white hover:bg-blue-500',
        )}
      >
        {loading ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          onClick={seek}
          className="flex h-7 cursor-pointer items-center gap-[2px]"
          role="presentation"
        >
          {bars.map((height, i) => {
            const played = i / BAR_COUNT <= progress
            return (
              <span
                key={i}
                className={cn('w-[3px] shrink-0 rounded-full', played ? playedColor : restColor)}
                style={{ height: `${height}%` }}
              />
            )
          })}
        </div>
        <div className={cn('mt-0.5 text-[10px] tabular-nums', own ? 'text-blue-100' : 'text-slate-400')}>
          {fmt(timeShown)}
        </div>
      </div>
    </div>
  )
}
