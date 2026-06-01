import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Employee, Paginated } from '../types'

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api
      .get<Paginated<Employee>>('/employees', { params: { search, per_page: 50 } })
      .then((r) => setEmployees(r.data.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [search])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Employees</h1>
          <p className="muted">Workforce registry and face enrollment status</p>
        </div>
        <input
          className="search-input"
          placeholder="Search employees…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card table-card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Department</th>
                <th>Location</th>
                <th>Face enrolled</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>{e.employee_code}</td>
                  <td>
                    {e.first_name} {e.last_name}
                  </td>
                  <td>{e.department ?? '—'}</td>
                  <td>{e.location?.name ?? '—'}</td>
                  <td>
                    <span className={e.face_enrolled ? 'badge badge-ok' : 'badge badge-warn'}>
                      {e.face_enrolled ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>{e.is_active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
