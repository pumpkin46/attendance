<?php

namespace App\Services;

use App\Models\RecognitionEvent;
use Illuminate\Support\Facades\DB;

class RecognitionMetricsService
{
    public function summary(?int $windowDays = null): array
    {
        $windowDays ??= config('recognition.metrics_window_days', 7);
        $since = now()->subDays($windowDays);
        $targets = config('recognition.metrics', []);

        $base = RecognitionEvent::query()->where('recognized_at', '>=', $since);

        $total = (clone $base)->count();
        $matched = (clone $base)->where('result', 'matched')->count();
        $unknown = (clone $base)->where('result', 'unknown')->count();
        $livenessFailed = (clone $base)->where('result', 'liveness_failed')->count();
        $lowConfidence = (clone $base)->where('result', 'low_confidence')->count();

        $timing = (clone $base)
            ->selectRaw('
                AVG(processing_ms) as avg_ms,
                MAX(processing_ms) as max_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_ms) as p95_ms
            ')
            ->first();

        $avgMs = (int) round((float) ($timing->avg_ms ?? 0));
        $p95Ms = (int) round((float) ($timing->p95_ms ?? 0));
        $maxMs = (int) ($timing->max_ms ?? 0);

        $slaMs = (int) ($targets['recognition_sla_ms'] ?? 300);
        $slaMet = $total > 0
            ? (clone $base)->where('processing_ms', '<=', $slaMs)->count() / $total
            : 1.0;

        $livenessTimings = (clone $base)
            ->whereNotNull('metadata')
            ->get(['metadata'])
            ->map(fn ($e) => (int) (($e->metadata['liveness_ms'] ?? 0)))
            ->filter(fn ($ms) => $ms > 0);

        $avgLivenessMs = $livenessTimings->isNotEmpty()
            ? (int) round($livenessTimings->avg())
            : null;

        $livenessSla = (int) ($targets['liveness_sla_ms'] ?? 500);
        $livenessSlaMet = $livenessTimings->isEmpty()
            ? null
            : $livenessTimings->filter(fn ($ms) => $ms <= $livenessSla)->count() / max($livenessTimings->count(), 1);

        $decided = max($matched + $unknown + $lowConfidence, 1);
        $operationalAccuracy = $matched / $decided;
        $falsePositiveRate = $total > 0 ? $lowConfidence / $total : 0.0;
        $falseNegativeRate = $total > 0 ? $unknown / max($total - $livenessFailed, 1) : 0.0;

        return [
            'window_days' => $windowDays,
            'total_events' => $total,
            'matched' => $matched,
            'unknown' => $unknown,
            'liveness_failed' => $livenessFailed,
            'low_confidence' => $lowConfidence,
            'timing' => [
                'avg_processing_ms' => $avgMs,
                'p95_processing_ms' => $p95Ms,
                'max_processing_ms' => $maxMs,
                'avg_liveness_ms' => $avgLivenessMs,
            ],
            'measured' => [
                'operational_match_rate' => round($operationalAccuracy, 4),
                'false_positive_rate' => round($falsePositiveRate, 4),
                'false_negative_rate' => round($falseNegativeRate, 4),
                'recognition_sla_compliance' => round($slaMet, 4),
                'liveness_sla_compliance' => $livenessSlaMet !== null ? round($livenessSlaMet, 4) : null,
            ],
            'targets' => [
                'accuracy' => $targets['target_accuracy'] ?? 0.99,
                'max_false_positive_rate' => $targets['max_false_positive_rate'] ?? 0.001,
                'max_false_negative_rate' => $targets['max_false_negative_rate'] ?? 0.01,
                'recognition_time_ms' => $slaMs,
                'liveness_time_ms' => $livenessSla,
            ],
            'compliance' => [
                'accuracy_met' => $operationalAccuracy >= ($targets['target_accuracy'] ?? 0.99),
                'false_positive_met' => $falsePositiveRate < ($targets['max_false_positive_rate'] ?? 0.001),
                'false_negative_met' => $falseNegativeRate < ($targets['max_false_negative_rate'] ?? 0.01),
                'recognition_time_met' => $p95Ms <= $slaMs,
                'liveness_time_met' => $livenessSlaMet === null || $livenessSlaMet >= 0.95,
            ],
        ];
    }

    /** Source breakdown for monitoring dashboards. */
    public function bySource(?int $windowDays = null): array
    {
        $windowDays ??= config('recognition.metrics_window_days', 7);
        $since = now()->subDays($windowDays);

        return RecognitionEvent::query()
            ->where('recognized_at', '>=', $since)
            ->select(
                DB::raw("COALESCE(metadata->>'source', 'unknown') as source"),
                DB::raw('COUNT(*) as total'),
                DB::raw("SUM(CASE WHEN result = 'matched' THEN 1 ELSE 0 END) as matched")
            )
            ->groupBy('source')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($row) => [
                'source' => $row->source,
                'total' => (int) $row->total,
                'matched' => (int) $row->matched,
            ])
            ->all();
    }
}
