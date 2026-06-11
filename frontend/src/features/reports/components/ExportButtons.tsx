import { useState } from 'react'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/shared/api/client'
import { downloadBlob } from '@/shared/lib/download'
import { Button } from '@/shared/ui/Button'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchReportExport } from '@/features/reports/api/queries'
import type { ExportFormat } from '@/features/reports/types'

const DownloadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const FORMATS: Array<{ format: ExportFormat; label: string }> = [
  { format: 'csv', label: 'CSV' },
  { format: 'xlsx', label: 'Excel' },
  { format: 'pdf', label: 'PDF' },
]

/**
 * CSV / Excel / PDF download buttons for `/reports/export`. `params` selects
 * the report (report_type + period); the viewer's timezone offset is attached
 * automatically so times in the file match the screen. The file name comes
 * from the response's Content-Disposition header.
 *
 * Hidden entirely for users without `reports.export` — the backend would 403
 * them, and the app's convention is to hide exactly what the API would reject.
 */
export function ReportExportButtons({
  params,
  label,
  className,
}: {
  params: Record<string, string | undefined>
  /** Optional small-caps heading rendered above the buttons. */
  label?: string
  className?: string
}) {
  const { hasPermission } = useAuth()
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  if (!hasPermission('reports.export')) return null

  const run = async (format: ExportFormat) => {
    setExporting(format)
    try {
      const { blob, filename } = await fetchReportExport({
        ...params,
        format,
        tz_offset: String(new Date().getTimezoneOffset()),
      })
      downloadBlob(blob, filename ?? `report.${format}`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Export failed'))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className={className}>
      {label && (
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      )}
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label: formatLabel }) => (
          <Button
            key={format}
            variant="ghost"
            leftIcon={DownloadIcon}
            isLoading={exporting === format}
            disabled={!!exporting}
            onClick={() => run(format)}
          >
            {formatLabel}
          </Button>
        ))}
      </div>
    </div>
  )
}
