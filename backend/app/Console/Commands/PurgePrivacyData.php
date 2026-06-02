<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\RecognitionEvent;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class PurgePrivacyData extends Command
{
    protected $signature = 'privacy:purge-retention {--dry-run : Show counts without deleting}';

    protected $description = 'NFR-008: Purge data past GDPR retention periods';

    public function handle(): int
    {
        $dryRun = $this->option('dry-run');
        $retention = config('nfr.data_retention_days');

        $purged = [];

        $auditCutoff = now()->subDays($retention['audit_logs'] ?? 365);
        $auditCount = AuditLog::where('created_at', '<', $auditCutoff)->count();
        if (! $dryRun && $auditCount > 0) {
            AuditLog::where('created_at', '<', $auditCutoff)->delete();
        }
        $purged['audit_logs'] = $auditCount;

        $eventCutoff = now()->subDays($retention['recognition_events'] ?? 90);
        $events = RecognitionEvent::where('recognized_at', '<', $eventCutoff)->get();
        $eventCount = $events->count();
        if (! $dryRun && $eventCount > 0) {
            foreach ($events as $event) {
                if ($event->snapshot_path) {
                    Storage::disk('local')->delete($event->snapshot_path);
                }
            }
            RecognitionEvent::where('recognized_at', '<', $eventCutoff)->delete();
        }
        $purged['recognition_events'] = $eventCount;

        $notifCutoff = now()->subDays($retention['notifications'] ?? 90);
        $notifCount = DB::table('notifications')->where('created_at', '<', $notifCutoff)->count();
        if (! $dryRun && $notifCount > 0) {
            DB::table('notifications')->where('created_at', '<', $notifCutoff)->delete();
        }
        $purged['notifications'] = $notifCount;

        $snapshotDays = $retention['unknown_snapshots'] ?? 30;
        $snapshotCutoff = now()->subDays($snapshotDays);
        $oldSnapshots = RecognitionEvent::query()
            ->whereNotNull('snapshot_path')
            ->where('recognized_at', '<', $snapshotCutoff)
            ->get();
        $snapshotCount = $oldSnapshots->count();
        if (! $dryRun) {
            foreach ($oldSnapshots as $event) {
                Storage::disk('local')->delete($event->snapshot_path);
                $event->update(['snapshot_path' => null]);
            }
        }
        $purged['unknown_snapshots'] = $snapshotCount;

        $this->table(['Category', 'Records'], collect($purged)->map(fn ($c, $k) => [$k, $c]));

        if ($dryRun) {
            $this->warn('Dry run — no data deleted.');
        } else {
            $this->info('Retention purge completed.');
        }

        return self::SUCCESS;
    }
}
