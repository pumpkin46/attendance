import { api } from '@/shared/api/client'

export interface SdpJson {
  type: string
  sdp?: string
}

/**
 * WebRTC signaling relay. These are fire-and-forget POSTs — the server forwards
 * each payload to the other participant as a targeted realtime event; media then
 * flows peer-to-peer over the RTCPeerConnection.
 */
export const callApi = {
  offer: (conversationId: number, body: { call_id: string; sdp: SdpJson; video: boolean }) =>
    api.post(`/chat/calls/${conversationId}/offer`, body),
  answer: (conversationId: number, body: { call_id: string; sdp: SdpJson }) =>
    api.post(`/chat/calls/${conversationId}/answer`, body),
  ice: (conversationId: number, body: { call_id: string; candidate: RTCIceCandidateInit }) =>
    api.post(`/chat/calls/${conversationId}/ice`, body),
  end: (
    conversationId: number,
    body: { call_id: string; reason: string; duration_seconds?: number },
  ) => api.post(`/chat/calls/${conversationId}/end`, body),
}
