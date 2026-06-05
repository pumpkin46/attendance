import { useCallback, useEffect, useRef, useState } from 'react'

export interface WebcamCapture {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  active: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
  captureFrame: (maxWidth?: number) => string | null
}

export function useWebcam(): WebcamCapture {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setActive(true)
    } catch {
      setError('Camera access denied or unavailable. Allow camera permission and retry.')
      stop()
    }
  }, [stop])

  const captureFrame = useCallback((maxWidth = 640): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null

    const scale = Math.min(1, maxWidth / video.videoWidth)
    const w = Math.round(video.videoWidth * scale)
    const h = Math.round(video.videoHeight * scale)

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.85)
  }, [])

  useEffect(() => () => stop(), [stop])

  return { videoRef, canvasRef, active, error, start, stop, captureFrame }
}
