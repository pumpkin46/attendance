<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cameras', function (Blueprint $table) {
            $table->enum('deployment_mode', ['cloud', 'edge'])->default('cloud')->after('direction');
        });

        Schema::create('edge_devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('camera_id')->nullable()->unique()->constrained()->nullOnDelete();
            $table->foreignId('location_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('device_id')->unique();
            $table->string('api_token', 64)->unique();
            $table->string('stream_url')->nullable();
            $table->string('local_ai_url')->default('http://127.0.0.1:8001');
            $table->enum('status', ['pending', 'online', 'offline', 'error'])->default('pending');
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('poll_interval_seconds')->default(5);
            $table->boolean('require_liveness')->default(false);
            $table->decimal('recognition_threshold', 4, 3)->nullable();
            $table->string('sync_version')->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->timestamp('last_heartbeat_at')->nullable();
            $table->decimal('frame_rate_fps', 6, 2)->nullable();
            $table->string('software_version')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edge_devices');
        Schema::table('cameras', function (Blueprint $table) {
            $table->dropColumn('deployment_mode');
        });
    }
};
