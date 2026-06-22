import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Popover } from '@/shared/ui/Popover'
import { Avatar } from '@/features/chat/components/Avatar'
import { EmojiPicker } from '@/features/chat/components/EmojiPicker'
import type { ChatMessage } from '@/features/chat/types'

const LINE_PX = 20
const MAX_ROWS = 8

export interface MentionCandidate {
  id: number
  name: string
}

function fmtSecs(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

export function MessageComposer({
  disabled,
  placeholder,
  replyTo,
  onCancelReply,
  mentionCandidates,
  onTyping,
  onSend,
}: {
  disabled?: boolean
  placeholder?: string
  replyTo: ChatMessage | null
  onCancelReply: () => void
  mentionCandidates: MentionCandidate[]
  onTyping: () => void
  onSend: (input: { body: string; files: File[]; mentionIds: number[] }) => void
}) {
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const urlsRef = useRef<Set<string>>(new Set())
  const mentionedRef = useRef<Set<number>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const pendingCaretRef = useRef<number | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)

  // ── Voice recording ─────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false)
  const [recordSecs, setRecordSecs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<number | null>(null)

  const fit = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS * LINE_PX + 16)}px`
  }

  useEffect(() => {
    if (textareaRef.current) fit(textareaRef.current)
  }, [body])

  useEffect(() => {
    if (pendingCaretRef.current != null && textareaRef.current) {
      const pos = pendingCaretRef.current
      pendingCaretRef.current = null
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(pos, pos)
    }
  }, [body])

  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
      // Stop any in-progress recording on unmount.
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
      recorderRef.current?.stop()
      recordStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at === -1) return setMentionQuery(null)
    const prev = before[at - 1]
    if (at > 0 && prev && !/\s/.test(prev)) return setMentionQuery(null)
    const token = before.slice(at + 1)
    if (token.includes('\n')) return setMentionQuery(null)
    setMentionQuery(token)
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value)
    detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
    onTyping()
  }

  const insertAtCaret = (text: string) => {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? body.length
    const next = body.slice(0, caret) + text + body.slice(caret)
    pendingCaretRef.current = caret + text.length
    setBody(next)
  }

  const pickMention = (c: MentionCandidate) => {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? body.length
    const before = body.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at === -1) return
    const insert = `@${c.name} `
    const newBefore = before.slice(0, at) + insert
    pendingCaretRef.current = newBefore.length
    setBody(newBefore + body.slice(caret))
    mentionedRef.current.add(c.id)
    setMentionQuery(null)
  }

  const candidates = useMemo(() => {
    if (mentionQuery == null) return []
    const q = mentionQuery.toLowerCase()
    return mentionCandidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6)
  }, [mentionQuery, mentionCandidates])

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    const have = new Set(files.map(fileKey))
    const fresh = Array.from(list).filter((f) => !have.has(fileKey(f)))
    if (!fresh.length) return
    const newPreviews: Record<string, string> = {}
    for (const f of fresh) {
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f)
        newPreviews[fileKey(f)] = url
        urlsRef.current.add(url)
      }
    }
    setFiles((prev) => [...prev, ...fresh])
    setPreviews((prev) => ({ ...prev, ...newPreviews }))
  }

  const removeFile = (f: File) => {
    setFiles((prev) => prev.filter((x) => x !== f))
    setPreviews((prev) => {
      const k = fileKey(f)
      const url = prev[k]
      if (url) {
        URL.revokeObjectURL(url)
        urlsRef.current.delete(url)
      }
      const next = { ...prev }
      delete next[k]
      return next
    })
  }

  const canSend = (body.trim().length > 0 || files.length > 0) && !disabled

  const submit = () => {
    if (!canSend) return
    const text = body
    const mentionIds = [...mentionedRef.current].filter((id) => {
      const name = mentionCandidates.find((c) => c.id === id)?.name
      return name != null && new RegExp(`@${escapeRegExp(name)}(?:\\s|$)`).test(text)
    })
    onSend({ body: text.trim(), files, mentionIds })
    setBody('')
    setFiles([])
    setPreviews((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u))
      return {}
    })
    urlsRef.current.clear()
    mentionedRef.current.clear()
    setMentionQuery(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery != null && candidates.length && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      pickMention(candidates[0])
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && replyTo) {
      onCancelReply()
    }
  }

  // ── Voice recording handlers ──────────────────────────────────────────────
  const startRecording = async () => {
    if (disabled || recording) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast.error('Could not access your microphone')
      return
    }
    recordStreamRef.current = stream
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunksRef.current = []
    mr.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data)
    }
    recorderRef.current = mr
    mr.start()
    setRecording(true)
    setRecordSecs(0)
    recordTimerRef.current = window.setInterval(() => setRecordSecs((s) => s + 1), 1000)
  }

  const stopRecording = (send: boolean) => {
    const mr = recorderRef.current
    if (!mr) return
    mr.onstop = () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
      recordStreamRef.current?.getTracks().forEach((t) => t.stop())
      const type = mr.mimeType || 'audio/webm'
      if (send && chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type })
        const ext = type.includes('ogg') ? 'ogg' : 'webm'
        const file = new File([blob], `voice-message.${ext}`, { type: blob.type })
        onSend({ body: '', files: [file], mentionIds: [] })
      } else if (send) {
        toast.error('Recording too short')
      }
      chunksRef.current = []
      recorderRef.current = null
      recordStreamRef.current = null
      setRecording(false)
      setRecordSecs(0)
    }
    mr.stop()
  }

  return (
    <div ref={wrapRef} className="border-t border-slate-800 bg-slate-900 px-4 py-3">
      {replyTo && !recording && (
        <div className="mb-2 flex items-center justify-between rounded-lg border-l-2 border-blue-500 bg-slate-800/60 px-3 py-1.5 text-xs">
          <span className="min-w-0 truncate text-slate-400">
            Replying to <span className="font-medium text-slate-200">{replyTo.sender?.name ?? 'Unknown'}</span>
            {replyTo.body ? ` — ${replyTo.body}` : ''}
          </span>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="ml-2 text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>
      )}

      {files.length > 0 && !recording && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <div key={fileKey(f)} className="relative">
              {previews[fileKey(f)] ? (
                <img src={previews[fileKey(f)]} alt={f.name} className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-700" />
              ) : (
                <div className="flex h-16 w-40 items-center gap-2 rounded-lg bg-slate-800 px-2 ring-1 ring-slate-700">
                  <span className="truncate text-xs text-slate-300">{f.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(f)}
                aria-label={`Remove ${f.name}`}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-slate-700 text-xs text-slate-200 ring-1 ring-slate-900 hover:bg-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {recording ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Cancel recording"
            title="Cancel"
            onClick={() => stopRecording(false)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-800 hover:text-red-400"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-3xl bg-slate-800 px-4 py-2.5">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm tabular-nums text-slate-300">Recording… {fmtSecs(recordSecs)}</span>
          </div>
          <button
            type="button"
            aria-label="Send voice message"
            title="Send"
            onClick={() => stopRecording(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500 active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 items-end gap-1 rounded-3xl border border-slate-600 bg-slate-800 px-2 py-1 transition-colors focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
            <button
              type="button"
              aria-label="Attach files"
              title="Attach files"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.5 12.5 21a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.8-7.8" />
              </svg>
            </button>

            <textarea
              ref={textareaRef}
              value={body}
              rows={1}
              disabled={disabled}
              placeholder={placeholder ?? 'Your message'}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onClick={(e) => detectMention(body, e.currentTarget.selectionStart ?? 0)}
              className="scrollbar-styled max-h-40 min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
            />

            <button
              ref={emojiBtnRef}
              type="button"
              aria-label="Emoji"
              title="Emoji"
              disabled={disabled}
              onClick={() => setEmojiOpen(true)}
              className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {canSend ? (
            <button
              type="button"
              aria-label="Send message"
              title="Send"
              onClick={submit}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-sm transition-all hover:bg-blue-500 active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m22 2-7 20-4-9-9-4z" />
                <path d="M22 2 11 13" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              aria-label="Record voice message"
              title="Record voice message"
              disabled={disabled}
              onClick={() => void startRecording()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-sm transition-all hover:bg-blue-500 active:scale-95 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
        </div>
      )}

      <EmojiPicker
        anchorRef={emojiBtnRef}
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onPick={(e) => insertAtCaret(e)}
      />

      <Popover
        anchorRef={wrapRef}
        open={mentionQuery != null && candidates.length > 0}
        onClose={() => setMentionQuery(null)}
        matchWidth={false}
        className="w-64 p-1"
      >
        <ul className="flex flex-col">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(c)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                <Avatar name={c.name} seed={c.id} size="sm" />
                <span className="truncate">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  )
}

function fileKey(f: File): string {
  return `${f.name}-${f.size}-${f.lastModified}`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
