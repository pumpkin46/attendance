import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRealtimeEvent, type RealtimeEvent } from '@/features/realtime/RealtimeContext'
import {
  appendMessageToCache,
  markMessageDeletedInCache,
  updateMessageInCache,
  usePresence,
} from '@/features/chat/api/queries'
import type { ChatMessage } from '@/features/chat/types'

interface TypingEntry {
  name: string
  at: number
}

/** Per-conversation typing state: convId → (userId → entry). */
type TypingState = Record<number, Record<number, TypingEntry>>
/** Per-conversation read receipts: convId → (userId → last read message id). */
type ReadsState = Record<number, Record<number, number>>

const TYPING_TTL_MS = 5000

/**
 * Live chat state driven by the realtime bus: keeps the message caches in sync
 * with incoming events and tracks ephemeral presence / typing / read-receipts.
 *
 * Typing is tracked for every conversation (the list shows a live "typing…"
 * indicator); read receipts are only kept for the active conversation (that's
 * the only place they're shown). Presence is global (it drives every avatar dot).
 */
export function useChatLiveState(meId: number | null, activeId: number | null) {
  const qc = useQueryClient()
  const { data: presenceData } = usePresence()
  const [presence, setPresence] = useState<Set<number>>(new Set())
  const [typing, setTyping] = useState<TypingState>({})
  const [reads, setReads] = useState<ReadsState>({})

  // Seed (and re-sync on reconnect refetch) the online set from the snapshot.
  // Render-phase reset keyed on snapshot identity — avoids a setState-in-effect
  // cascade; event-driven updates between refetches are preserved.
  const [seededSnap, setSeededSnap] = useState(presenceData)
  if (presenceData && presenceData !== seededSnap) {
    setSeededSnap(presenceData)
    setPresence(new Set(presenceData.online))
  }

  // Expire stale "typing" entries.
  useEffect(() => {
    const timer = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now()
        let changed = false
        const next: TypingState = {}
        for (const [cid, byUser] of Object.entries(prev)) {
          const kept: Record<number, TypingEntry> = {}
          for (const [uid, entry] of Object.entries(byUser)) {
            if (now - entry.at <= TYPING_TTL_MS) kept[+uid] = entry
            else changed = true
          }
          if (Object.keys(kept).length) next[+cid] = kept
          else if (Object.keys(byUser).length) changed = true
        }
        return changed ? next : prev
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  const handle = useCallback(
    (msg: RealtimeEvent) => {
      if (!msg.type.startsWith('chat.')) return
      const d = (msg.data ?? {}) as {
        message?: ChatMessage
        conversation_id?: number
        message_id?: number
        user_id?: number
        name?: string
        online?: boolean
        last_read_message_id?: number
      }
      switch (msg.type) {
        case 'chat.message':
          if (d.message) appendMessageToCache(qc, d.message.conversation_id, d.message)
          break
        case 'chat.message_updated':
          if (d.message) updateMessageInCache(qc, d.message.conversation_id, d.message)
          break
        case 'chat.message_deleted':
          if (d.conversation_id && d.message_id)
            markMessageDeletedInCache(qc, d.conversation_id, d.message_id)
          break
        case 'chat.typing':
          // Tracked for every conversation so the list can show a live "typing…"
          // indicator, not just the open thread.
          if (d.conversation_id && d.user_id && d.user_id !== meId) {
            const cid = d.conversation_id
            const uid = d.user_id
            const name = d.name ?? 'Someone'
            setTyping((prev) => ({
              ...prev,
              [cid]: { ...(prev[cid] ?? {}), [uid]: { name, at: Date.now() } },
            }))
          }
          break
        case 'chat.presence':
          if (d.user_id != null) {
            const uid = d.user_id
            const online = !!d.online
            setPresence((prev) => {
              const next = new Set(prev)
              if (online) next.add(uid)
              else next.delete(uid)
              return next
            })
          }
          break
        case 'chat.read':
          // Read receipts only matter for the conversation currently on screen.
          if (d.conversation_id === activeId && d.user_id != null && d.last_read_message_id != null) {
            const cid = d.conversation_id
            const uid = d.user_id
            const last = d.last_read_message_id
            setReads((prev) => ({ ...prev, [cid]: { ...(prev[cid] ?? {}), [uid]: last } }))
          }
          break
      }
    },
    [qc, meId, activeId],
  )

  useRealtimeEvent(handle)

  return { presence, typing, reads }
}
