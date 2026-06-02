<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->string('camera_type', 32)->default('rtsp')->after('name');
            $table->string('zone', 64)->nullable()->after('location_id');
            $table->string('floor', 32)->nullable()->after('zone');
            $table->unsignedSmallInteger('target_fps')->nullable()->after('stream_url');
            $table->unsignedSmallInteger('resolution_width')->nullable()->after('target_fps');
            $table->unsignedSmallInteger('resolution_height')->nullable()->after('resolution_width');
            $table->unsignedInteger('latency_ms')->nullable()->after('frame_rate_fps');
            $table->unsignedInteger('bandwidth_kbps')->nullable()->after('latency_ms');
            $table->decimal('cpu_usage_percent', 5, 2)->nullable()->after('bandwidth_kbps');
            $table->decimal('gpu_usage_percent', 5, 2)->nullable()->after('cpu_usage_percent');
            $table->unsignedInteger('dropped_frames')->default(0)->after('gpu_usage_percent');
            $table->timestamp('health_updated_at')->nullable()->after('dropped_frames');
        });

        Schema::create('camera_health_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('camera_id')->constrained()->cascadeOnDelete();
            $table->boolean('online')->default(true);
            $table->decimal('frame_rate_fps', 6, 2)->nullable();
            $table->unsignedInteger('latency_ms')->nullable();
            $table->unsignedInteger('bandwidth_kbps')->nullable();
            $table->decimal('cpu_usage_percent', 5, 2)->nullable();
            $table->decimal('gpu_usage_percent', 5, 2)->nullable();
            $table->unsignedInteger('dropped_frames')->default(0);
            $table->unsignedInteger('recognition_events')->default(0);
            $table->timestamp('recorded_at');
            $table->index(['camera_id', 'recorded_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('camera_health_logs');
        Schema::table('cameras', function (Blueprint $table) {
            $table->dropColumn([
                'camera_type', 'zone', 'floor', 'target_fps',
                'resolution_width', 'resolution_height',
                'latency_ms', 'bandwidth_kbps', 'cpu_usage_percent',
                'gpu_usage_percent', 'dropped_frames', 'health_updated_at',
            ]);
        });
    }
};
