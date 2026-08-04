import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { SqlThemeProvider } from '@/lib/theme/SqlThemeProvider'
import { ToastProvider } from '@/lib/toast/ToastProvider'
import { createQueryClient } from '@/lib/api/query-client'
import { SessionProvider } from '@/features/auth'

/** Composición de proveedores transversales. SessionProvider debe ir bajo QueryClientProvider. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <ThemeProvider>
      <SqlThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SessionProvider>{children}</SessionProvider>
          </ToastProvider>
        </QueryClientProvider>
      </SqlThemeProvider>
    </ThemeProvider>
  )
}
