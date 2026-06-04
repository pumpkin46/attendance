import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { clearOrgId, getOrgId, setOrgId } from '../lib/session'
import type { RootState } from './index'

/**
 * Super-admin "act as organization" context. The selected org id is sent as the
 * `X-Organization-Id` header by the axios interceptor (which reads it from
 * `lib/session`), so the reducers write through to localStorage to keep the
 * persisted value and the store in lockstep across reloads.
 */
interface TenantState {
  orgId: string | null
}

const initialState: TenantState = {
  orgId: getOrgId(),
}

const tenantSlice = createSlice({
  name: 'tenant',
  initialState,
  reducers: {
    setOrg(state, action: PayloadAction<string>) {
      state.orgId = action.payload
      setOrgId(action.payload)
    },
    clearOrg(state) {
      state.orgId = null
      clearOrgId()
    },
  },
})

export const { setOrg, clearOrg } = tenantSlice.actions

export const selectOrgId = (state: RootState) => state.tenant.orgId

export default tenantSlice.reducer
