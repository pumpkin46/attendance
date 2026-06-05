import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWebcam } from '@/shared/hooks/useWebcam'

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useWebcam', () => {
  it('returns null from captureFrame when the video is not ready', () => {
    const { result } = renderHook(() => useWebcam())
    expect(result.current.captureFrame()).toBeNull()
    expect(result.current.active).toBe(false)
  })

  it('sets an error and stays inactive when camera access is denied', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    setMediaDevices({ getUserMedia })

    const { result } = renderHook(() => useWebcam())
    await act(async () => {
      await result.current.start()
    })

    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(result.current.error).toMatch(/Camera access/)
    expect(result.current.active).toBe(false)
  })
})
