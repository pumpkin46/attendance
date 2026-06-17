import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type {
  CreateLocationPayload,
  CreateOrganizationPayload,
  CreateOrgNodePayload,
  Location,
  MoveOrgNodePayload,
  Organization,
  OrgNode,
  SecurityConfig,
  UpdateLocationPayload,
  UpdateOrganizationPayload,
  UpdateOrgNodePayload,
} from '@/features/security/types'

export const securityKeys = {
  all: ['security'] as const,
  config: ['security', 'config'] as const,
}

export const organizationKeys = {
  all: ['organizations'] as const,
  list: ['organizations', 'list'] as const,
  // Deliberately the same key the employee form's location dropdown uses
  // (employeeKeys.locations), so location changes refresh both surfaces.
  locations: ['locations'] as const,
}

export const orgNodeKeys = {
  all: ['org-nodes'] as const,
  tree: ['org-nodes', 'tree'] as const,
}

export function useSecurityConfig(enabled: boolean) {
  return useApiQuery<SecurityConfig>(securityKeys.config, '/security/config', undefined, {
    enabled,
    silent: true,
    staleTime: STATIC_STALE_MS,
  })
}

export function useOrganizations() {
  return useApiQuery<Organization[]>(organizationKeys.list, '/organizations')
}

/** Top-level company roots, each nested via a `children` array. */
export function useOrgTree() {
  return useApiQuery<OrgNode[]>(orgNodeKeys.tree, '/org-nodes/tree')
}

export function useLocations() {
  return useApiQuery<Location[]>(organizationKeys.locations, '/locations')
}

export function useInvalidateOrganizationList() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: organizationKeys.list })
}

/**
 * Org-node and location mutations touch the tree, the org list (it embeds
 * per-org node / employee counts) and the location list (locations reference
 * org nodes). One invalidator keeps every surface in sync.
 */
export function useInvalidateOrgTree() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: orgNodeKeys.tree })
    qc.invalidateQueries({ queryKey: organizationKeys.list })
    qc.invalidateQueries({ queryKey: organizationKeys.locations })
  }
}

export function useCreateOrganization() {
  const invalidate = useInvalidateOrganizationList()
  return useMutation({
    mutationFn: (payload: CreateOrganizationPayload) => api.post('/organizations', payload),
    onSuccess: () => {
      toast.success('Organization created')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useUpdateOrganization() {
  const invalidate = useInvalidateOrganizationList()
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateOrganizationPayload & { id: number }) =>
      api.patch(`/organizations/${id}`, payload),
    onSuccess: () => {
      toast.success('Organization updated')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useDeleteOrganization() {
  const invalidate = useInvalidateOrganizationList()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/organizations/${id}`),
    onSuccess: () => {
      toast.success('Organization deleted')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useCreateOrgNode() {
  const invalidate = useInvalidateOrgTree()
  return useMutation({
    mutationFn: (payload: CreateOrgNodePayload) => api.post('/org-nodes', payload),
    onSuccess: () => {
      toast.success('Org unit created')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useUpdateOrgNode() {
  const invalidate = useInvalidateOrgTree()
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateOrgNodePayload & { id: number }) =>
      api.patch(`/org-nodes/${id}`, payload),
    onSuccess: () => {
      toast.success('Org unit updated')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useMoveOrgNode() {
  const invalidate = useInvalidateOrgTree()
  return useMutation({
    mutationFn: ({ id, ...payload }: MoveOrgNodePayload & { id: number }) =>
      api.post(`/org-nodes/${id}/move`, payload),
    onSuccess: () => {
      toast.success('Org unit moved')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useDeleteOrgNode() {
  const invalidate = useInvalidateOrgTree()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/org-nodes/${id}`),
    onSuccess: () => {
      toast.success('Org unit deleted')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useCreateLocation() {
  const invalidate = useInvalidateOrgTree()
  return useMutation({
    mutationFn: (payload: CreateLocationPayload) => api.post('/locations', payload),
    onSuccess: () => {
      toast.success('Location created')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useUpdateLocation() {
  const invalidate = useInvalidateOrgTree()
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateLocationPayload & { id: number }) =>
      api.patch(`/locations/${id}`, payload),
    onSuccess: () => {
      toast.success('Location updated')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}

export function useDeleteLocation() {
  const invalidate = useInvalidateOrgTree()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/locations/${id}`),
    onSuccess: () => {
      toast.success('Location deleted')
      invalidate()
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  })
}
