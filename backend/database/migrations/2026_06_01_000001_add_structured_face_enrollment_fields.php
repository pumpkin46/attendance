<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('face_enrollment_sessions', function (Blueprint $table) {
            $table->decimal('enrollment_score', 6, 4)->nullable()->after('average_quality_score');
            $table->string('enrollment_mode', 32)->default('structured')->after('version');
        });

        Schema::table('face_enrollment_images', function (Blueprint $table) {
            $table->string('pose_type', 32)->nullable()->after('image_index');
            $table->json('face_metadata')->nullable()->after('validation_checks');
        });

        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->string('pose_type', 32)->nullable()->after('image_index');
            $table->json('face_metadata')->nullable()->after('pose_type');
        });
    }

    public function down(): void
    {
        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->dropColumn(['pose_type', 'face_metadata']);
        });

        Schema::table('face_enrollment_images', function (Blueprint $table) {
            $table->dropColumn(['pose_type', 'face_metadata']);
        });

        Schema::table('face_enrollment_sessions', function (Blueprint $table) {
            $table->dropColumn(['enrollment_score', 'enrollment_mode']);
        });
    }
};
