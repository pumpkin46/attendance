<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recognition_events', function (Blueprint $table) {
            $table->string('snapshot_path')->nullable()->after('image_hash');
            $table->timestamp('notified_at')->nullable()->after('metadata');
        });

        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('type');
            $table->morphs('notifiable');
            $table->text('data');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');

        Schema::table('recognition_events', function (Blueprint $table) {
            $table->dropColumn(['snapshot_path', 'notified_at']);
        });
    }
};
