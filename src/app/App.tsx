import { RouterProvider } from 'react-router-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { SectionErrorFallback } from '@/components/layout/SectionErrorFallback'
import { AppProviders } from './providers'
import { router } from './router'

export function App() {
  return (
    <AppProviders>
      <ErrorBoundary FallbackComponent={SectionErrorFallback}>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </AppProviders>
  )
}
