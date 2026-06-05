import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated, RecognitionEvent } from '@/shared/types'
import type {
  AddStreamInput,
  EngineConfigDict,
  EngineConfigPatch,
  EngineStatus,
  StreamsResponse,
} from '@/features/recognition/types'

export function useUnknownFaces(dateFrom: string, dateTo: string) {
  return useApiQuery<Paginated<RecognitionEvent>>(
    ['unknown-faces', 'list', { dateFrom, dateTo }],
    '/reports/unknown-persons',
    { date_from: dateFrom, date_to: dateTo, per_page: 50 }
  )
}

export const engineKeys = {
  all: ['engine'] as const,
  status: ['engine', 'status'] as const,
  streams: ['engine', 'streams'] as const,
  config: ['engine', 'config'] as const,
}

export function useEngineStatus() {
  return useApiQuery<EngineStatus>(engineKeys.status, '/engine/status', undefined, {
    refetchInterval: 5000,
    silent: true,
  })
}

export function useEngineStreams() {
  return useApiQuery<StreamsResponse>(engineKeys.streams, '/engine/streams', undefined, {
    refetchInterval: 5000,
    silent: true,
  })
}

export function useEngineConfig() {
  return useApiQuery<EngineConfigDict>(engineKeys.config, '/engine/config', undefined, {
    silent: true,
  })
}

export function useInvalidateEngine() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: engineKeys.all })
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
  const invalidate = useInvalidateEngine()
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
  const invalidate = useInvalidateEngine()
  const onError = useEngineError()
  return useMutation({
    mutationFn: ({ action, camera_id }: { action: 'start' | 'stop'; camera_id: number }) =>
      api.post(`/engine/streams/${action}`, { camera_id }),
    onSuccess: invalidate,
    onError,
  })
}

export function useRemoveStream() {
  const invalidate = useInvalidateEngine()
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
  const invalidate = useInvalidateEngine()
  const onError = useEngineError()
  return useMutation({
    mutationFn: () => api.post('/engine/index/reload'),
    onSuccess: () => {
      toast.success('Vector index reloaded')
      invalidate()
    },
    onError,
  })
}

export function useSaveEngineConfig() {
  const invalidate = useInvalidateEngine()
  const onError = useEngineError()
  return useMutation({
    mutationFn: (patch: EngineConfigPatch) => api.patch('/engine/config', patch),
    onSuccess: () => {
      toast.success('Engine configuration updated')
      invalidate()
    },
    onError,
  })
}
