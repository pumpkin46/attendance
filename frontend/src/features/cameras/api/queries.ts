import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { removeRowFromPaginated } from '@/shared/api/cache'
import { api } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Camera, Paginated } from '@/shared/types'
import type { CameraConfig, CameraPayload, CaptureResult, Location } from '@/features/cameras/types'

export const cameraKeys = {
  all: ['cameras'] as const,
  list: ['cameras', 'list'] as const,
  config: ['cameras', 'config'] as const,
  locations: ['cameras', 'locations'] as const,
}

export function useCameras() {
  return useApiQuery<Paginated<Camera>>(cameraKeys.list, '/cameras', { per_page: 100 })
}

export function useCameraConfig() {
  return useApiQuery<CameraConfig>(cameraKeys.config, '/cameras/config', undefined, {
    staleTime: STATIC_STALE_MS,
  })
}

export function useLocations() {
  return useApiQuery<Location[]>(cameraKeys.locations, '/locations', undefined, {
    staleTime: STATIC_STALE_MS,
  })
}

/**
 * Camera mutations only ever change the camera list — config (types/zones) and
 * locations are static reference data, so they are never invalidated here.
 */
export function useInvalidateCameraList() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: cameraKeys.list })
}

export function useCreateCamera() {
  const invalidate = useInvalidateCameraList()
  return useMutation({
    mutationFn: (payload: CameraPayload) => api.post('/cameras', payload),
    onSuccess: () => {
      toast.success('Camera registered')
      invalidate()
    },
  })
}

export function useUpdateCamera() {
  const invalidate = useInvalidateCameraList()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CameraPayload }) =>
      api.put(`/cameras/${id}`, payload),
    onSuccess: () => {
      toast.success('Camera updated')
      invalidate()
    },
  })
}

export function useDeleteCamera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/cameras/${id}`),
    onSuccess: (_data, id) => {
      toast.success('Camera removed')
      // Hard delete on the backend: drop it from the cached list instead of refetching.
      qc.setQueryData<Paginated<Camera>>(cameraKeys.list, removeRowFromPaginated<Camera>(id))
    },
  })
}

export function useCaptureFromStream() {
  const invalidate = useInvalidateCameraList()
  return useMutation({
    mutationFn: async (cameraId: number) => {
      const { data } = await api.post<CaptureResult>(`/cameras/${cameraId}/capture`, {
        identify: true,
        require_liveness: false,
      })
      return data
    },
    onSuccess: () => {
      invalidate()
    },
  })
}
