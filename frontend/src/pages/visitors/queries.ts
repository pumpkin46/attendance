import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useApiQuery } from '../../hooks/useApiQuery'
import type { Employee, Paginated } from '../../types'
import type { BlacklistEntry, DashboardStats, Visitor } from './types'

export const visitorKeys = {
  all: ['visitors'] as const,
  list: (search: string, status: string) => ['visitors', 'list', { search, status }] as const,
  active: ['visitors', 'active'] as const,
  stats: ['visitors', 'stats'] as const,
  pending: ['visitors', 'pending'] as const,
  blacklist: ['visitors', 'blacklist'] as const,
}

export function useVisitorStats(refetchInterval?: number) {
  return useApiQuery<DashboardStats>(visitorKeys.stats, '/visitors/dashboard', undefined, {
    silent: true,
    refetchInterval,
  })
}

export function useActiveVisitors(refetchInterval?: number) {
  return useApiQuery<Visitor[]>(visitorKeys.active, '/visitors/active', undefined, {
    silent: true,
    refetchInterval,
  })
}

export function useVisitorsList(search: string, status: string) {
  const params: Record<string, string | number> = { per_page: 50 }
  if (search) params.search = search
  if (status) params.status = status
  return useApiQuery<Paginated<Visitor>>(visitorKeys.list(search, status), '/visitors', params)
}

export function usePendingApprovals() {
  return useApiQuery<Visitor[]>(visitorKeys.pending, '/visitors/pending-approval', undefined, {
    silent: true,
  })
}

export function useBlacklist() {
  return useApiQuery<Paginated<BlacklistEntry>>(visitorKeys.blacklist, '/visitor-blacklist', {
    per_page: 50,
  })
}

export function useEmployeeOptions() {
  return useApiQuery<Paginated<Employee>>(['employees', 'options'], '/employees', { per_page: 100 })
}

/** Invalidates every visitor-scoped query after a mutation. */
export function useInvalidateVisitors() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: visitorKeys.all })
}

export function useRegisterVisitor() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/visitors', payload),
    onSuccess: () => {
      toast.success('Visitor registered')
      invalidate()
    },
  })
}

export function useCheckInVisitor() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (id: number) => api.post(`/visitors/${id}/check-in`),
    onSuccess: () => {
      toast.success('Visitor checked in')
      invalidate()
    },
  })
}

export function useCheckOutVisitor() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (id: number) => api.post(`/visitors/${id}/check-out`),
    onSuccess: () => {
      toast.success('Visitor checked out')
      invalidate()
    },
  })
}

export function useCancelVisit() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (id: number) => api.post(`/visitors/${id}/cancel`),
    onSuccess: () => {
      toast.success('Visit cancelled')
      invalidate()
    },
  })
}

export function useEnrollVisitorFace() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: ({ id, image }: { id: number; image: string }) =>
      api.post(`/visitors/${id}/enroll-face`, { image, method: 'admin' }),
    onSuccess: () => {
      toast.success('Face enrolled')
      invalidate()
    },
  })
}

export function useAddBlacklist() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/visitor-blacklist', payload),
    onSuccess: () => {
      toast.success('Added to blacklist')
      invalidate()
    },
  })
}

export function useRemoveBlacklist() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/visitor-blacklist/${id}`),
    onSuccess: () => {
      toast.success('Removed from blacklist')
      invalidate()
    },
  })
}
