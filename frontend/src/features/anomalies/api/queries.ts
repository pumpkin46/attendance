import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { toast } from 'sonner'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { AnomalySummary, AttendanceAnomaly, Paginated } from '@/shared/types'
import type { AnomalyDecision, DetectionResult } from '@/features/anomalies/types'

export const anomalyKeys = {
  all: ['anomalies'] as const,
  summary: ['anomalies', 'summary'] as const,
  list: (status: string, severity: string) => ['anomalies', 'list', status, severity] as const,
}

export function useAnomalySummary() {
  return useApiQuery<AnomalySummary>(anomalyKeys.summary, '/anomalies/summary')
}

export function useAnomalies(status: string, severity: string) {
  return useApiQuery<Paginated<AttendanceAnomaly>>(
    anomalyKeys.list(status, severity),
    '/anomalies',
    { status: status || undefined, severity: severity || undefined, per_page: 50 }
  )
}

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
    mutationFn: ({ id, status }: { id: number; status: AnomalyDecision }) =>
      api.patch(`/anomalies/${id}`, { status }),
    onSuccess: invalidate,
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}
