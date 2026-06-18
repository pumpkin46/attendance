import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { removeRowFromPaginated } from '@/shared/api/cache'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Employee, Paginated } from '@/shared/types'
import type {
  BlacklistEntry,
  DashboardStats,
  Visitor,
  VisitorAccessPermission,
  VisitorDocument,
  VisitorLogEntry,
  VisitorPhoto,
} from '@/features/visitors/types'

export const visitorKeys = {
  all: ['visitors'] as const,
  list: (search: string, status: string) => ['visitors', 'list', { search, status }] as const,
  active: ['visitors', 'active'] as const,
  stats: ['visitors', 'stats'] as const,
  pending: ['visitors', 'pending'] as const,
  // Detail scope nests under `all` so lifecycle mutations refresh open panels too.
  detail: (id: number) => ['visitors', 'detail', id] as const,
  photos: (id: number) => ['visitors', 'detail', id, 'photos'] as const,
  documents: (id: number) => ['visitors', 'detail', id, 'documents'] as const,
  permissions: (id: number) => ['visitors', 'detail', id, 'permissions'] as const,
  timeline: (id: number) => ['visitors', 'detail', id, 'timeline'] as const,
}

// The blacklist is its own resource (/visitor-blacklist) and is unaffected by
// visit lifecycle mutations, so it lives outside the broad `visitors` scope.
export const blacklistKeys = {
  list: ['visitor-blacklist', 'list'] as const,
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
  return useApiQuery<Paginated<BlacklistEntry>>(blacklistKeys.list, '/visitor-blacklist', {
    per_page: 50,
  })
}

export function useEmployeeOptions() {
  return useApiQuery<Paginated<Employee>>(['employees', 'options'], '/employees', { per_page: 100 })
}

// ── Detail panel queries ─────────────────────────────────────────────────────

export function useVisitorDetail(id: number) {
  return useApiQuery<Visitor>(visitorKeys.detail(id), `/visitors/${id}`)
}

export function useVisitorPhotos(id: number) {
  return useApiQuery<VisitorPhoto[]>(visitorKeys.photos(id), `/visitors/${id}/photos`, undefined, {
    silent: true,
  })
}

export function useVisitorDocuments(id: number) {
  return useApiQuery<VisitorDocument[]>(visitorKeys.documents(id), `/visitors/${id}/documents`, undefined, {
    silent: true,
  })
}

export function useVisitorPermissions(id: number) {
  return useApiQuery<VisitorAccessPermission[]>(
    visitorKeys.permissions(id),
    `/visitors/${id}/access-permissions`,
    undefined,
    { silent: true }
  )
}

export function useVisitorTimeline(id: number) {
  return useApiQuery<VisitorLogEntry[]>(visitorKeys.timeline(id), `/visitors/${id}/timeline`, undefined, {
    silent: true,
  })
}

// ── Detail panel mutations ───────────────────────────────────────────────────

/** Refetches the open detail scope plus the lists/stats that mirror it. */
function useInvalidateVisitorDetail(id: number) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: visitorKeys.detail(id) })
    void qc.invalidateQueries({ queryKey: visitorKeys.all, refetchType: 'active' })
  }
}

export function useUpdateVisitor(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(`/visitors/${id}`, payload),
    onSuccess: () => {
      toast.success('Visitor updated')
      invalidate()
    },
  })
}

export function useApproveVisitor(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (stage: string) => api.post(`/visitors/${id}/approve`, { stage }),
    onSuccess: () => {
      toast.success('Approval recorded')
      invalidate()
    },
  })
}

export function useRejectVisitor(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (notes?: string) => api.post(`/visitors/${id}/reject`, { notes }),
    onSuccess: () => {
      toast.success('Visitor rejected')
      invalidate()
    },
  })
}

export function useUploadVisitorPhoto(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/visitors/${id}/photos`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      toast.success('Photo uploaded')
      invalidate()
    },
  })
}

export function useDeleteVisitorPhoto(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/visitors/${id}/photos/${photoId}`),
    onSuccess: () => {
      toast.success('Photo removed')
      invalidate()
    },
  })
}

export function useSetPrimaryVisitorPhoto(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (photoId: number) => api.post(`/visitors/${id}/photos/${photoId}/primary`),
    onSuccess: () => {
      toast.success('Primary photo updated')
      invalidate()
    },
  })
}

export function useUploadVisitorDocument(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: ({ file, documentType }: { file: File; documentType: string }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', documentType)
      return api.post(`/visitors/${id}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      toast.success('Document uploaded')
      invalidate()
    },
  })
}

export function useDeleteVisitorDocument(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (docId: number) => api.delete(`/visitors/${id}/documents/${docId}`),
    onSuccess: () => {
      toast.success('Document removed')
      invalidate()
    },
  })
}

export function useSaveVisitorZones(id: number) {
  const invalidate = useInvalidateVisitorDetail(id)
  return useMutation({
    mutationFn: (zones: string[]) => api.put(`/visitors/${id}/access-permissions`, { zones }),
    onSuccess: () => {
      toast.success('Access zones saved')
      invalidate()
    },
  })
}

/**
 * Visit lifecycle mutations (register/check-in/check-out/cancel/enroll) move a
 * visitor between the list, active roster, stats and pending approvals at
 * once, so they refetch the whole visitor scope.
 */
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
      void invalidate()
    },
  })
}

export function useCheckInVisitor() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (id: number) => api.post(`/visitors/${id}/check-in`),
    onSuccess: () => {
      toast.success('Visitor checked in')
      void invalidate()
    },
  })
}

export function useCheckOutVisitor() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (id: number) => api.post(`/visitors/${id}/check-out`),
    onSuccess: () => {
      toast.success('Visitor checked out')
      void invalidate()
    },
  })
}

export function useCancelVisit() {
  const invalidate = useInvalidateVisitors()
  return useMutation({
    mutationFn: (id: number) => api.post(`/visitors/${id}/cancel`),
    onSuccess: () => {
      toast.success('Visit cancelled')
      void invalidate()
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
      void invalidate()
    },
  })
}

export function useAddBlacklist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/visitor-blacklist', payload),
    onSuccess: () => {
      toast.success('Added to blacklist')
      void qc.invalidateQueries({ queryKey: blacklistKeys.list })
    },
  })
}

export function useRemoveBlacklist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/visitor-blacklist/${id}`),
    onSuccess: (_data, id) => {
      toast.success('Removed from blacklist')
      // Soft delete on the backend, but the list only returns active entries:
      // drop it from the cached list instead of refetching.
      qc.setQueryData<Paginated<BlacklistEntry>>(
        blacklistKeys.list,
        removeRowFromPaginated<BlacklistEntry>(id)
      )
    },
  })
}
