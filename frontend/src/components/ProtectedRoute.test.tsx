import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ProtectedRoute from './ProtectedRoute'
import * as authModule from '../contexts/AuthContext'

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
const mockedUseAuth = vi.mocked(authModule.useAuth)

function setup() {
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/login" element={<div>login-page</div>} />
        <Route
          path="/secret"
          element={
            <ProtectedRoute>
              <div>secret-content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  it('shows a loader while auth is resolving', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: true } as never)
    setup()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('redirects to /login when unauthenticated', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as never)
    setup()
    expect(screen.getByText('login-page')).toBeInTheDocument()
    expect(screen.queryByText('secret-content')).not.toBeInTheDocument()
  })

  it('renders children when authenticated', () => {
    mockedUseAuth.mockReturnValue({ user: { id: 1, name: 'A', email: 'a@x' }, loading: false } as never)
    setup()
    expect(screen.getByText('secret-content')).toBeInTheDocument()
  })
})
