export const SEVERITY_TONE: Record<string, 'danger' | 'warn' | 'neutral' | 'ok'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
}

export const TYPE_LABELS: Record<string, string> = {
  missing_check_out: 'Missing check-out',
  excessive_overtime: 'Excessive overtime',
  unusual_check_in_time: 'Unusual check-in',
  weekend_work: 'Weekend work',
  short_work_day: 'Short work day',
  rapid_recheck: 'High recheck frequency',
  statistical_outlier: 'Statistical outlier',
  absence_pattern: 'Absence pattern',
}

export interface DetectionResult {
  success: boolean
  detection_run_id: string
  records_analyzed: number
  anomalies_detected: number
  processing_ms: number
}

export type AnomalyDecision = 'acknowledged' | 'resolved' | 'false_positive'
