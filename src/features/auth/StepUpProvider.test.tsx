import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@/test/utils'
import { queryKeys } from '@/lib/api/query-keys'
import { adminOutSchema, CAPABILITIES, type AdminOut } from '@/lib/contracts'
import { StepUpProvider } from './StepUpProvider'
import { useStepUp } from './hooks/use-step-up'

/** ISO UTC sin zona, como lo manda el backend, a `offsetMs` de ahora. */
function naiveUtc(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19)
}

function sessionWith(expiresAt: string | null): AdminOut {
  return adminOutSchema.parse({
    id: 1,
    username: 'admin',
    catalog_version: 'abc',
    capabilities: [CAPABILITIES.databasesDrop],
    step_up_capabilities: [CAPABILITIES.databasesDrop],
    step_up_enforced: true,
    step_up_expires_at: expiresAt,
  })
}

/** Botón que llama a `ensureFresh` y deja el resultado a la vista. */
function Probe() {
  const stepUp = useStepUp()
  const results = useRef<string[]>([])
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void stepUp.ensureFresh(CAPABILITIES.databasesDrop).then((ok) => {
            results.current.push(String(ok))
            document.getElementById('result')!.textContent = results.current.join(',')
          })
        }}
      >
        Borrar
      </button>
      <output id="result" data-testid="result" />
    </>
  )
}

function renderProbe(session: AdminOut | null) {
  // `gcTime` infinito: en la app `/auth/me` siempre tiene un observador (`useSession`); acá no, y
  // con el `gcTime: 0` del cliente de tests la sesión sembrada se recolectaría al instante.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  queryClient.setQueryData(queryKeys.auth.me(), session)
  renderWithProviders(
    <StepUpProvider>
      <Probe />
    </StepUpProvider>,
    { queryClient },
  )
  return queryClient
}

const okStepUp = (expiresAt: string) =>
  http.post('http://localhost/api/v1/auth/step-up', () =>
    HttpResponse.json({ data: { step_up_expires_at: expiresAt, step_up_ttl_seconds: 300 } }),
  )

describe('StepUpProvider · ensureFresh', () => {
  it('con la ventana holgada sigue de largo sin preguntar', async () => {
    renderProbe(sessionWith(naiveUtc(4 * 60_000)))
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'))
    expect(screen.queryByText('Confirmá tu contraseña')).not.toBeInTheDocument()
  })

  it('con menos de un minuto pregunta ANTES y, al confirmar, guarda la ventana nueva', async () => {
    const renewed = naiveUtc(5 * 60_000)
    server.use(okStepUp(renewed))
    const queryClient = renderProbe(sessionWith(naiveUtc(30_000)))

    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    expect(await screen.findByText('Confirmá tu contraseña')).toBeInTheDocument()
    expect(screen.getByTestId('result')).toHaveTextContent('')

    await userEvent.type(screen.getByLabelText(/Contraseña/), 's3cr3t')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'))
    expect(screen.queryByText('Confirmá tu contraseña')).not.toBeInTheDocument()
    const me = queryClient.getQueryData<AdminOut>(queryKeys.auth.me())
    expect(me?.step_up_expires_at).toBe(renewed)
  })

  it('al cancelar resuelve `false`', async () => {
    renderProbe(sessionWith(null))
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'))
    expect(screen.queryByText('Confirmá tu contraseña')).not.toBeInTheDocument()
  })

  it('dos pedidos a la vez comparten UN diálogo', async () => {
    server.use(okStepUp(naiveUtc(5 * 60_000)))
    renderProbe(sessionWith(null))

    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Borrar', hidden: true }))
    expect(await screen.findAllByText('Confirmá tu contraseña')).toHaveLength(1)

    await userEvent.type(screen.getByLabelText(/Contraseña/), 's3cr3t')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true,true'))
  })

  it('si la sesión muere con el diálogo abierto, lo cierra y resuelve `false`', async () => {
    const queryClient = renderProbe(sessionWith(null))
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    expect(await screen.findByText('Confirmá tu contraseña')).toBeInTheDocument()

    // Lo que hace `SessionProvider` ante un 401 en cualquier otro request.
    act(() => {
      queryClient.setQueryData(queryKeys.auth.me(), null)
    })

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'))
    expect(screen.queryByText('Confirmá tu contraseña')).not.toBeInTheDocument()
  })
})
