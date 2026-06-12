import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import { useFallbackPoll } from '@/features/realtime/useFallbackPoll'
import { getToken } from '@/shared/lib/session'
import type { Paginated, RecognitionEvent } from '@/shared/types'
import type {
  AddStreamInput,
  EngineConfigDict,
  EngineConfigPatch,
  EngineStatus,
  EventFeedbackResult,
  FeedbackOutcome,
  PerformanceCompliance,
  StreamsResponse,
} from '@/features/recognition/types'

export const UNKNOWN_FACES_PER_PAGE = 24

export function useUnknownFaces(
  dateFrom: string,
  dateTo: string,
  page = 1,
  cameraId = '',
  alertsOnly = false
) {
  return useApiQuery<Paginated<RecognitionEvent>>(
    ['unknown-faces', 'list', { dateFrom, dateTo, page, cameraId, alertsOnly }],
    '/reports/unknown-persons',
    {
      // Empty bounds (open-ended range) are omitted — the API expects a date or no param.
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      page,
      per_page: UNKNOWN_FACES_PER_PAGE,
      camera_id: cameraId || undefined,
      alerts_only: alertsOnly || undefined,
    },
    { keepPreviousData: true }
  )
}

export interface UnknownFacesSummary {
  total: number
  alerts: number
  spoof: number
  cameras: { id: number; name: string | null }[]
}

/** Range-wide totals for the stat cards + camera filter (the list is paginated). */
export function useUnknownFacesSummary(dateFrom: string, dateTo: string) {
  return useApiQuery<UnknownFacesSummary>(
    ['unknown-faces', 'summary', { dateFrom, dateTo }],
    '/reports/unknown-persons/summary',
    { date_from: dateFrom || undefined, date_to: dateTo || undefined },
    { silent: true }
  )
}

export const engineKeys = {
  all: ['engine'] as const,
  status: ['engine', 'status'] as const,
  streams: ['engine', 'streams'] as const,
  config: ['engine', 'config'] as const,
}

export function useEngineStatus() {
  // Live updates arrive via useEngineLiveFeed (WebSocket); HTTP polling is only a
  // fallback for when the realtime socket is down.
  const poll = useFallbackPoll(5000)
  return useApiQuery<EngineStatus>(engineKeys.status, '/engine/status', undefined, {
    refetchInterval: poll,
    silent: true,
  })
}

export function useEngineStreams() {
  const poll = useFallbackPoll(5000)
  return useApiQuery<StreamsResponse>(engineKeys.streams, '/engine/streams', undefined, {
    refetchInterval: poll,
    silent: true,
  })
}

/**
 * Live engine dashboard feed. Opens a WebSocket that pushes status + stream
 * telemetry every ~2s and writes it straight into the query cache, so the AI
 * Engine page updates live without background polling. Auto-reconnects on drop.
 */
export function useEngineLiveFeed() {
  const qc = useQueryClient()
  useEffect(() => {
    const token = getToken()
    if (!token) return

    const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
    const httpBase = /^https?:\/\//.test(apiBase) ? apiBase : window.location.origin + apiBase
    const wsUrl = `${httpBase.replace(/^http/, 'ws')}/engine/status/ws`

    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (cancelled) return
      ws = new WebSocket(wsUrl, ['bearer', token])
      ws.onmessage = (ev) => {
        if (cancelled || typeof ev.data !== 'string') return
        try {
          const msg = JSON.parse(ev.data) as { status?: EngineStatus; streams?: StreamsResponse }
          if (msg.status) qc.setQueryData(engineKeys.status, msg.status)
          if (msg.streams) qc.setQueryData(engineKeys.streams, msg.streams)
        } catch {
          /* ignore malformed frame */
        }
      }
      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 1500)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [qc])
}

