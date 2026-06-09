/** Shared formatting helpers. Keep page-local formatters out of feature files. */

/** Time of day only, e.g. "09:02 AM". Returns "—" when missing. */
export function formatTime(value?: string | null): string {
  return value
    ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '—'
}

/** A minute count as "7h 30m" / "45m". Returns "—" for zero/missing. */
export function formatMinutes(min?: number | null): string {
  if (!min || min <= 0) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago"; a date past a week. */
export function relativeTime(iso?: string | null): string {
  if (!iso) return '—'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

/** Two-letter initials from separate first/last names, e.g. "JD". Falls back to "?". */
export function initialsOf(first?: string | null, last?: string | null): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?'
}

/** Two-letter initials from a full name, e.g. "Jane Doe" → "JD". Falls back to "?". */
export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return initialsOf(parts[0], parts[1])
}

/** Badge tone for an attendance status. */
export function attendanceStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'present') return 'ok'
  if (status === 'late' || status === 'early_leave') return 'warn'
  if (status === 'absent') return 'danger'
  return 'neutral'
}
