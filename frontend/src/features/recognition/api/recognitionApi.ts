import { api } from '@/shared/api/client'
import type { DetectResponse, IdentifyResult } from '@/features/recognition/types'

/** Imperative recognition calls used by the real-time kiosk and the test page. */

// Per-call timeouts so the kiosk's polling loops can never wedge: each call is
// guarded by an in-flight flag that only clears when the promise settles, so a
// request that hangs (e.g. a stalled backend) would otherwise stop the loop
// permanently. A timeout forces a rejection, the flag resets, and polling resumes.
const DETECT_TIMEOUT_MS = 10_000
const IDENTIFY_TIMEOUT_MS = 25_000

export async function detectFaces(image: string): Promise<DetectResponse> {
  const { data } = await api.post<DetectResponse>(
    '/recognition/detect',
    { image },
    { timeout: DETECT_TIMEOUT_MS }
  )
  return data
}

export async function identifyFace(payload: Record<string, unknown>): Promise<IdentifyResult> {
  const { data } = await api.post<IdentifyResult>('/recognition/identify', payload, {
    timeout: IDENTIFY_TIMEOUT_MS,
  })
  return data
}
