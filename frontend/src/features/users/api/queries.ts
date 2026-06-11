import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
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
  users: (params: UserListParams) => ['user-admin', 'users', params] as const,
  roles: ['user-admin', 'roles'] as const,
  permissions: ['user-admin', 'permissions'] as const,
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useAdminUsers(params: UserListParams) {
  return useApiQuery<Paginated<User>>(
    userAdminKeys.users(params),
    '/users',
    params as Record<string, unknown>,
    { keepPreviousData: true }
  )
}

export function useRoles() {
  return useApiQuery<RoleWithUsage[]>(userAdminKeys.roles, '/roles')
}

export function usePermissions() {
  return useApiQuery<Permission[]>(userAdminKeys.permissions, '/permissions')
}

/** Invalidates every user-admin query after a mutation. */
function useInvalidateUserAdmin() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: userAdminKeys.all })
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
}

export function useSaveUser() {
  const invalidate = useInvalidateUserAdmin()
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

export interface SaveRolePayload {
  name?: string
  label?: string
  permission_ids?: number[]
}

export function useSaveRole() {
  const invalidate = useInvalidateUserAdmin()
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
  const invalidate = useInvalidateUserAdmin()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/roles/${id}`),
    onSuccess: () => {
      toast.success('Role deleted')
      invalidate()
    },
    onError,
  })
}
