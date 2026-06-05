import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Employee, Paginated } from '@/shared/types'
import type {
  EnrollFaceResult,
  EnrollmentConfig,
  HealthInfo,
  LivenessResult,
  ValidateImageResult,
} from '@/features/enrollment/types'

export const enrollmentKeys = {
  all: ['enrollment'] as const,
  employees: ['enrollment', 'employees'] as const,
  config: ['enrollment', 'config'] as const,
  health: ['enrollment', 'health'] as const,
}

export function useEnrollableEmployees() {
  return useApiQuery<Paginated<Employee>>(enrollmentKeys.employees, '/employees', {
    per_page: 100,
    is_active: true,
  })
}

export function useEnrollmentConfig() {
  return useApiQuery<EnrollmentConfig>(enrollmentKeys.config, '/enrollment/config')
}

export function useLivenessHealth() {
  return useApiQuery<HealthInfo>(enrollmentKeys.health, '/health', undefined, { silent: true })
}

/** Invalidates every enrollment-scoped query after a mutation. */
export function useInvalidateEnrollment() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: enrollmentKeys.all })
}

/**
 * Validates a single captured pose. Rejection is part of the normal capture
 * flow (driven into page state), so failures stay silent rather than toasting.
 */
export function useValidateImage() {
  return useMutation({
    mutationFn: async (payload: { image: string; expected_pose: string }) => {
      const { data } = await api.post<ValidateImageResult>('/enrollment/validate-image', payload)
      return data
    },
    meta: { silent: true },
  })
}

export function useEnrollFace() {
  const invalidate = useInvalidateEnrollment()
  return useMutation({
    mutationFn: async ({
      employeeId,
      poses,
    }: {
      employeeId: string
      poses: Record<string, string>
    }) => {
      const { data } = await api.post<EnrollFaceResult>(
        `/employees/${employeeId}/enroll-face-structured`,
        { poses }
      )
      return data
    },
    // Errors carry per-pose rejection details rendered in-page; surface them
    // there instead of the generic toast.
    meta: { silent: true },
    onSuccess: () => {
      toast.success('Enrollment completed')
      invalidate()
    },
  })
}

export function useVerifyLiveness() {
  return useMutation({
    mutationFn: async (frames: string[]) => {
      const { data } = await api.post<LivenessResult>('/recognition/liveness/verify', { frames })
      return data
    },
  })
}
