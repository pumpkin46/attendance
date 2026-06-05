import { useQueryClient } from '@tanstack/react-query'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Shift } from '@/shared/types'
import type { AttendanceConfig } from '@/features/shifts/types'

export const shiftKeys = {
  all: ['shifts'] as const,
  list: ['shifts', 'list'] as const,
  config: ['shifts', 'config'] as const,
}

export function useShifts() {
  return useApiQuery<Shift[]>(shiftKeys.list, '/shifts')
}

export function useAttendanceConfig() {
  return useApiQuery<AttendanceConfig>(shiftKeys.config, '/attendance/config', undefined, {
    silent: true,
  })
}

/** Invalidates every shift-scoped query after a mutation. */
export function useInvalidateShifts() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: shiftKeys.all })
}
