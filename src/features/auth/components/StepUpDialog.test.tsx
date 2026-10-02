import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { AUTH_SESSION_ERROR_CODES, AUTH_STEP_UP_ERROR_CODES } from '@/lib/contracts'
import { StepUpDialog } from './StepUpDialog'

const URL = 'http://localhost/api/v1/auth/step-up'

function renderDialog() {
  const onConfirmed = vi.fn()
  const onCancel = vi.fn()
  renderWithProviders(<StepUpDialog onConfirmed={onConfirmed} onCancel={onCancel} />)
  return { onConfirmed, onCancel }
}

async function submit(password: string) {
  await userEvent.type(screen.getByLabelText(/Contraseña/), password)
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
}

describe('StepUpDialog', () => {
  it('explica el pedido y confirma con la contraseña', async () => {
    let body: unknown = null
    server.use(
      http.post(URL, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          data: { step_up_expires_at: '2026-10-02T12:05:00', step_up_ttl_seconds: 300 },
        })
      }),
    )
    const { onConfirmed, onCancel } = renderDialog()

    expect(
      screen.getByText('Por seguridad, confirmá tu contraseña para continuar. Vale 5 minutos.'),
    ).toBeInTheDocument()
    await submit('s3cr3t')

    await waitFor(() =>
      expect(onConfirmed).toHaveBeenCalledWith({
        step_up_expires_at: '2026-10-02T12:05:00',
        step_up_ttl_seconds: 300,
      }),
    )
    expect(body).toEqual({ password: 's3cr3t' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('ante un 400 dice cuántos intentos quedan y sigue abierto', async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Contraseña incorrecta.',
              public_context: { code: AUTH_STEP_UP_ERROR_CODES.failed, attempts_remaining: 3 },
            },
          },
          { status: 400 },
        ),
      ),
    )
    const { onConfirmed, onCancel } = renderDialog()
    await submit('mala')

    expect(await screen.findByRole('alert')).toHaveTextContent('Te quedan 3 intentos')
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    // El campo se vacía para el próximo intento.
    expect(screen.getByLabelText(/Contraseña/)).toHaveValue('')
  })

  it('avisa cuando es el último intento', async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Contraseña incorrecta.',
              public_context: { code: AUTH_STEP_UP_ERROR_CODES.failed, attempts_remaining: 1 },
            },
          },
          { status: 400 },
        ),
      ),
    )
    renderDialog()
    await submit('mala')
    expect(await screen.findByRole('alert')).toHaveTextContent('último intento')
  })

  it('ante un 429 pide esperar', async () => {
    server.use(http.post(URL, () => HttpResponse.json({ detail: 'Too Many' }, { status: 429 })))
    const { onCancel } = renderDialog()
    await submit('x')

    expect(await screen.findByRole('alert')).toHaveTextContent('Esperá un minuto')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('ante el 401 del quinto fallo se cierra (la sesión ya no existe)', async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Sesión cerrada.',
              public_context: { code: AUTH_SESSION_ERROR_CODES.stepUpFailed },
            },
          },
          { status: 401 },
        ),
      ),
    )
    const { onCancel } = renderDialog()
    await submit('mala')
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
  })

  it('«Cancelar» suelta el pedido sin llamar al servidor', async () => {
    const { onCancel } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
