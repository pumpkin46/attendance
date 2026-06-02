<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rfid_readers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('location_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('device_id')->unique();
            $table->enum('direction', ['in', 'out', 'both'])->default('both');
            $table->string('api_token', 64)->unique();
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_heartbeat_at')->nullable();
            $table->timestamps();
        });

        Schema::create('rfid_cards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->string('uid')->unique();
            $table->string('label')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('assigned_at')->useCurrent();
            $table->timestamps();
            $table->index(['uid', 'is_active']);
        });

        Schema::create('rfid_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rfid_reader_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete();
            $table->string('uid');
            $table->enum('result', ['matched', 'unknown', 'inactive', 'duplicate_ignored'])->default('unknown');
            $table->json('metadata')->nullable();
            $table->timestamp('tapped_at');
            $table->timestamps();
            $table->index(['tapped_at', 'result']);
            $table->index(['employee_id', 'tapped_at']);
        });

        DB::statement('ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_check_in_method_check');
        DB::statement("ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_check_in_method_check CHECK (check_in_method IS NULL OR check_in_method IN ('face', 'manual', 'rfid'))");

        DB::statement('ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_check_out_method_check');
        DB::statement("ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_check_out_method_check CHECK (check_out_method IS NULL OR check_out_method IN ('face', 'manual', 'rfid'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('rfid_events');
        Schema::dropIfExists('rfid_cards');
        Schema::dropIfExists('rfid_readers');

        DB::statement('ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_check_in_method_check');
        DB::statement("ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_check_in_method_check CHECK (check_in_method IS NULL OR check_in_method IN ('face', 'manual'))");

        DB::statement('ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_check_out_method_check');
        DB::statement("ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_check_out_method_check CHECK (check_out_method IS NULL OR check_out_method IN ('face', 'manual'))");
    }
};
