<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('building_connectors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('location_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->enum('driver', ['webhook', 'mqtt', 'bacnet_gateway'])->default('webhook');
            $table->string('endpoint_url')->nullable();
            $table->string('api_secret')->nullable();
            $table->json('subscribed_events')->nullable();
            $table->json('settings')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_sync_at')->nullable();
            $table->timestamps();
        });

        Schema::create('building_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('building_connector_id')->constrained()->cascadeOnDelete();
            $table->string('event_type', 64);
            $table->json('payload')->nullable();
            $table->enum('status', ['pending', 'sent', 'failed', 'skipped'])->default('pending');
            $table->text('error_message')->nullable();
            $table->timestamp('dispatched_at')->nullable();
            $table->timestamps();
            $table->index(['building_connector_id', 'created_at']);
        });

        Schema::create('security_alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->nullable()->constrained()->nullOnDelete();
            $table->string('alert_type', 64);
            $table->enum('severity', ['low', 'medium', 'high', 'critical'])->default('medium');
            $table->string('title');
            $table->text('message');
            $table->enum('status', ['open', 'acknowledged', 'resolved'])->default('open');
            $table->json('metadata')->nullable();
            $table->foreignId('camera_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('visitor_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('recognition_event_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('access_point_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('acknowledged_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('acknowledged_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamp('occurred_at');
            $table->timestamps();
            $table->index(['organization_id', 'status', 'occurred_at']);
            $table->index(['alert_type', 'severity']);
        });

        Schema::create('visitor_kiosks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('location_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('access_point_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->string('device_id')->unique();
            $table->string('api_token');
            $table->boolean('allow_walk_in')->default(true);
            $table->boolean('require_host')->default(false);
            $table->boolean('require_liveness')->default(true);
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_heartbeat_at')->nullable();
            $table->timestamps();
        });

        Schema::table('visitors', function (Blueprint $table) {
            $table->string('check_in_code', 12)->nullable()->unique()->after('purpose');
            $table->string('badge_number', 32)->nullable()->after('check_in_code');
            $table->timestamp('checked_in_at')->nullable()->after('status');
        });

        $now = now();
        $permissions = [
            ['name' => 'building.manage', 'label' => 'Manage Smart Building Integrations'],
            ['name' => 'security.monitor', 'label' => 'AI Security Monitoring'],
            ['name' => 'visitor_kiosks.manage', 'label' => 'Manage Visitor Kiosks'],
        ];

        foreach ($permissions as $perm) {
            if (! DB::table('permissions')->where('name', $perm['name'])->exists()) {
                DB::table('permissions')->insert([...$perm, 'created_at' => $now, 'updated_at' => $now]);
            }
        }

        $permissionIds = DB::table('permissions')->whereIn('name', array_column($permissions, 'name'))->pluck('id', 'name');
        $roleIds = DB::table('roles')->pluck('id', 'name');

        $assign = [
            'org_admin' => array_values($permissionIds->all()),
            'security_officer' => [
                $permissionIds['security.monitor'] ?? null,
                $permissionIds['building.manage'] ?? null,
                $permissionIds['visitor_kiosks.manage'] ?? null,
            ],
        ];

        foreach ($assign as $roleName => $ids) {
            if (! isset($roleIds[$roleName])) {
                continue;
            }
            foreach (array_filter($ids) as $pid) {
                DB::table('role_permission')->insertOrIgnore([
                    'role_id' => $roleIds[$roleName],
                    'permission_id' => $pid,
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('visitors', function (Blueprint $table) {
            $table->dropColumn(['check_in_code', 'badge_number', 'checked_in_at']);
        });
        Schema::dropIfExists('visitor_kiosks');
        Schema::dropIfExists('security_alerts');
        Schema::dropIfExists('building_events');
        Schema::dropIfExists('building_connectors');
    }
};
