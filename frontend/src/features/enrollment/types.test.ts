import { describe, expect, it } from 'vitest'
import { reasonLabel } from '@/features/enrollment/types'

describe('reasonLabel', () => {
  it('returns the friendly label for a known reason', () => {
    expect(reasonLabel('low_resolution')).toBe('Face too small / low resolution')
    expect(reasonLabel('too_dark')).toBe('Image too dark')
  })

  it('turns dynamic wrong_pose reasons into an actionable hint', () => {
    expect(reasonLabel('wrong_pose_expected_left_got_front')).toBe(
      "Pose doesn't match — please turn your head left"
    )
    expect(reasonLabel('wrong_pose_expected_up_got_neutral')).toBe(
      "Pose doesn't match — please tilt your head up slightly"
    )
  })

  it('falls back to a humanized string for unknown reasons', () => {
    expect(reasonLabel('some_new_reason')).toBe('some new reason')
    expect(reasonLabel()).toBe('Image rejected')
  })
})
