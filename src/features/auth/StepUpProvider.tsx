import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setStepUpHandler } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import type { AdminOut, Capability, StepUpOut } from '@/lib/contracts'
import { StepUpDialog } from './components/StepUpDialog'
import { StepUpContext, type StepUpContextValue } from './hooks/use-step-up'
import { needsStepUpPreflight } from './step-up'

/**
 * Pedido de contraseña del step-up para toda la app. Va bajo `SessionProvider`.
 *
 * Hace tres cosas:
 *
 * - registra en `runRequest` quién pregunta ante un 403 `access.step_up_required`;
 * - ofrece `useStepUp().ensureFresh` para preguntar ANTES de abrir una confirmación;
 * - al confirmar, escribe la ventana nueva en `/auth/me`, que es de donde el preflight la lee.
 *
 * **Un solo pedido a la vez.** Todos los que llegan mientras el diálogo está abierto —varios 403
 * en paralelo, un preflight y un 403— esperan la misma promesa y se resuelven juntos.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  /** Clave del diálogo montado, o `null` si no hay pedido. Una nueva por pedido: estado fresco. */
  const [promptKey, setPromptKey] = useState<number | null>(null)
  const sequenceRef = useRef(0)
  const pendingRef = useRef<Promise<boolean> | null>(null)
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  const requestStepUp = useCallback((): Promise<boolean> => {
    if (pendingRef.current) return pendingRef.current
    const promise = new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
    pendingRef.current = promise
    sequenceRef.current += 1
    setPromptKey(sequenceRef.current)
    return promise
  }, [])

  const finish = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    pendingRef.current = null
    setPromptKey(null)
    resolve?.(confirmed)
  }, [])

  useEffect(() => {
    setStepUpHandler(() => requestStepUp())
    return () => setStepUpHandler(null)
  }, [requestStepUp])

  /*
   * Si la sesión muere con el diálogo abierto (otro request recibió un 401 y `SessionProvider`
   * dejó `/auth/me` en `null`), el pedido ya no tiene sentido: se suelta como cancelado para que
   * nadie quede esperando una contraseña que no se va a poder confirmar, y el diálogo no queda
   * encima de la pantalla de login.
   */
  useEffect(() => {
    const meKey = JSON.stringify(queryKeys.auth.me())
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || resolveRef.current === null) return
      if (JSON.stringify(event.query.queryKey) !== meKey) return
      if (event.query.state.data === null) finish(false)
    })
  }, [queryClient, finish])

  const ensureFresh = useCallback(
    (capability: Capability): Promise<boolean> => {
      // Se lee la caché en el momento, no en el render: el reloj corre aunque nada re-renderice.
      const admin = queryClient.getQueryData<AdminOut | null>(queryKeys.auth.me())
      if (!needsStepUpPreflight(admin, capability, Date.now())) return Promise.resolve(true)
      return requestStepUp()
    },
    [queryClient, requestStepUp],
  )

  const withFresh = useCallback(
    (capability: Capability, action: () => void, onCancel?: () => void) => {
      const admin = queryClient.getQueryData<AdminOut | null>(queryKeys.auth.me())
      if (!needsStepUpPreflight(admin, capability, Date.now())) {
        action()
        return
      }
      void requestStepUp().then((confirmed) => (confirmed ? action() : onCancel?.()))
    },
    [queryClient, requestStepUp],
  )

  const onConfirmed = useCallback(
    (result: StepUpOut) => {
      queryClient.setQueryData<AdminOut | null>(queryKeys.auth.me(), (previous) =>
        previous ? { ...previous, step_up_expires_at: result.step_up_expires_at } : previous,
      )
      finish(true)
    },
    [queryClient, finish],
  )

  const value = useMemo<StepUpContextValue>(
    () => ({ ensureFresh, withFresh, requestStepUp }),
    [ensureFresh, withFresh, requestStepUp],
  )

  return (
    <StepUpContext.Provider value={value}>
      {children}
      {promptKey !== null && (
        <StepUpDialog key={promptKey} onConfirmed={onConfirmed} onCancel={() => finish(false)} />
      )}
    </StepUpContext.Provider>
  )
}
