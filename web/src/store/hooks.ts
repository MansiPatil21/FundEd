import { useDispatch, useSelector, useStore } from 'react-redux'
import type { AppDispatch, AppStore, RootState } from './index'

/**
 * Typed wrappers, so no component has to remember the store's shape. Using the bare
 * hooks would give `any` for state and silently accept a misspelled field.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<AppStore>()
