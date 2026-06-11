import { describe, expect, it } from 'vitest'
import { liveGuidance, reasonLabel } from '@/features/enrollment/types'

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

describe('liveGuidance', () => {
  it('confirms a passing frame', () => {
    expect(liveGuidance(true)).toEqual({ ok: true, text: 'Pose looks good — capture now' })
  })

  it('gives a corrective move for the front slot based on the detected pose', () => {
    expect(liveGuidance(false, 'wrong_pose_expected_front_got_left')).toEqual({
      ok: false,
      text: 'Turn your head back to the right a little',
    })
    expect(liveGuidance(false, 'wrong_pose_expected_front_got_down')).toEqual({
      ok: false,
      text: 'Raise your chin a little',
    })
  })

  it('nudges further toward the expected directional pose', () => {
    expect(liveGuidance(false, 'wrong_pose_expected_left_got_front')).toEqual({
      ok: false,
      text: 'Turn your head left a bit more',
    })
  })

  it('maps capture-quality reasons to live corrections', () => {
    expect(liveGuidance(false, 'no_face').text).toBe('Center your face inside the guide')
    expect(liveGuidance(false, 'not_smiling').text).toBe('Give a bigger smile')
    expect(liveGuidance(false, 'blurry').text).toBe('Hold still — the image is blurry')
  })

  it('falls back to the generic reason label otherwise', () => {
    expect(liveGuidance(false, 'low_quality').text).toBe('Overall quality too low')
    expect(liveGuidance(false).text).toBe('Image rejected')
  })
})
