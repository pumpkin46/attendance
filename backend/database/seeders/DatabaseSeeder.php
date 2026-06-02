<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\Department;
use App\Models\Employee;
use App\Models\Location;
use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
use App\Models\AttendancePolicy;
use App\Models\Shift;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $org = Organization::create([
            'name' => 'Demo Corporation',
            'code' => 'DEMO',
            'timezone' => 'UTC',
        ]);

        $branch = Branch::create([
            'organization_id' => $org->id,
            'name' => 'Head Office Branch',
            'code' => 'HQ',
            'address' => '100 Main Street',
            'timezone' => 'UTC',
        ]);

        $department = Department::create([
            'organization_id' => $org->id,
            'branch_id' => $branch->id,
            'name' => 'Operations',
            'code' => 'OPS',
        ]);

        $location = Location::create([
            'organization_id' => $org->id,
            'branch_id' => $branch->id,
            'name' => 'Head Office',
            'address' => '100 Main Street',
            'timezone' => 'UTC',
        ]);

        $permissions = [
            ['name' => 'employees.manage', 'label' => 'Manage Employees'],
            ['name' => 'attendance.manage', 'label' => 'Manage Attendance'],
            ['name' => 'shifts.manage', 'label' => 'Manage Shifts'],
            ['name' => 'holidays.manage', 'label' => 'Manage Holidays'],
            ['name' => 'leave.approve', 'label' => 'Approve Leave'],
            ['name' => 'cameras.manage', 'label' => 'Manage Cameras'],
            ['name' => 'rfid.manage', 'label' => 'Manage RFID'],
            ['name' => 'edge.manage', 'label' => 'Manage Edge AI Devices'],
            ['name' => 'recognition.view', 'label' => 'View Recognition Events'],
            ['name' => 'reports.view', 'label' => 'View Reports'],
            ['name' => 'reports.export', 'label' => 'Export Reports'],
            ['name' => 'audit.view', 'label' => 'View Audit Logs'],
            ['name' => 'organizations.manage', 'label' => 'Manage Organizations'],
            ['name' => 'branches.manage', 'label' => 'Manage Branches'],
            ['name' => 'departments.manage', 'label' => 'Manage Departments'],
            ['name' => 'security.view', 'label' => 'View Security Configuration'],
        ];

        foreach ($permissions as $perm) {
            Permission::create($perm);
        }

        $allExceptOrgManage = Permission::where('name', '!=', 'organizations.manage')->pluck('id');

        $roles = [
            'super_admin' => ['label' => 'Super Admin', 'permissions' => []],
            'org_admin' => ['label' => 'Organization Admin', 'permissions' => $allExceptOrgManage],
            'hr_manager' => ['label' => 'HR Manager', 'permissions' => Permission::whereIn('name', [
                'employees.manage', 'attendance.manage', 'shifts.manage', 'holidays.manage',
                'leave.approve', 'reports.view', 'reports.export', 'branches.manage', 'departments.manage',
            ])->pluck('id')],
            'supervisor' => ['label' => 'Supervisor', 'permissions' => Permission::whereIn('name', [
                'attendance.manage', 'reports.view', 'leave.approve',
            ])->pluck('id')],
            'employee' => ['label' => 'Employee', 'permissions' => collect()],
            'security_officer' => ['label' => 'Security Officer', 'permissions' => Permission::whereIn('name', [
                'cameras.manage', 'edge.manage', 'rfid.manage', 'recognition.view',
                'reports.view', 'security.view',
            ])->pluck('id')],
        ];

        $roleModels = [];
        foreach ($roles as $name => $meta) {
            $role = Role::create(['name' => $name, 'label' => $meta['label']]);
            if ($meta['permissions']->isNotEmpty()) {
                $role->permissions()->sync($meta['permissions']);
            }
            $roleModels[$name] = $role;
        }

        $superAdmin = User::create([
            'organization_id' => null,
            'name' => 'Platform Super Admin',
            'email' => 'superadmin@attendance.local',
            'password' => Hash::make('password'),
            'email_verified_at' => now(),
        ]);
        $superAdmin->roles()->attach($roleModels['super_admin']);

        $admin = User::create([
            'organization_id' => $org->id,
            'branch_id' => $branch->id,
            'department_id' => $department->id,
            'name' => 'Organization Admin',
            'email' => 'admin@attendance.local',
            'password' => Hash::make('password'),
            'email_verified_at' => now(),
        ]);
        $admin->roles()->attach($roleModels['org_admin']);

        $policy = AttendancePolicy::create([
            'organization_id' => $org->id,
            'name' => 'Default Policy',
            'is_default' => true,
            ...config('attendance.default_policy'),
        ]);

        Shift::create([
            'organization_id' => $org->id,
            'attendance_policy_id' => $policy->id,
            'name' => 'Fixed — Office Day',
            'type' => 'fixed',
            'start_time' => '09:00',
            'end_time' => '18:00',
            'grace_minutes' => 15,
            'days_of_week' => [1, 2, 3, 4, 5],
        ]);

        Shift::create([
            'organization_id' => $org->id,
            'attendance_policy_id' => $policy->id,
            'name' => 'Rotational — Morning',
            'type' => 'rotational',
            'rotation_slot' => 'morning',
            'start_time' => '06:00',
            'end_time' => '14:00',
            'grace_minutes' => 10,
        ]);

        Shift::create([
            'organization_id' => $org->id,
            'attendance_policy_id' => $policy->id,
            'name' => 'Flexible',
            'type' => 'flexible',
            'start_time' => '08:00',
            'end_time' => '17:00',
            'grace_minutes' => 30,
        ]);

        Shift::create([
            'organization_id' => $org->id,
            'attendance_policy_id' => $policy->id,
            'name' => 'Split Shift',
            'type' => 'split',
            'start_time' => '08:00',
            'end_time' => '18:00',
            'segments' => [
                ['start' => '08:00', 'end' => '12:00'],
                ['start' => '14:00', 'end' => '18:00'],
            ],
            'grace_minutes' => 15,
        ]);

        foreach (range(1, 5) as $i) {
            Employee::create([
                'organization_id' => $org->id,
                'location_id' => $location->id,
                'branch_id' => $branch->id,
                'department_id' => $department->id,
                'employee_code' => sprintf('EMP%04d', $i),
                'first_name' => "Employee{$i}",
                'last_name' => 'Demo',
                'email' => "emp{$i}@demo.local",
                'department' => 'Operations',
                'hire_date' => now()->subYear(),
            ]);
        }
    }
}
