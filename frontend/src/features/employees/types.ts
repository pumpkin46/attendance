export interface EmployeeLocation {
  id: number
  name: string
}

export const emptyEmployeeForm = {
  employee_code: '',
  first_name: '',
  last_name: '',
  email: '',
  job_title: '',
  hire_date: '',
  location_id: '',
  // Org-tree node id as a string ('' = company root / unassigned to a sub-unit).
  organization_id: '',
  is_active: 'true',
}

export type EmployeeForm = typeof emptyEmployeeForm

/** Build an API payload, dropping empty optionals and coercing types. */
export function toEmployeePayload(form: EmployeeForm, includeStatus: boolean) {
  return {
    employee_code: form.employee_code.trim(),
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    email: form.email.trim() || null,
    job_title: form.job_title.trim() || null,
    hire_date: form.hire_date || null,
    location_id: form.location_id ? Number(form.location_id) : null,
    // '' means "no specific sub-unit" → null, which the API resolves to the
    // company root. A node id assigns the employee to that org-tree unit.
    organization_id: form.organization_id ? Number(form.organization_id) : null,
    ...(includeStatus ? { is_active: form.is_active === 'true' } : {}),
  }
}
