import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useRealtimeEvent, type RealtimeEvent } from '@/features/realtime/RealtimeContext'
import { callApi, type SdpJson } from '@/features/chat/api/calls'

export type CallStatus = 'ringing' | 'connecting' | 'active' | 'ended'

export interface CallPeer {
  id: number
  name: string
}

export interface CallState {
  callId: string
  conversationId: number
  peer: CallPeer
  direction: 'outgoing' | 'incoming'
  video: boolean
  status: CallStatus
  muted: boolean
  cameraOff: boolean
  startedAt: number | null
  endedReason?: string
}

const RING_TIMEOUT_MS = 35_000

const env = import.meta.env as Record<string, string | undefined>
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]
// Optional TURN relay for restrictive NATs (set VITE_TURN_URL/_USERNAME/_CREDENTIAL).
if (env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: env.VITE_TURN_URL,
    username: env.VITE_TURN_USERNAME,
    credential: env.VITE_TURN_CREDENTIAL,
  })
}

function newCallId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

/**
 * 1:1 WebRTC call manager: owns the RTCPeerConnection, local/remote media, and
 * the signaling state machine (offer/answer/ICE/end) over the realtime bus.
 * Mount once (in ChatPage); it handles both outgoing and incoming calls.
 */
export function useCall() {
  const [call, setCall] = useState<CallState | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const callRef = useRef<CallState | null>(null)
  const incomingOfferRef = useRef<SdpJson | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const endTimerRef = useRef<number | null>(null)
  const ringTimerRef = useRef<number | null>(null)

  useEffect(() => {
    callRef.current = call
  }, [call])

  const teardownMedia = () => {
    if (ringTimerRef.current) {
      window.clearTimeout(ringTimerRef.current)
      ringTimerRef.current = null
    }
    const pc = pcRef.current
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.getSenders().forEach((s) => s.track?.stop())
      try {
        pc.close()
      } catch {
        /* already closed */
      }
    }
    pcRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    incomingOfferRef.current = null
    pendingIceRef.current = []
    setLocalStream(null)
    setRemoteStream(null)
  }

  /** End the call locally; optionally tell the peer (skip when the peer ended it). */
  const endLocal = (reason: string, notifyPeer: boolean) => {
    const c = callRef.current
    teardownMedia()
    if (c && notifyPeer) {
      const duration = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : undefined
      void callApi.end(c.conversationId, { call_id: c.callId, reason, duration_seconds: duration }).catch(() => {})
    }
    if (!c) {
      setCall(null)
      return
    }
    setCall({ ...c, status: 'ended', endedReason: reason })
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current)
    endTimerRef.current = window.setTimeout(() => {
      setCall((cur) => (cur && cur.callId === c.callId ? null : cur))
    }, 1400)
  }

  const createPeer = (callId: string, conversationId: number): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void callApi.ice(conversationId, { call_id: callId, candidate: e.candidate.toJSON() }).catch(() => {})
      }
    }
    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? null)
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') {
        setCall((c) => (c && !c.startedAt ? { ...c, status: 'active', startedAt: Date.now() } : c))
      } else if (st === 'failed') {
        endLocal('failed', true)
      }
    }
    return pc
  }

  const getMedia = async (video: boolean): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      toast.error('Could not access your camera or microphone')
      return null
    }
  }

  const startCall = async (opts: { conversationId: number; peer: CallPeer; video: boolean }) => {
    if (callRef.current) return // already in a call
    const callId = newCallId()
    const stream = await getMedia(opts.video)
    if (!stream) return
    localStreamRef.current = stream
    setLocalStream(stream)

    const pc = createPeer(callId, opts.conversationId)
    pcRef.current = pc
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))

    setCall({
      callId,
      conversationId: opts.conversationId,
      peer: opts.peer,
      direction: 'outgoing',
      video: opts.video,
      status: 'ringing',
      muted: false,
      cameraOff: false,
      startedAt: null,
    })

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await callApi.offer(opts.conversationId, {
        call_id: callId,
        sdp: { type: offer.type, sdp: offer.sdp },
        video: opts.video,
      })
    } catch {
      endLocal('failed', false)
      return
    }

    ringTimerRef.current = window.setTimeout(() => {
      const c = callRef.current
      if (c && c.callId === callId && c.status === 'ringing') endLocal('unanswered', true)
    }, RING_TIMEOUT_MS)
  }

  const acceptCall = async () => {
    const c = callRef.current
    const offer = incomingOfferRef.current
    if (!c || c.direction !== 'incoming' || !offer) return
    if (pcRef.current) return // already accepting — ignore a double-tap
    const stream = await getMedia(c.video)
    if (!stream) {
      endLocal('failed', true)
      return
    }
    localStreamRef.current = stream
    setLocalStream(stream)

    const pc = createPeer(c.callId, c.conversationId)
    pcRef.current = pc
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))

    try {
      await pc.setRemoteDescription(offer as RTCSessionDescriptionInit)
      for (const cand of pendingIceRef.current) {
        try {
          await pc.addIceCandidate(cand)
        } catch {
          /* ignore bad candidate */
        }
      }
      pendingIceRef.current = []
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await callApi.answer(c.conversationId, { call_id: c.callId, sdp: { type: answer.type, sdp: answer.sdp } })
      setCall((cur) => (cur ? { ...cur, status: 'connecting' } : cur))
    } catch {
      endLocal('failed', true)
    }
  }

  const rejectCall = () => endLocal('reject', true)
  const hangUp = () => {
    const c = callRef.current
    endLocal(c?.status === 'active' ? 'hangup' : 'cancel', true)
  }

  const toggleMute = () => {
    const s = localStreamRef.current
    if (!s) return
    const enabled = !(s.getAudioTracks()[0]?.enabled ?? true)
    s.getAudioTracks().forEach((t) => (t.enabled = enabled))
    setCall((c) => (c ? { ...c, muted: !enabled } : c))
  }

  const toggleCamera = () => {
    const s = localStreamRef.current
    if (!s) return
    const enabled = !(s.getVideoTracks()[0]?.enabled ?? true)
    s.getVideoTracks().forEach((t) => (t.enabled = enabled))
    setCall((c) => (c ? { ...c, cameraOff: !enabled } : c))
  }

  // ── Incoming signaling ────────────────────────────────────────────────────
  const handleSignal = async (type: string, d: {
    call_id?: string
    conversation_id?: number
    from_user?: CallPeer
    sdp?: SdpJson
    candidate?: RTCIceCandidateInit
    video?: boolean
    reason?: string
  }) => {
    if (!d.call_id) return
    const current = callRef.current

    if (type === 'chat.call.offer') {
      if (!d.conversation_id || !d.from_user || !d.sdp) return
      if (current) {
        // Glare: both peers placed an outgoing call before either connected.
        // Deterministic tie-break by call_id — the smaller id wins. If theirs
        // wins, abort mine and accept theirs; if mine wins, ignore their offer
        // (they will abort and accept mine). Any other state = genuinely busy.
        const glare = current.direction === 'outgoing' && current.status === 'ringing'
        if (glare && d.call_id < current.callId) {
          teardownMedia()
          // fall through to set up the incoming call below
        } else if (glare) {
          return
        } else {
          void callApi.end(d.conversation_id, { call_id: d.call_id, reason: 'busy' }).catch(() => {})
          return
        }
      }
      incomingOfferRef.current = d.sdp
      pendingIceRef.current = []
      setCall({
        callId: d.call_id,
        conversationId: d.conversation_id,
        peer: d.from_user,
        direction: 'incoming',
        video: d.video ?? true,
        status: 'ringing',
        muted: false,
        cameraOff: false,
        startedAt: null,
      })
      return
    }

    if (!current || current.callId !== d.call_id) return

    if (type === 'chat.call.answer') {
      const pc = pcRef.current
      if (!pc || !d.sdp) return
      // Ignore a duplicate/late answer — applying one when not awaiting an answer
      // throws InvalidStateError, which must not tear down a live call.
      if (pc.signalingState !== 'have-local-offer') return
      try {
        await pc.setRemoteDescription(d.sdp as RTCSessionDescriptionInit)
        for (const cand of pendingIceRef.current) {
          try {
            await pc.addIceCandidate(cand)
          } catch {
            /* ignore */
          }
        }
        pendingIceRef.current = []
        setCall((c) => (c ? { ...c, status: 'connecting' } : c))
      } catch {
        endLocal('failed', true)
      }
    } else if (type === 'chat.call.ice') {
      if (!d.candidate) return
      const pc = pcRef.current
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(d.candidate)
        } catch {
          /* ignore */
        }
      } else {
        pendingIceRef.current.push(d.candidate)
      }
    } else if (type === 'chat.call.end') {
      endLocal(d.reason ?? 'ended', false)
    }
  }

  useRealtimeEvent((msg: RealtimeEvent) => {
    if (!msg.type.startsWith('chat.call.')) return
    const d = (msg.data ?? {}) as {
      call_id?: string
      conversation_id?: number
      from_user?: CallPeer
      sdp?: SdpJson
      candidate?: RTCIceCandidateInit
      video?: boolean
      reason?: string
    }
    void handleSignal(msg.type, d)
  })

  // Free media (and notify the peer) if the chat unmounts mid-call.
  useEffect(
    () => () => {
      const c = callRef.current
      if (c) {
        const duration = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : undefined
        void callApi.end(c.conversationId, { call_id: c.callId, reason: 'hangup', duration_seconds: duration }).catch(() => {})
      }
      teardownMedia()
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current)
    },
    [],
  )

  return { call, localStream, remoteStream, startCall, acceptCall, rejectCall, hangUp, toggleMute, toggleCamera }
}
