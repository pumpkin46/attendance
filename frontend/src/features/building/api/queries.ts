import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { removeRowFromPaginated } from '@/shared/api/cache'
import { api } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import { useInvalidateKey } from '@/shared/hooks/useInvalidateKey'
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
  return useApiQuery<BuildingConfig>(buildingKeys.config, '/building/config', undefined, {
    staleTime: STATIC_STALE_MS,
  })
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

// Invalidate only the query the mutation actually changed — config is static
// and never refetched here.

export function useCreateConnector() {
  const invalidate = useInvalidateKey(buildingKeys.connectors)
  return useMutation({
    mutationFn: (payload: CreateConnectorPayload) => api.post('/building/connectors', payload),
    onSuccess: () => {
      toast.success('Connector created')
      invalidate()
    },
  })
}

export function useDeleteConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/building/connectors/${id}`),
    onSuccess: (_data, id) => {
      toast.success('Connector deleted')
      // Hard delete on the backend: drop it from the cached list instead of refetching.
      qc.setQueryData<Paginated<Connector>>(
        buildingKeys.connectors,
        removeRowFromPaginated<Connector>(id)
      )
    },
  })
}

export function useTestConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post(`/building/connectors/${id}/test`),
    onSuccess: () => {
      toast.success('Connector test sent')
      // A test updates the connector's last-status and logs an event.
      qc.invalidateQueries({ queryKey: buildingKeys.connectors })
      qc.invalidateQueries({ queryKey: buildingKeys.events })
    },
  })
}

export function usePublishOccupancy() {
  const invalidate = useInvalidateKey(buildingKeys.events)
  return useMutation({
    mutationFn: (payload: PublishOccupancyPayload) => api.post('/building/occupancy/publish', payload),
    onSuccess: () => {
      toast.success('Occupancy published')
      invalidate()
    },
  })
}
