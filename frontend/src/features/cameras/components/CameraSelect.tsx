import { useMemo } from 'react'
import { Combobox } from '@/shared/ui/Combobox'
import type { Camera } from '@/shared/types'
import { useCameras } from '@/features/cameras/api/queries'

interface CameraSelectProps {
  /** Selected camera id as a string ('' when none). */
  value: string
  /** Called with the selected camera id (or '' when cleared). */
  onChange: (value: string) => void
  /** Also receives the full camera record, e.g. to auto-fill its stream URL. */
  onCameraChange?: (camera: Camera | undefined) => void
  /** Adds a leading "no camera" choice for optional fields. */
  allowEmpty?: boolean
  emptyLabel?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Dropdown of cameras registered on the Cameras page. Replaces free-text
 * "Camera ID" inputs so every surface links to a real, registered camera.
 */
export function CameraSelect({
  value,
  onChange,
  onCameraChange,
  allowEmpty = false,
  emptyLabel = 'No camera',
  placeholder = 'Select camera…',
  required,
  disabled,
  className,
  'aria-label': ariaLabel,
}: CameraSelectProps) {
  const { data, isLoading } = useCameras()
  const cameras = useMemo(() => data?.data ?? [], [data])

  const options = useMemo(() => {
    const opts = cameras.map((c) => ({
      value: String(c.id),
      label: c.zone ? `${c.name} · ${c.zone}` : c.name,
    }))
    return allowEmpty ? [{ value: '', label: emptyLabel }, ...opts] : opts
  }, [cameras, allowEmpty, emptyLabel])

  const handleChange = (next: string) => {
    onChange(next)
    onCameraChange?.(cameras.find((c) => String(c.id) === next))
  }

  const resolvedPlaceholder = isLoading
    ? 'Loading cameras…'
    : cameras.length === 0
      ? 'No cameras registered'
      : placeholder

  return (
    <Combobox
      value={value}
      onChange={handleChange}
      options={options}
      placeholder={resolvedPlaceholder}
      disabled={disabled || (!isLoading && cameras.length === 0)}
      required={required}
      className={className}
      aria-label={ariaLabel ?? 'Camera'}
    />
  )
}
