<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('face_enrollment_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('image_count');
            $table->decimal('average_quality_score', 6, 4)->nullable();
            $table->unsignedSmallInteger('version')->default(1);
            $table->boolean('raw_images_retained')->default(false);
            $table->timestamps();
        });

        Schema::create('face_enrollment_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('face_enrollment_session_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('image_index');
            $table->string('storage_path')->nullable();
            $table->decimal('quality_score', 6, 4)->nullable();
            $table->json('validation_checks')->nullable();
            $table->timestamps();
        });

        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->foreignId('face_enrollment_session_id')->nullable()->after('employee_id')
                ->constrained()->nullOnDelete();
            $table->decimal('quality_score', 6, 4)->nullable()->after('faiss_id');
            $table->unsignedSmallInteger('image_index')->nullable()->after('quality_score');
        });
    }

    public function down(): void
    {
        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('face_enrollment_session_id');
            $table->dropColumn(['quality_score', 'image_index']);
        });
        Schema::dropIfExists('face_enrollment_images');
        Schema::dropIfExists('face_enrollment_sessions');
    }
};
