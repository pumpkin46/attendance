import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated, RfidEvent, RfidReader } from '@/shared/types'
import type { ReaderForm, RfidCard, RfidLocation, TapResult } from '@/features/rfid/types'

export const rfidKeys = {
  all: ['rfid'] as const,
  readers: ['rfid', 'readers'] as const,
  events: ['rfid', 'events'] as const,
  cards: (employeeId: string) => ['rfid', 'cards', employeeId] as const,
}

export function useReaders() {
  return useApiQuery<RfidReader[]>(rfidKeys.readers, '/rfid-readers')
}

export function useRfidEvents() {
  return useApiQuery<Paginated<RfidEvent>>(rfidKeys.events, '/rfid-events', { per_page: 25 })
}

export function useRfidLocations() {
  return useApiQuery<RfidLocation[]>(['locations'], '/locations')
}

export function useEmployeeCards(employeeId: string) {
  return useApiQuery<RfidCard[]>(
    rfidKeys.cards(employeeId),
    `/employees/${employeeId}/rfid-cards`,
    undefined,
    { enabled: Boolean(employeeId) }
  )
}

export function useInvalidateRfid() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: rfidKeys.all })
}

export function useCreateReader() {
  const invalidate = useInvalidateRfid()
  return useMutation({
    mutationFn: async (form: ReaderForm) => {
      const { data } = await api.post<RfidReader & { api_token_plain?: string }>('/rfid-readers', {
        location_id: Number(form.location_id),
        name: form.name,
        direction: form.direction,
      })
      return data
    },
    onSuccess: () => {
      toast.success('Reader registered')
      invalidate()
    },
  })
}

export function useRegenerateToken() {
  return useMutation({
    mutationFn: async (readerId: number) => {
      const { data } = await api.post<{ api_token_plain: string }>(
        `/rfid-readers/${readerId}/regenerate-token`
      )
      return data
    },
    onSuccess: () => toast.success('Token regenerated'),
  })
}

export function useDeleteReader() {
  const invalidate = useInvalidateRfid()
  return useMutation({
    mutationFn: (readerId: number) => api.delete(`/rfid-readers/${readerId}`),
    onSuccess: () => {
      toast.success('Reader deactivated')
      invalidate()
    },
  })
}

export function useAssignCard() {
  const invalidate = useInvalidateRfid()
  return useMutation({
    mutationFn: ({ employeeId, uid, label }: { employeeId: string; uid: string; label: string }) =>
      api.post(`/employees/${employeeId}/rfid-cards`, { uid, label: label || null }),
    onSuccess: () => {
      toast.success('Card assigned')
      invalidate()
    },
  })
}

export function useRevokeCard() {
  const invalidate = useInvalidateRfid()
  return useMutation({
    mutationFn: (cardId: number) => api.delete(`/rfid-cards/${cardId}`),
    onSuccess: () => {
      toast.success('Card revoked')
      invalidate()
    },
  })
}

export function useSimulateTap() {
  const invalidate = useInvalidateRfid()
  return useMutation({
    mutationFn: async ({ readerId, uid }: { readerId: string; uid: string }) => {
      const { data } = await api.post<TapResult>('/rfid/simulate', {
        rfid_reader_id: Number(readerId),
        uid,
      })
      return data
    },
    onSuccess: invalidate,
  })
}
