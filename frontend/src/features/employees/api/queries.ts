import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
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
  return useApiQuery<EmployeeLocation[]>(employeeKeys.locations, '/locations')
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
      invalidate()
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useDeleteEmployee() {
  const invalidate = useInvalidateEmployees()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/employees/${id}`),
    onSuccess: () => {
      toast.success('Employee deleted')
      invalidate()
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}
