<?php

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        $permission = Permission::firstOrCreate(
            ['name' => 'edge.manage'],
            ['label' => 'Manage Edge AI Devices']
        );

        $adminRole = Role::where('name', 'admin')->first();
        if ($adminRole && ! $adminRole->permissions()->where('permissions.id', $permission->id)->exists()) {
            $adminRole->permissions()->attach($permission);
        }
    }

    public function down(): void
    {
        $permission = Permission::where('name', 'edge.manage')->first();
        if ($permission) {
            $permission->roles()->detach();
            $permission->delete();
        }
    }
};
