import { type ReactElement, type ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { ToastProvider } from '@/lib/toast/ToastProvider'

/** QueryClient para tests: sin reintentos para que los errores se propaguen al instante. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

interface ProvidersOptions {
  route?: string
  queryClient?: QueryClient
}

export function AllProviders({
  children,
  route = '/',
  queryClient,
}: {
  children: ReactNode
} & ProvidersOptions) {
  const client = queryClient ?? createTestQueryClient()
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export function renderWithProviders(
  ui: ReactElement,
  options: ProvidersOptions & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { route, queryClient, ...rest } = options
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders route={route} queryClient={queryClient}>
        {children}
      </AllProviders>
    ),
    ...rest,
  })
}
