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
  SimpleEnrollResult,
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
 * Validates a pose image without storing it. Also used directly (outside a
 * mutation) by the live pose guide, which polls while the camera is open and
 * must not churn react-query mutation state on every frame.
 */
export async function validatePoseImage(payload: {
  image: string
  expected_pose: string
}): Promise<ValidateImageResult> {
  const { data } = await api.post<ValidateImageResult>('/enrollment/validate-image', payload)
  return data
}

/**
 * Validates a single captured pose. Rejection is part of the normal capture
 * flow (driven into page state), so failures stay silent rather than toasting.
 */
export function useValidateImage() {
  return useMutation({
    mutationFn: validatePoseImage,
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

/**
 * Simple face registration — stores embeddings for one or more camera shots
 * with only a face-presence check (no pose/blur/quality gating). Backs the
 * quick-register page; the guided structured flow uses {@link useEnrollFace}.
 */
export function useSimpleEnroll() {
  const invalidate = useInvalidateEnrollment()
  return useMutation({
    mutationFn: async ({ employeeId, images }: { employeeId: string; images: string[] }) => {
      const { data } = await api.post<SimpleEnrollResult>(
        `/employees/${employeeId}/enroll-face-simple`,
        { images }
      )
      return data
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success('Face registered')
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
