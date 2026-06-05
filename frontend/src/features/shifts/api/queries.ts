import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated, Shift } from '@/shared/types'
import type {
  AttendanceConfig,
  AttendancePolicy,
  Holiday,
  LeaveRequest,
} from '@/features/shifts/types'

export const shiftKeys = {
  all: ['shifts'] as const,
  list: ['shifts', 'list'] as const,
  config: ['shifts', 'config'] as const,
  policies: ['shifts', 'policies'] as const,
  holidays: ['shifts', 'holidays'] as const,
  leave: ['shifts', 'leave'] as const,
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useShifts() {
  return useApiQuery<Shift[]>(shiftKeys.list, '/shifts')
}

export function useAttendanceConfig() {
  return useApiQuery<AttendanceConfig>(shiftKeys.config, '/attendance/config', undefined, {
    silent: true,
  })
}

export function usePolicies() {
  return useApiQuery<AttendancePolicy[]>(shiftKeys.policies, '/attendance-policies')
}

export function useHolidays() {
  return useApiQuery<Holiday[]>(shiftKeys.holidays, '/holidays')
}

export function useLeaveRequests() {
  return useApiQuery<Paginated<LeaveRequest>>(shiftKeys.leave, '/leave-requests', { per_page: 50 })
}

/** Invalidates every shift-scoped query after a mutation. */
export function useInvalidateShifts() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: shiftKeys.all })
}

// ── Mutations ────────────────────────────────────────────────────────────────

function onError(err: unknown) {
  toast.error(getApiErrorMessage(err))
}

export function useSaveShift() {
  const invalidate = useInvalidateShifts()
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: Record<string, unknown> }) =>
      id ? api.put(`/shifts/${id}`, payload) : api.post('/shifts', payload),
    onSuccess: (_d, { id }) => {
      toast.success(id ? 'Shift updated' : 'Shift created')
      invalidate()
    },
    onError,
  })
}

export function useDeleteShift() {
  const invalidate = useInvalidateShifts()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/shifts/${id}`),
    onSuccess: () => {
      toast.success('Shift removed')
      invalidate()
    },
    onError,
  })
}

export function useAssignShift() {
  const invalidate = useInvalidateShifts()
  return useMutation({
    mutationFn: ({ shiftId, payload }: { shiftId: number; payload: Record<string, unknown> }) =>
      api.post(`/shifts/${shiftId}/assign`, payload),
    onSuccess: () => {
      toast.success('Shift assigned')
      invalidate()
    },
    onError,
  })
}

export function useSavePolicy() {
  const invalidate = useInvalidateShifts()
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: Record<string, unknown> }) =>
      id ? api.put(`/attendance-policies/${id}`, payload) : api.post('/attendance-policies', payload),
    onSuccess: (_d, { id }) => {
      toast.success(id ? 'Policy updated' : 'Policy created')
      invalidate()
    },
    onError,
  })
}

export function useCreateHoliday() {
  const invalidate = useInvalidateShifts()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/holidays', payload),
    onSuccess: () => {
      toast.success('Holiday added')
      invalidate()
    },
    onError,
  })
}

export function useDecideLeave() {
  const invalidate = useInvalidateShifts()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'rejected' }) =>
      api.patch(`/leave-requests/${id}`, { status }),
    onSuccess: (_d, { status }) => {
      toast.success(`Leave ${status}`)
      invalidate()
    },
    onError,
  })
}
