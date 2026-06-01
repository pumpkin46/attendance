import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Employee, Paginated } from '../types'

export default function EnrollmentPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .get<Paginated<Employee>>('/employees', { params: { per_page: 100, is_active: true } })
      .then((r) => setEmployees(r.data.data))
  }, [])

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!employeeId || !preview) return
    setSubmitting(true)
    setMessage('')
    try {
      await api.post(`/employees/${employeeId}/enroll-face`, { image: preview })
      setMessage('Face enrolled successfully')
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      setMessage('Enrollment failed — ensure a clear face photo')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1>Face Enrollment</h1>
      <p className="muted">Register employee face embeddings for recognition</p>

      <form className="card enroll-form" onSubmit={submit}>
        <label>
          Employee
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.first_name} {e.last_name}
                {e.face_enrolled ? ' (re-enroll)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          Face photo
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="user"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            required
          />
        </label>

        {preview && <img src={preview} alt="Preview" className="enroll-preview" />}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Enrolling…' : 'Enroll face'}
        </button>

        {message && <p className={message.includes('success') ? 'text-ok' : 'text-danger'}>{message}</p>}
      </form>
    </div>
  )
}
