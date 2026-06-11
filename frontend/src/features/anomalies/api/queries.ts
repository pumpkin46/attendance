import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { toast } from 'sonner'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { AnomalySummary, AttendanceAnomaly, Paginated } from '@/shared/types'
import type { AnomalyDecision, DetectionResult } from '@/features/anomalies/types'

export interface AnomalyListParams {
  status?: string
  severity?: string
  anomaly_type?: string
  page?: number
  per_page?: number
}

export const anomalyKeys = {
  all: ['anomalies'] as const,
  summary: ['anomalies', 'summary'] as const,
  list: (params: AnomalyListParams) => ['anomalies', 'list', params] as const,
}

export function useAnomalySummary() {
  return useApiQuery<AnomalySummary>(anomalyKeys.summary, '/anomalies/summary')
}

export function useAnomalies(params: AnomalyListParams) {
  return useApiQuery<Paginated<AttendanceAnomaly>>(
    anomalyKeys.list(params),
    '/anomalies',
    params as Record<string, unknown>,
    { keepPreviousData: true }
  )
}

/** Detection runs and status decisions move counts between the summary and every list filter, so the whole scope refetches. */
export function useInvalidateAnomalies() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: anomalyKeys.all })
}

export function useRunDetection() {
  const invalidate = useInvalidateAnomalies()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<DetectionResult>('/anomalies/detect', { lookback_days: 30 })
      return data
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useUpdateAnomalyStatus() {
  const invalidate = useInvalidateAnomalies()
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: AnomalyDecision }) => {
      const { data } = await api.patch<AttendanceAnomaly>(`/anomalies/${id}`, { status })
      return data
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}
