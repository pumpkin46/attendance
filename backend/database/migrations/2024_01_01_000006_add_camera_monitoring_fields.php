<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->enum('status', ['active', 'inactive', 'maintenance'])->default('active')->after('direction');
            $table->decimal('frame_rate_fps', 6, 2)->nullable()->after('last_heartbeat_at');
            $table->timestamp('last_frame_at')->nullable()->after('frame_rate_fps');
        });

        DB::table('cameras')->update([
            'status' => DB::raw("CASE WHEN is_active = true THEN 'active' ELSE 'inactive' END"),
        ]);
    }

    public function down(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->dropColumn(['status', 'frame_rate_fps', 'last_frame_at']);
        });
    }
};
