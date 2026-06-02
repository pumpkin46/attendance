<?php

namespace App\Console\Commands;

use App\Services\VisitorService;
use Illuminate\Console\Command;

class ExpireVisitors extends Command
{
    protected $signature = 'visitors:expire';

    protected $description = 'Remove expired visitor face embeddings and mark visits expired';

    public function handle(VisitorService $visitors): int
    {
        $count = $visitors->expireDueVisitors();
        $this->info("Expired {$count} visitor(s).");

        return self::SUCCESS;
    }
}
