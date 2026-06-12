import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { clearToken, setToken } from '@/shared/lib/session'
import type { User } from '@/shared/types'
import type { RootState } from '@/store'

/**
 * Auth state lives in Redux so the signed-in user is a single source of truth
 * shared across the app (and visible in the Redux DevTools). The JWT itself is
 * kept in `lib/session` (localStorage) — it is a transport credential read by
 * the axios interceptor, not view state.
 *
 * `status` drives routing:
 *   - 'loading'       → a token exists and we are validating it via /auth/me
 *   - 'authenticated' → user is loaded
 *   - 'anonymous'     → no token, or validation/logout completed
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthState {
  user: User | null
  status: AuthStatus
}

function initialStatus(): AuthStatus {
  // Read synchronously so anonymous visitors never flash a loader. `getToken`
  // is intentionally re-read here (not imported as a constant) so a fresh store
  // always reflects current storage.
  return typeof localStorage !== 'undefined' && localStorage.getItem('auth_token')
    ? 'loading'
    : 'anonymous'
}

const initialState: AuthState = {
  user: null,
  status: initialStatus(),
}

/** Validate the persisted token by loading the current user. */
export const fetchCurrentUser = createAsyncThunk<User, void, { rejectValue: null }>(
  'auth/fetchCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get<User>('/auth/me')
      return data
    } catch {
      clearToken()
      return rejectWithValue(null)
    }
  }
)

/** Exchange credentials for a token + user; persists the token on success. */
export const loginUser = createAsyncThunk(
  'auth/login',
  async (credentials: { email: string; password: string }) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', credentials)
    setToken(data.token)
    return data.user
  }
)

/** Create an account; the API returns a token + user, so registration signs in. */
export const registerUser = createAsyncThunk<
  User,
  { name: string; email: string; password: string },
  { rejectValue: string }
>('auth/register', async (details, { rejectWithValue }) => {
  try {
    const { data } = await api.post<{ token: string; user: User }>('/auth/register', details)
    setToken(data.token)
    return data.user
  } catch (err) {
    // Surface the server's message (duplicate email, registration disabled, …).
    return rejectWithValue(getApiErrorMessage(err, 'Registration failed'))
  }
})

/** Update the signed-in user's profile (name/email); returns the fresh user. */
export const updateProfile = createAsyncThunk<User, { name?: string; email?: string }>(
  'auth/updateProfile',
  async (changes) => {
    const { data } = await api.patch<User>('/auth/me', changes)
    return data
  }
)

/** Change the signed-in user's password. No state change on success. */
export const changePassword = createAsyncThunk<
  void,
  { current_password: string; new_password: string }
>('auth/changePassword', async (body) => {
  await api.post('/auth/me/password', body)
})

/** Best-effort server logout; always clears the local token. */
export const logoutUser = createAsyncThunk('auth/logout', async () => {
  try {
    await api.post('/auth/logout')
  } finally {
    clearToken()
  }
})

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCurrentUser.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action: PayloadAction<User>) => {
        state.user = action.payload
        state.status = 'authenticated'
      })
      .addCase(fetchCurrentUser.rejected, (state) => {
        state.user = null
        state.status = 'anonymous'
      })
      .addCase(loginUser.fulfilled, (state, action: PayloadAction<User>) => {
        state.user = action.payload
        state.status = 'authenticated'
      })
      .addCase(loginUser.rejected, (state) => {
        state.user = null
        state.status = 'anonymous'
      })
      .addCase(registerUser.fulfilled, (state, action: PayloadAction<User>) => {
        state.user = action.payload
        state.status = 'authenticated'
      })
      .addCase(registerUser.rejected, (state) => {
        state.user = null
        state.status = 'anonymous'
      })
      .addCase(updateProfile.fulfilled, (state, action: PayloadAction<User>) => {
        state.user = action.payload
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null
        state.status = 'anonymous'
      })
  },
})

// ── Selectors ────────────────────────────────────────────────────────────────
export const selectUser = (state: RootState) => state.auth.user
export const selectAuthStatus = (state: RootState) => state.auth.status
export const selectAuthLoading = (state: RootState) => state.auth.status === 'loading'

export const selectIsSuperAdmin = (state: RootState): boolean =>
  state.auth.user?.roles?.some((r) => r.name === 'super_admin') ?? false

export const selectHasPermission =
  (name: string) =>
  (state: RootState): boolean => {
    const user = state.auth.user
    if (user?.roles?.some((r) => r.name === 'super_admin')) return true
    return user?.roles?.some((r) => r.permissions?.some((p) => p.name === name)) ?? false
  }

export default authSlice.reducer
