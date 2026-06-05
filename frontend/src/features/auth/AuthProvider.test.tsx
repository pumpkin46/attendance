import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { makeStore } from '@/store'
import { api } from '@/shared/api/client'
import type { User } from '@/shared/types'

vi.mock('@/shared/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

const mockedGet = vi.mocked(api.get)

function Probe({ perm }: { perm: string }) {
  const { user, hasPermission, isSuperAdmin } = useAuth()
  if (!user) return <div>no-user</div>
  return (
    <div>
      <span data-testid="perm">{String(hasPermission(perm))}</span>
      <span data-testid="super">{String(isSuperAdmin())}</span>
    </div>
  )
}

function renderWithUser(user: User, perm: string) {
  localStorage.setItem('auth_token', 'token')
  mockedGet.mockResolvedValueOnce({ data: user } as never)
  // Fresh store per render so auth state never leaks between tests. Created
  // after the token is set so it starts in the 'loading' state.
  const store = makeStore()
  return render(
    <Provider store={store}>
      <AuthProvider>
        <Probe perm={perm} />
      </AuthProvider>
    </Provider>
  )
}

describe('AuthContext permissions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('grants every permission to a super_admin', async () => {
    renderWithUser(
      { id: 1, name: 'Root', email: 'root@x', roles: [{ id: 1, name: 'super_admin', label: '', permissions: [] }] },
      'anything.at.all'
    )
    expect(await screen.findByTestId('perm')).toHaveTextContent('true')
    expect(screen.getByTestId('super')).toHaveTextContent('true')
  })

  it('grants only assigned permissions to a regular user', async () => {
    renderWithUser(
      {
        id: 2,
        name: 'Staff',
        email: 's@x',
        roles: [{ id: 2, name: 'staff', label: '', permissions: [{ id: 9, name: 'visitors.view', label: '' }] }],
      },
      'visitors.view'
    )
    expect(await screen.findByTestId('perm')).toHaveTextContent('true')
    expect(screen.getByTestId('super')).toHaveTextContent('false')
  })

  it('denies permissions the user does not have', async () => {
    renderWithUser(
      {
        id: 3,
        name: 'Staff',
        email: 's2@x',
        roles: [{ id: 2, name: 'staff', label: '', permissions: [{ id: 9, name: 'visitors.view', label: '' }] }],
      },
      'employees.delete'
    )
    expect(await screen.findByTestId('perm')).toHaveTextContent('false')
  })
})
