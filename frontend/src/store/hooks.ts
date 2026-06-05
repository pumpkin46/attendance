import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '@/store'

/** Typed `useDispatch` — knows about thunks (login/logout/fetchCurrentUser). */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()

/** Typed `useSelector` — `state` is inferred as `RootState`. */
export const useAppSelector = useSelector.withTypes<RootState>()
