import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type { MyData, PrivacyPolicy } from '@/features/privacy/types'

export const privacyKeys = {
  policy: ['privacy', 'policy'] as const,
  myData: ['privacy', 'my-data'] as const,
}

export function usePrivacyPolicy() {
  return useApiQuery<PrivacyPolicy>(privacyKeys.policy, '/privacy/policy', undefined, {
    staleTime: STATIC_STALE_MS,
  })
}

export function useMyData() {
  return useApiQuery<MyData>(privacyKeys.myData, '/privacy/my-data', undefined, { silent: true })
}

export function useEraseEmployeeData() {
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<{ message: string }>(`/employees/${id}/privacy/erase`)
      return data
    },
    onSuccess: (data) => toast.success(data.message),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}
