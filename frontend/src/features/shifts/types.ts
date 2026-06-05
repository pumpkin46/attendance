export interface AttendanceConfig {
  shift_types?: Record<
    string,
    { label: string; example?: string; description?: string; slots?: string[] }
  >
}

export const SHIFT_TYPE_FALLBACK: NonNullable<AttendanceConfig['shift_types']> = {
  fixed: { label: 'Fixed Shift', example: '09:00–18:00' },
  rotational: { label: 'Rotational Shift', slots: ['morning', 'evening', 'night'] },
  flexible: { label: 'Flexible Shift', description: 'Employee defines start time' },
  split: { label: 'Split Shift', example: '08:00–12:00, 14:00–18:00' },
}
