import { api } from '@/shared/api/client'

/** Strip /api/v1 prefix so axios baseURL resolves correctly. */
export function toApiPath(url: string): string {
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  const prefix = '/api/v1'
  if (url.startsWith(prefix)) {
    return url.slice(prefix.length)
  }
  return url.startsWith('/') ? url : `/${url}`
}

/** Fetch an authenticated media URL and open it in a new tab. */
export async function openAuthMedia(url: string) {
  if (url.startsWith('data:')) {
    window.open(url, '_blank')
    return
  }
  const res = await api.get<Blob>(toApiPath(url), { responseType: 'blob' })
  const objectUrl = URL.createObjectURL(res.data)
  window.open(objectUrl, '_blank')
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
