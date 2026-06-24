import type { FallbackProps } from 'react-error-boundary'
import { ErrorState } from '@/components/ui'

/** Fallback de error boundary por sección (sin class components: react-error-boundary). */
export function SectionErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="py-8">
      <ErrorState
        error={error}
        onRetry={resetErrorBoundary}
        title="Algo salió mal en esta sección"
      />
    </div>
  )
}
