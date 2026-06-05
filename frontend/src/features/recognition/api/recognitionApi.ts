import { api } from '@/shared/api/client'
import type { DetectResponse, IdentifyResult } from '@/features/recognition/types'

/** Imperative recognition calls used by the real-time kiosk and the test page. */

export async function detectFaces(image: string): Promise<DetectResponse> {
  const { data } = await api.post<DetectResponse>('/recognition/detect', { image })
  return data
}

export async function identifyFace(payload: Record<string, unknown>): Promise<IdentifyResult> {
  const { data } = await api.post<IdentifyResult>('/recognition/identify', payload)
  return data
}
