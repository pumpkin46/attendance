import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import { useInvalidateKey } from '@/shared/hooks/useInvalidateKey'
import type { Paginated, RfidEvent, RfidReader } from '@/shared/types'
import type { ReaderForm, RfidCard, RfidLocation, TapResult } from '@/features/rfid/types'

export const rfidKeys = {
  all: ['rfid'] as const,
  readers: ['rfid', 'readers'] as const,
  events: ['rfid', 'events'] as const,
  cardsAll: ['rfid', 'cards'] as const,
  cards: (employeeId: string) => ['rfid', 'cards', employeeId] as const,
}

export function useReaders() {
  return useApiQuery<RfidReader[]>(rfidKeys.readers, '/rfid-readers')
}

export function useRfidEvents() {
  return useApiQuery<Paginated<RfidEvent>>(rfidKeys.events, '/rfid-events', { per_page: 25 })
}

export function useRfidLocations() {
  return useApiQuery<RfidLocation[]>(['locations'], '/locations', undefined, {
    staleTime: STATIC_STALE_MS,
  })
}

export function useEmployeeCards(employeeId: string) {
  return useApiQuery<RfidCard[]>(
    rfidKeys.cards(employeeId),
    `/employees/${employeeId}/rfid-cards`,
    undefined,
    { enabled: Boolean(employeeId) }
  )
}

// Invalidate only the query the mutation actually changed — never the whole rfid scope.

export function useCreateReader() {
  const invalidate = useInvalidateKey(rfidKeys.readers)
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
      void invalidate()
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
  // Soft delete on the backend (is_active=false) and the list includes inactive
  // readers, so we must refetch the readers list — but only that one.
  const invalidate = useInvalidateKey(rfidKeys.readers)
  return useMutation({
    mutationFn: (readerId: number) => api.delete(`/rfid-readers/${readerId}`),
    onSuccess: () => {
      toast.success('Reader deactivated')
      void invalidate()
    },
  })
}

export function useAssignCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ employeeId, uid, label }: { employeeId: string; uid: string; label: string }) =>
      api.post(`/employees/${employeeId}/rfid-cards`, { uid, label: label || null }),
    onSuccess: (_data, { employeeId }) => {
      toast.success('Card assigned')
      void qc.invalidateQueries({ queryKey: rfidKeys.cards(employeeId) })
    },
  })
}

export function useRevokeCard() {
  // Only the card id is known here, so invalidate the cards scope (not readers/events).
  const invalidate = useInvalidateKey(rfidKeys.cardsAll)
  return useMutation({
    mutationFn: (cardId: number) => api.delete(`/rfid-cards/${cardId}`),
    onSuccess: () => {
      toast.success('Card revoked')
      void invalidate()
    },
  })
}

export function useSimulateTap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ readerId, uid }: { readerId: string; uid: string }) => {
      const { data } = await api.post<TapResult>('/rfid/simulate', {
        rfid_reader_id: Number(readerId),
        uid,
      })
      return data
    },
    onSuccess: () => {
      // A tap adds an event and bumps the reader's taps-today counter.
      void qc.invalidateQueries({ queryKey: rfidKeys.events })
      void qc.invalidateQueries({ queryKey: rfidKeys.readers })
    },
  })
}
