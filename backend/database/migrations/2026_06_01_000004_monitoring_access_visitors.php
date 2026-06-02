<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('access_points', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('location_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('camera_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->enum('device_type', ['door', 'turnstile', 'gate'])->default('door');
            $table->enum('default_action', [
                'unlock_door', 'lock_door', 'open_turnstile', 'open_gate',
            ])->default('unlock_door');
            $table->string('controller_url')->nullable();
            $table->boolean('require_liveness')->default(true);
            $table->decimal('min_confidence', 5, 4)->default(0.95);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('visitors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('host_employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->string('name');
            $table->string('company')->nullable();
            $table->string('phone', 32)->nullable();
            $table->string('purpose')->nullable();
            $table->timestamp('visit_start_at');
            $table->timestamp('visit_end_at');
            $table->enum('status', ['scheduled', 'checked_in', 'expired', 'cancelled'])->default('scheduled');
            $table->boolean('face_registered')->default(false);
            $table->string('ai_identity_id')->nullable();
            $table->timestamp('face_expires_at')->nullable();
            $table->timestamps();
            $table->index(['status', 'face_expires_at']);
        });

        Schema::create('live_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->nullable()->constrained()->nullOnDelete();
            $table->string('event_type', 64);
            $table->string('message');
            $table->json('payload')->nullable();
            $table->foreignId('camera_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('visitor_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('access_point_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('occurred_at');
            $table->index(['occurred_at', 'event_type']);
        });

        Schema::create('access_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('access_point_id')->constrained()->cascadeOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('visitor_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 32);
            $table->boolean('granted')->default(false);
            $table->string('deny_reason')->nullable();
            $table->decimal('confidence', 5, 4)->nullable();
            $table->boolean('liveness_passed')->default(false);
            $table->json('metadata')->nullable();
            $table->timestamp('occurred_at');
            $table->index(['access_point_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('access_events');
        Schema::dropIfExists('live_events');
        Schema::dropIfExists('visitors');
        Schema::dropIfExists('access_points');
    }
};
