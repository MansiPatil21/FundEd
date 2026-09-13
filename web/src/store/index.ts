import { configureStore } from '@reduxjs/toolkit'
import budgetWizard from './budgetWizard'

export const makeStore = () =>
  configureStore({
    reducer: { budgetWizard },
  })

export type AppStore = ReturnType<typeof makeStore>
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
