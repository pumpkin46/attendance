<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attendance_policies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->unsignedSmallInteger('grace_minutes')->default(15);
            $table->unsignedSmallInteger('min_work_minutes')->default(240);
            $table->unsignedSmallInteger('max_work_minutes')->default(600);
            $table->unsignedSmallInteger('break_minutes')->default(60);
            $table->unsignedSmallInteger('overtime_after_minutes')->default(480);
            $table->decimal('overtime_multiplier', 4, 2)->default(1.5);
            $table->time('night_shift_start')->nullable();
            $table->time('night_shift_end')->nullable();
            $table->decimal('night_shift_multiplier', 4, 2)->default(1.25);
            $table->json('weekend_days')->nullable();
            $table->decimal('weekend_multiplier', 4, 2)->default(1.5);
            $table->boolean('holiday_paid')->default(true);
            $table->boolean('auto_checkout_exit_zone')->default(true);
            $table->boolean('require_liveness_checkin')->default(true);
            $table->decimal('min_confidence', 5, 4)->default(0.95);
            $table->unsignedSmallInteger('half_day_minutes')->default(240);
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::table('shifts', function (Blueprint $table) {
            $table->string('type', 32)->default('fixed')->after('name');
            $table->string('rotation_slot', 32)->nullable()->after('type');
            $table->json('segments')->nullable()->after('end_time');
            $table->unsignedSmallInteger('min_work_minutes')->nullable()->after('break_minutes');
            $table->unsignedSmallInteger('max_work_minutes')->nullable()->after('min_work_minutes');
            $table->foreignId('attendance_policy_id')->nullable()->after('organization_id')
                ->constrained('attendance_policies')->nullOnDelete();
        });

        Schema::table('shift_assignments', function (Blueprint $table) {
            $table->time('flex_start_time')->nullable()->after('effective_to');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE attendance_records ALTER COLUMN status TYPE VARCHAR(32) USING status::text');
        } else {
            Schema::table('attendance_records', function (Blueprint $table) {
                $table->string('status', 32)->default('absent')->change();
            });
        }

        Schema::table('attendance_records', function (Blueprint $table) {
            $table->string('attendance_type', 32)->nullable()->after('status');
            $table->foreignId('shift_id')->nullable()->after('camera_id')->constrained()->nullOnDelete();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_type_check");
            DB::statement("ALTER TABLE leave_requests ALTER COLUMN type TYPE VARCHAR(32) USING type::text");
        }
    }

    public function down(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropConstrainedForeignId('shift_id');
            $table->dropColumn('attendance_type');
        });

        Schema::table('shift_assignments', function (Blueprint $table) {
            $table->dropColumn('flex_start_time');
        });

        Schema::table('shifts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('attendance_policy_id');
            $table->dropColumn([
                'type', 'rotation_slot', 'segments', 'min_work_minutes', 'max_work_minutes',
            ]);
        });

        Schema::dropIfExists('attendance_policies');
    }
};
