import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { SqlThemeProvider } from '@/lib/theme/SqlThemeProvider'
import { SqlWrapProvider } from '@/lib/theme/SqlWrapProvider'
import { ToastProvider } from '@/lib/toast/ToastProvider'
import { createQueryClient } from '@/lib/api/query-client'
import { SessionProvider, StepUpProvider } from '@/features/auth'

/**
 * Composición de proveedores transversales. SessionProvider debe ir bajo QueryClientProvider, y
 * StepUpProvider bajo SessionProvider: el pedido de contraseña lee y escribe `/auth/me`, y se
 * suelta solo cuando un 401 deja la sesión en `null`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <ThemeProvider>
      <SqlThemeProvider>
        <SqlWrapProvider>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SessionProvider>
                <StepUpProvider>{children}</StepUpProvider>
              </SessionProvider>
            </ToastProvider>
          </QueryClientProvider>
        </SqlWrapProvider>
      </SqlThemeProvider>
    </ThemeProvider>
  )
}
