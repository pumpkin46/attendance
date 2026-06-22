import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated, Permission, Role, User } from '@/shared/types'

export interface RoleWithUsage extends Role {
  user_count: number
}

export interface UserListParams {
  search?: string
  page?: number
  per_page?: number
}

export const userAdminKeys = {
  all: ['user-admin'] as const,
  usersAll: ['user-admin', 'users'] as const,
  users: (params: UserListParams) => ['user-admin', 'users', params] as const,
  roles: ['user-admin', 'roles'] as const,
  permissions: ['user-admin', 'permissions'] as const,
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useAdminUsers(params: UserListParams, options?: { enabled?: boolean }) {
  return useApiQuery<Paginated<User>>(
    userAdminKeys.users(params),
    '/users',
    params as Record<string, unknown>,
    { keepPreviousData: true, ...options }
  )
}

export function useRoles() {
  return useApiQuery<RoleWithUsage[]>(userAdminKeys.roles, '/roles')
}

export function usePermissions() {
  return useApiQuery<Permission[]>(userAdminKeys.permissions, '/permissions', undefined, {
    staleTime: STATIC_STALE_MS,
  })
}

/**
 * User and role mutations change the user lists (which embed roles) and the
 * roles' usage counts — the permission catalog is static and never refetched.
 */
function useInvalidateUsersAndRoles() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: userAdminKeys.usersAll })
    void qc.invalidateQueries({ queryKey: userAdminKeys.roles })
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────

function onError(err: unknown) {
  toast.error(getApiErrorMessage(err))
}

export interface SaveUserPayload {
  name?: string
  email?: string
  password?: string
  is_active?: boolean
  role_ids?: number[]
  /** Company (org root) ids this user may access. */
  organization_ids?: number[]
}

export function useSaveUser() {
  const invalidate = useInvalidateUsersAndRoles()
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: SaveUserPayload }) =>
      id ? api.patch<User>(`/users/${id}`, payload) : api.post<User>('/users', payload),
    onSuccess: (_d, { id }) => {
      toast.success(id ? 'User updated' : 'User created')
      invalidate()
    },
    onError,
  })
}

/**
 * Toggle a single user's set of granted organizations (used by the org chart's
 * "assign users" panel). Quiet — no toast per toggle; just refreshes the list.
 */
export function useUpdateUserOrganizations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, organization_ids }: { id: number; organization_ids: number[] }) =>
      api.patch<User>(`/users/${id}`, { organization_ids }),
    // Reconcile on settle so an optimistic toggle is confirmed on success and
    // rolled back (refetched) on failure.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: userAdminKeys.usersAll })
    },
    onError,
  })
}

export interface SaveRolePayload {
  name?: string
  label?: string
  permission_ids?: number[]
}

export function useSaveRole() {
  const invalidate = useInvalidateUsersAndRoles()
  return useMutation({
    mutationFn: ({ id, payload }: { id?: number; payload: SaveRolePayload }) =>
      id ? api.patch<Role>(`/roles/${id}`, payload) : api.post<Role>('/roles', payload),
    onSuccess: (_d, { id }) => {
      toast.success(id ? 'Role updated' : 'Role created')
      invalidate()
    },
    onError,
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/roles/${id}`),
    onSuccess: (_data, id) => {
      toast.success('Role deleted')
      // Hard delete on the backend (only allowed while unassigned, so user rows
      // are unaffected): drop it from the cached list instead of refetching.
      qc.setQueryData<RoleWithUsage[]>(userAdminKeys.roles, (old) =>
        old?.filter((r) => r.id !== id)
      )
    },
    onError,
  })
}
