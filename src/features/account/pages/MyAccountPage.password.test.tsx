import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { createTestQueryClient, renderWithProviders } from '@/test/utils'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { CSRF_HEADER } from '@/lib/api/csrf'
import { mutateVoid } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { MyAccountPage } from './MyAccountPage'

const API = 'http://localhost/api/v1'
const ROUTE = '/mi-cuenta?tab=contrasena'

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  }
}

afterEach(clearCookies)

/** Mockea `/auth/me` y la respuesta de `POST /auth/password`; devuelve el cuerpo recibido. */
function mockPasswordChange(response: () => Response) {
  const received: { body: unknown } = { body: undefined }
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role: 'viewer' }) })),
    http.post(`${API}/auth/password`, async ({ request }) => {
      received.body = await request.json()
      return response()
    }),
  )
  return received
}

function errorResponse(status: number, code?: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json(
    {
      detail: {
        msg: 'mensaje del backend',
        type: 'error',
        public_context: code ? { code, ...extra } : undefined,
      },
    },
    { status },
  )
}

async function fillAndSubmit(
  current = 'actual-de-doce-chars',
  next = 'nueva-de-doce-chars',
  repeat = next,
) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(/Contraseña actual/), current)
  await user.type(screen.getByLabelText(/^Contraseña nueva/), next)
  await user.type(screen.getByLabelText(/Repetí la contraseña nueva/), repeat)
  await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
  return user
}

describe('MyAccountPage — «Contraseña»', () => {
  it('manda el cuerpo, dice cuántas sesiones cerró, limpia el form e invalida me y sesiones', async () => {
    const received = mockPasswordChange(() =>
      HttpResponse.json({ data: { revoked_sessions: 2 }, message: 'Contraseña cambiada.' }),
    )
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderWithProviders(<MyAccountPage />, { route: ROUTE, queryClient })

    expect(await screen.findByRole('tab', { name: 'Contraseña' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await fillAndSubmit()

    expect(
      await screen.findByText('Tu contraseña cambió. Se cerraron 2 sesiones en otros lugares.'),
    ).toBeInTheDocument()
    expect(received.body).toEqual({
      current_password: 'actual-de-doce-chars',
      new_password: 'nueva-de-doce-chars',
    })
    expect(screen.getByLabelText(/Contraseña actual/)).toHaveValue('')
    expect(screen.getByLabelText(/^Contraseña nueva/)).toHaveValue('')
    expect(screen.getByLabelText(/Repetí la contraseña nueva/)).toHaveValue('')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.auth.me() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.auth.sessions() })
  })

  it.each([
    [0, 'Tu contraseña cambió. No había otras sesiones abiertas.'],
    [1, 'Tu contraseña cambió. Se cerró 1 sesión en otro lugar.'],
  ])('pluraliza bien con %i sesiones cerradas', async (revoked, copy) => {
    mockPasswordChange(() => HttpResponse.json({ data: { revoked_sessions: revoked } }))
    renderWithProviders(<MyAccountPage />, { route: ROUTE })
    await fillAndSubmit()
    expect(await screen.findByText(copy)).toBeInTheDocument()
  })

  it('si la nueva y la repetida no coinciden, no manda nada', async () => {
    const received = mockPasswordChange(() => HttpResponse.json({ data: { revoked_sessions: 0 } }))
    renderWithProviders(<MyAccountPage />, { route: ROUTE })
    await fillAndSubmit('actual-de-doce-chars', 'nueva-de-doce-chars', 'otra-cosa-distinta')
    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(received.body).toBeUndefined()
  })

  it('una nueva más corta que el mínimo compartido tampoco sale', async () => {
    const received = mockPasswordChange(() => HttpResponse.json({ data: { revoked_sessions: 0 } }))
    renderWithProviders(<MyAccountPage />, { route: ROUTE })
    await fillAndSubmit('actual-de-doce-chars', 'corta')
    expect(await screen.findByText('Mínimo 12 caracteres')).toBeInTheDocument()
    expect(received.body).toBeUndefined()
  })

  it.each([
    [
      'auth.invalid_current_password',
      422,
      {},
      'La contraseña actual no es correcta.',
      /Contraseña actual/,
    ],
    [
      'gateway_user.weak_password',
      422,
      { min_length: 16 },
      'La contraseña es demasiado corta: necesita al menos 16 caracteres.',
      /^Contraseña nueva/,
    ],
    [
      'auth.password_unchanged',
      422,
      {},
      'La contraseña nueva tiene que ser distinta de la actual.',
      /^Contraseña nueva/,
    ],
  ])('%s queda fijo en su campo', async (code, status, extra, copy, field) => {
    mockPasswordChange(() => errorResponse(status, code, extra))
    renderWithProviders(<MyAccountPage />, { route: ROUTE })
    await fillAndSubmit()
    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.getByLabelText(field)).toHaveAccessibleDescription(copy)
  })

  it.each([
    [429, undefined, 'Hiciste demasiados intentos. Esperá un minuto y volvé a probar.'],
    [403, 'auth.csrf_invalid', /La credencial de seguridad del formulario no es válida/],
    [403, 'auth.origin_rejected', /origen que el gateway no reconoce/],
  ])('%i %s queda fijo arriba del formulario', async (status, code, copy) => {
    mockPasswordChange(() => errorResponse(status, code))
    renderWithProviders(<MyAccountPage />, { route: ROUTE })
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(copy)
  })

  it('después del cambio, el próximo método no seguro manda el token CSRF NUEVO', async () => {
    document.cookie = 'gw_csrf=token-viejo; path=/'
    let csrfAtChange: string | null = null
    let csrfAfter: string | null = null
    server.use(
      http.get(`${API}/auth/me`, () => HttpResponse.json({ data: meFixture({ role: 'viewer' }) })),
      http.post(`${API}/auth/password`, async ({ request }) => {
        csrfAtChange = request.headers.get(CSRF_HEADER)
        await request.json()
        // El backend rota el `sid` y re-emite la cookie CSRF en esta misma respuesta.
        document.cookie = 'gw_csrf=token-nuevo; path=/'
        return HttpResponse.json({ data: { revoked_sessions: 0 } })
      }),
      http.post(`${API}/auth/sessions/revoke-others`, ({ request }) => {
        csrfAfter = request.headers.get(CSRF_HEADER)
        return HttpResponse.json({ data: null })
      }),
    )
    renderWithProviders(<MyAccountPage />, { route: ROUTE })
    await fillAndSubmit()
    await screen.findByText('Tu contraseña cambió. No había otras sesiones abiertas.')

    await mutateVoid('POST', '/auth/sessions/revoke-others')
    await waitFor(() => expect(csrfAfter).toBe('token-nuevo'))
    expect(csrfAtChange).toBe('token-viejo')
  })
})
