import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useApiQuery } from '../../hooks/useApiQuery'
import type { Paginated } from '../../types'
import type {
  AccessConfig,
  AccessPoint,
  CreateAccessPointPayload,
  FaceGrantResult,
} from './types'

export const accessKeys = {
  all: ['access-points'] as const,
  list: ['access-points', 'list'] as const,
  config: ['access-points', 'config'] as const,
}

export function useAccessPoints() {
  return useApiQuery<AccessPoint[] | Paginated<AccessPoint>>(accessKeys.list, '/access-points', undefined, {
    silent: true,
  })
}

export function useAccessConfig() {
  return useApiQuery<AccessConfig>(accessKeys.config, '/access-points/config', undefined, {
    silent: true,
  })
}

/** Invalidates every access-point-scoped query after a mutation. */
export function useInvalidateAccessPoints() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: accessKeys.all })
}

export function useCreateAccessPoint() {
  const invalidate = useInvalidateAccessPoints()
  return useMutation({
    mutationFn: (payload: CreateAccessPointPayload) => api.post('/access-points', payload),
    onSuccess: () => {
      toast.success('Access point created')
      invalidate()
    },
  })
}

export function useExecuteAccessAction() {
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      api.post(`/access-points/${id}/execute`, { action }),
    onSuccess: () => {
      toast.success('Action executed')
    },
  })
}

export function useFaceGrant() {
  return useMutation({
    mutationFn: async ({ id, image }: { id: number; image: string }) => {
      const { data } = await api.post<FaceGrantResult>(`/access-points/${id}/face-grant`, {
        image,
        require_liveness: false,
      })
      return data
    },
  })
}