export function useEngineConfig() {
  // Long staleTime is safe even though config is editable in-app: the save
  // mutation invalidates the key explicitly, which always refetches.
  return useApiQuery<EngineConfigDict>(engineKeys.config, '/engine/config', undefined, {
    silent: true,
    staleTime: STATIC_STALE_MS,
  })
}

/** Full engine-scope refresh — for callers outside this file (e.g. the config panel's save callback). */
export function useInvalidateEngine() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: engineKeys.all })
}

/**
 * Stream mutations change the stream table and the aggregate counters in
 * engine status, but never the engine config — so config is not invalidated.
 */
function useInvalidateStreams() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: engineKeys.streams })
    qc.invalidateQueries({ queryKey: engineKeys.status })
  }
}

function useEngineError() {
  return (err: unknown) => toast.error(getApiErrorMessage(err))
}

export function useToggleEngine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: 'start' | 'stop') => api.post(`/engine/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: engineKeys.status }),
  })
}

export function useAddStream() {
  const invalidate = useInvalidateStreams()
  const onError = useEngineError()
  return useMutation({
    mutationFn: (input: AddStreamInput) =>
      api.post('/engine/streams/add', {
        camera_id: Number(input.camera_id),
        stream_url: input.stream_url,
        protocol: input.protocol,
      }),
    onSuccess: () => {
      toast.success('Stream registered')
      invalidate()
    },
    onError,
  })
}

export function useControlStream() {
  const invalidate = useInvalidateStreams()
  const onError = useEngineError()
  return useMutation({
    mutationFn: ({ action, camera_id }: { action: 'start' | 'stop'; camera_id: number }) =>
      api.post(`/engine/streams/${action}`, { camera_id }),
    onSuccess: invalidate,
    onError,
  })
}

export function useRemoveStream() {
  const invalidate = useInvalidateStreams()
  const onError = useEngineError()
  return useMutation({
    mutationFn: (camera_id: number) => api.delete(`/engine/streams/${camera_id}`),
    onSuccess: () => {
      toast.success('Stream removed')
      invalidate()
    },
    onError,
  })
}

export function useReloadIndex() {
  const qc = useQueryClient()
  const onError = useEngineError()
  return useMutation({
    mutationFn: () => api.post('/engine/index/reload'),
    onSuccess: () => {
      toast.success('Vector index reloaded')
      // A reload only changes the search_index stats reported in engine status.
      qc.invalidateQueries({ queryKey: engineKeys.status })
    },
    onError,
  })
}

export const complianceKey = ['recognition', 'performance-compliance'] as const

/** Required performance metrics (accuracy, FPR, FNR, latency) vs measured. */
export function usePerformanceCompliance() {
  return useApiQuery<PerformanceCompliance>(
    complianceKey,
    '/recognition/performance-compliance',
    undefined,
    { refetchInterval: 30_000, silent: true }
  )
}

/** Label a recognition event as correct/incorrect (ground truth). */
export function useEventFeedback() {
  const qc = useQueryClient()
  const onError = useEngineError()
  return useMutation({
    mutationFn: async ({
      eventId,
      outcome,
      note,
    }: {
      eventId: number
      outcome: FeedbackOutcome
      note?: string
    }) => {
      const { data } = await api.post<EventFeedbackResult>(
        `/recognition/events/${eventId}/feedback`,
        { outcome, note }
      )
      return data
    },
    onSuccess: () => {
      toast.success('Feedback recorded — accuracy metrics updated')
      qc.invalidateQueries({ queryKey: complianceKey })
    },
    onError,
  })
}

export function useSaveEngineConfig() {
  const qc = useQueryClient()
  const onError = useEngineError()
  return useMutation({
    mutationFn: (patch: EngineConfigPatch) => api.patch('/engine/config', patch),
    onSuccess: () => {
      toast.success('Engine configuration updated')
      // Status and streams refresh live over the WebSocket; only the config
      // snapshot needs refetching.
      qc.invalidateQueries({ queryKey: engineKeys.config })
    },
    onError,
  })
}
