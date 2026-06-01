<?php

namespace Database\Seeders;

use App\Models\Employee;
use App\Models\Location;
use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
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

        $location = Location::create([
            'organization_id' => $org->id,
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
            ['name' => 'recognition.view', 'label' => 'View Recognition Events'],
            ['name' => 'reports.view', 'label' => 'View Reports'],
            ['name' => 'reports.export', 'label' => 'Export Reports'],
            ['name' => 'audit.view', 'label' => 'View Audit Logs'],
        ];

        foreach ($permissions as $perm) {
            Permission::create($perm);
        }

        $adminRole = Role::create(['name' => 'admin', 'label' => 'Administrator']);
        $adminRole->permissions()->sync(Permission::pluck('id'));

        $hrRole = Role::create(['name' => 'hr', 'label' => 'HR Manager']);
        $hrRole->permissions()->sync(
            Permission::whereIn('name', [
                'employees.manage', 'attendance.manage', 'shifts.manage',
                'holidays.manage', 'leave.approve', 'reports.view', 'reports.export',
            ])->pluck('id')
        );

        $admin = User::create([
            'organization_id' => $org->id,
            'name' => 'System Admin',
            'email' => 'admin@attendance.local',
            'password' => Hash::make('password'),
            'email_verified_at' => now(),
        ]);
        $admin->roles()->attach($adminRole);

        Shift::create([
            'organization_id' => $org->id,
            'name' => 'Standard Day',
            'start_time' => '09:00',
            'end_time' => '17:00',
            'grace_minutes' => 15,
            'days_of_week' => [1, 2, 3, 4, 5],
        ]);

        foreach (range(1, 5) as $i) {
            Employee::create([
                'organization_id' => $org->id,
                'location_id' => $location->id,
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
