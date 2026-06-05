import type { RfidReader } from '@/shared/types'

export interface RfidLocation {
  id: number
  name: string
}

export interface RfidCard {
  id: number
  uid: string
  label?: string
  is_active: boolean
  assigned_at: string
}

export interface TapResult {
  matched: boolean
  reason?: string
  attendance_action?: string
  employee?: { first_name: string; last_name: string; employee_code: string }
}

export const emptyReaderForm = {
  location_id: '',
  name: '',
  direction: 'both' as RfidReader['direction'],
}

export type ReaderForm = typeof emptyReaderForm
