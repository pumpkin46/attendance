import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated } from '@/shared/types'
import type {
  BuildingConfig,
  BuildingEvent,
  Connector,
  CreateConnectorPayload,
  PublishOccupancyPayload,
} from '@/features/building/types'

export const buildingKeys = {
  all: ['building'] as const,
  config: ['building', 'config'] as const,
  connectors: ['building', 'connectors'] as const,
  events: ['building', 'events'] as const,
}

export function useBuildingConfig() {
  return useApiQuery<BuildingConfig>(buildingKeys.config, '/building/config')
}

export function useConnectors() {
  return useApiQuery<Paginated<Connector>>(buildingKeys.connectors, '/building/connectors', {
    per_page: 50,
  })
}

export function useBuildingEvents() {
  return useApiQuery<Paginated<BuildingEvent>>(buildingKeys.events, '/building/events', {
    per_page: 30,
  })
}

/** Invalidates every building-scoped query after a mutation. */
export function useInvalidateBuilding() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: buildingKeys.all })
}

export function useCreateConnector() {
  const invalidate = useInvalidateBuilding()
  return useMutation({
    mutationFn: (payload: CreateConnectorPayload) => api.post('/building/connectors', payload),
    onSuccess: () => {
      toast.success('Connector created')
      invalidate()
    },
  })
}

export function useDeleteConnector() {
  const invalidate = useInvalidateBuilding()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/building/connectors/${id}`),
    onSuccess: () => {
      toast.success('Connector deleted')
      invalidate()
    },
  })
}

export function useTestConnector() {
  const invalidate = useInvalidateBuilding()
  return useMutation({
    mutationFn: (id: number) => api.post(`/building/connectors/${id}/test`),
    onSuccess: () => {
      toast.success('Connector test sent')
      invalidate()
    },
  })
}

export function usePublishOccupancy() {
  const invalidate = useInvalidateBuilding()
  return useMutation({
    mutationFn: (payload: PublishOccupancyPayload) => api.post('/building/occupancy/publish', payload),
    onSuccess: () => {
      toast.success('Occupancy published')
      invalidate()
    },
  })
}
