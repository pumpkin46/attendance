import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import { useInvalidateKey } from '@/shared/hooks/useInvalidateKey'
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
    staleTime: STATIC_STALE_MS,
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

// Invalidate only the query the mutation actually changed — shifts, policies,
// holidays and leave are independent resources.

// ── Mutations ────────────────────────────────────────────────────────────────

function onError(err: unknown) {
  toast.error(getApiErrorMessage(err))
}

export function useSaveShift() {
  const invalidate = useInvalidateKey(shiftKeys.list)
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: Record<string, unknown> }) =>
      id ? api.put(`/shifts/${id}`, payload) : api.post('/shifts', payload),
    onSuccess: (_d, { id }) => {
      toast.success(id ? 'Shift updated' : 'Shift created')
      void invalidate()
    },
    onError,
  })
}

export function useDeleteShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/shifts/${id}`),
    onSuccess: (_data, id) => {
      toast.success('Shift removed')
      // Soft delete on the backend, but the list only returns active shifts:
      // drop it from the cached list instead of refetching.
      qc.setQueryData<Shift[]>(shiftKeys.list, (old) => old?.filter((s) => s.id !== id))
    },
    onError,
  })
}

export function useAssignShift() {
  return useMutation({
    mutationFn: ({ shiftId, payload }: { shiftId: number; payload: Record<string, unknown> }) =>
      api.post(`/shifts/${shiftId}/assign`, payload),
    onSuccess: () => {
      // Assignments aren't cached by any query in this feature — nothing to invalidate.
      toast.success('Shift assigned')
    },
    onError,
  })
}

export function useSavePolicy() {
  const invalidate = useInvalidateKey(shiftKeys.policies)
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: Record<string, unknown> }) =>
      id ? api.put(`/attendance-policies/${id}`, payload) : api.post('/attendance-policies', payload),
    onSuccess: (_d, { id }) => {
      toast.success(id ? 'Policy updated' : 'Policy created')
      void invalidate()
    },
    onError,
  })
}

export function useCreateHoliday() {
  const invalidate = useInvalidateKey(shiftKeys.holidays)
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/holidays', payload),
    onSuccess: () => {
      toast.success('Holiday added')
      void invalidate()
    },
    onError,
  })
}

export function useDecideLeave() {
  const invalidate = useInvalidateKey(shiftKeys.leave)
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'rejected' }) =>
      api.patch(`/leave-requests/${id}`, { status }),
    onSuccess: (_d, { status }) => {
      toast.success(`Leave ${status}`)
      void invalidate()
    },
    onError,
  })
}
