import { configureStore } from '@reduxjs/toolkit'
import authReducer from './authSlice'
import tenantReducer from './tenantSlice'

/**
 * Factory so tests can spin up an isolated store; the app uses the shared
 * singleton `store` below.
 */
export function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      tenant: tenantReducer,
    },
  })
}

export const store = makeStore()

export type AppStore = ReturnType<typeof makeStore>
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
