import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
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
  return useApiQuery<CameraConfig>(cameraKeys.config, '/cameras/config')
}

export function useLocations() {
  return useApiQuery<Location[]>(cameraKeys.locations, '/locations')
}

/** Invalidates every camera-scoped query after a mutation. */
export function useInvalidateCameras() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: cameraKeys.all })
}

export function useCreateCamera() {
  const invalidate = useInvalidateCameras()
  return useMutation({
    mutationFn: (payload: CameraPayload) => api.post('/cameras', payload),
    onSuccess: () => {
      toast.success('Camera registered')
      invalidate()
    },
  })
}

export function useUpdateCamera() {
  const invalidate = useInvalidateCameras()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CameraPayload }) =>
      api.patch(`/cameras/${id}`, payload),
    onSuccess: () => {
      toast.success('Camera updated')
      invalidate()
    },
  })
}

export function useCaptureFromStream() {
  const invalidate = useInvalidateCameras()
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
