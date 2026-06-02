<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        $newPermissions = [
            ['name' => 'organizations.manage', 'label' => 'Manage Organizations'],
            ['name' => 'branches.manage', 'label' => 'Manage Branches'],
            ['name' => 'departments.manage', 'label' => 'Manage Departments'],
            ['name' => 'security.view', 'label' => 'View Security Configuration'],
        ];

        foreach ($newPermissions as $perm) {
            if (! DB::table('permissions')->where('name', $perm['name'])->exists()) {
                DB::table('permissions')->insert([...$perm, 'created_at' => $now, 'updated_at' => $now]);
            }
        }

        if (DB::table('roles')->where('name', 'admin')->exists()) {
            DB::table('roles')->where('name', 'admin')->update([
                'name' => 'org_admin',
                'label' => 'Organization Admin',
                'updated_at' => $now,
            ]);
        }

        $roles = [
            ['name' => 'super_admin', 'label' => 'Super Admin'],
            ['name' => 'org_admin', 'label' => 'Organization Admin'],
            ['name' => 'hr_manager', 'label' => 'HR Manager'],
            ['name' => 'supervisor', 'label' => 'Supervisor'],
            ['name' => 'employee', 'label' => 'Employee'],
            ['name' => 'security_officer', 'label' => 'Security Officer'],
        ];

        foreach ($roles as $role) {
            if (! DB::table('roles')->where('name', $role['name'])->exists()) {
                DB::table('roles')->insert([...$role, 'created_at' => $now, 'updated_at' => $now]);
            }
        }

        if (DB::table('roles')->where('name', 'hr')->exists() && ! DB::table('roles')->where('name', 'hr_manager')->exists()) {
            DB::table('roles')->where('name', 'hr')->update([
                'name' => 'hr_manager',
                'label' => 'HR Manager',
                'updated_at' => $now,
            ]);
        }

        $permissionIds = DB::table('permissions')->pluck('id', 'name');
        $roleIds = DB::table('roles')->pluck('id', 'name');

        $matrix = [
            'org_admin' => $permissionIds->except('organizations.manage')->values()->all(),
            'hr_manager' => [
                'employees.manage', 'attendance.manage', 'shifts.manage', 'holidays.manage',
                'leave.approve', 'reports.view', 'reports.export', 'branches.manage', 'departments.manage',
            ],
            'supervisor' => ['attendance.manage', 'reports.view', 'leave.approve'],
            'employee' => [],
            'security_officer' => [
                'cameras.manage', 'edge.manage', 'rfid.manage', 'recognition.view',
                'reports.view', 'security.view',
            ],
        ];

        foreach ($matrix as $roleName => $permNames) {
            if (! isset($roleIds[$roleName])) {
                continue;
            }

            $ids = $roleName === 'org_admin'
                ? $permissionIds->values()->all()
                : collect($permNames)->map(fn ($n) => $permissionIds[$n] ?? null)->filter()->values()->all();

            foreach ($ids as $pid) {
                DB::table('role_permission')->insertOrIgnore([
                    'role_id' => $roleIds[$roleName],
                    'permission_id' => $pid,
                ]);
            }
        }
    }

    public function down(): void
    {
        // Non-destructive: roles/permissions remain for data safety.
    }
};
