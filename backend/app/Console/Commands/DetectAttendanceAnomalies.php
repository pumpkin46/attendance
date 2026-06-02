<?php

namespace App\Console\Commands;

use App\Services\AttendanceAnomalyService;
use Illuminate\Console\Command;

class DetectAttendanceAnomalies extends Command
{
    protected $signature = 'attendance:detect-anomalies
                            {--days=30 : Lookback window in days}
                            {--location= : Optional location ID filter}';

    protected $description = 'Run AI-powered attendance anomaly detection';

    public function handle(AttendanceAnomalyService $anomalies): int
    {
        if (! config('attendance.anomaly_detection_enabled', true)) {
            $this->warn('Anomaly detection is disabled (ANOMALY_DETECTION_ENABLED=false).');

            return self::SUCCESS;
        }

        $days = (int) $this->option('days');
        $dateTo = now()->toDateString();
        $dateFrom = now()->subDays($days)->toDateString();
        $locationId = $this->option('location') ? (int) $this->option('location') : null;

        $this->info("Analyzing attendance from {$dateFrom} to {$dateTo}…");

        try {
            $result = $anomalies->detect($dateFrom, $dateTo, $locationId);
        } catch (\Throwable $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->info(sprintf(
            'Done: %d records, %d anomalies (%d new, %d updated) in %dms',
            $result['records_analyzed'],
            $result['anomalies_found'],
            $result['anomalies_created'],
            $result['anomalies_updated'],
            $result['processing_ms'] ?? 0,
        ));

        return self::SUCCESS;
    }
}
