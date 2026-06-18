import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { removeRowFromPaginated } from '@/shared/api/cache'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Employee, Paginated } from '@/shared/types'
import {
  toEmployeePayload,
  type EmployeeForm,
  type EmployeeLocation,
} from '@/features/employees/types'

export const employeeKeys = {
  all: ['employees'] as const,
  list: (search: string) => ['employees', 'list', search] as const,
  locations: ['locations'] as const,
}

export function useEmployees(search: string) {
  return useApiQuery<Paginated<Employee>>(
    employeeKeys.list(search),
    '/employees',
    { search, per_page: 50 },
    { keepPreviousData: true }
  )
}

export function useEmployeeLocations() {
  return useApiQuery<EmployeeLocation[]>(employeeKeys.locations, '/locations', undefined, {
    staleTime: STATIC_STALE_MS,
  })
}

/** Active employees for pickers (assignment, manual entry, card assignment). */
export function useActiveEmployees(enabled = true) {
  return useApiQuery<Paginated<Employee>>(
    ['employees', 'active'],
    '/employees',
    { per_page: 100, is_active: true },
    { enabled }
  )
}

/** Invalidates every employee-scoped query after a mutation. */
export function useInvalidateEmployees() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: employeeKeys.all })
}

export function useSaveEmployee() {
  const invalidate = useInvalidateEmployees()
  return useMutation({
    mutationFn: ({ id, form }: { id: number | null; form: EmployeeForm }) =>
      id === null
        ? api.post('/employees', toEmployeePayload(form, false))
        : api.put(`/employees/${id}`, toEmployeePayload(form, true)),
    onSuccess: (_d, { id }) => {
      toast.success(id === null ? 'Employee created' : 'Employee updated')
      void invalidate()
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useDeleteEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/employees/${id}`),
    onSuccess: (_data, id) => {
      toast.success('Employee deleted')
      // Hard delete on the backend: drop the row from every cached employee list
      // (search variants + active picker) instead of refetching them.
      qc.setQueriesData<Paginated<Employee>>(
        { queryKey: employeeKeys.all },
        removeRowFromPaginated<Employee>(id)
      )
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}
