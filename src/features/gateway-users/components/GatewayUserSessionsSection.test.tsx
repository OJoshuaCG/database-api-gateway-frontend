import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { formatUtcDateTime } from '@/lib/utils/format'
import { GatewayUserSessionsSection } from './GatewayUserSessionsSection'

const API = 'http://localhost/api/v1'

const SESSIONS = [
  {
    created_at: '2026-10-02T15:00:00',
    last_seen_at: '2026-10-02T15:40:12',
    expires_at: '2026-10-03T03:00:00',
    ip: '10.0.0.7',
  },
  {
    created_at: '2026-10-01T09:00:00',
    last_seen_at: '2026-10-01T09:05:00',
    expires_at: '2026-10-01T21:00:00',
    ip: null,
  },
]

function mockSessions(options: { revoked?: number } = {}) {
  let list = SESSIONS
  let revokeCalls = 0
  server.use(
    http.get(`${API}/gateway-users/7/sessions`, () => HttpResponse.json({ data: list })),
    http.post(`${API}/gateway-users/7/sessions/revoke`, () => {
      revokeCalls += 1
      list = []
      return HttpResponse.json({
        data: { revoked: options.revoked ?? 2 },
        message: '2 sesión(es) cerrada(s).',
      })
    }),
  )
  return { revokeCalls: () => revokeCalls }
}

const USER = { id: 7, username: 'mlopez' }

describe('GatewayUserSessionsSection', () => {
  it('lista las sesiones con las fechas UTC en hora local y la IP', async () => {
    mockSessions()
    renderWithProviders(<GatewayUserSessionsSection user={USER} isSelf={false} />)

    // Cada fila existe dos veces en el DOM (tabla y tarjeta): `DataTable` oculta una por CSS.
    expect((await screen.findAllByText('10.0.0.7')).length).toBeGreaterThan(0)
    // Sin la `Z` el navegador leería la hora como local y la correría la diferencia horaria.
    expect(screen.getAllByText(formatUtcDateTime('2026-10-02T15:00:00')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(formatUtcDateTime('2026-10-03T03:00:00')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Vence a más tardar').length).toBeGreaterThan(0)
  })

  it('cierra todas tras confirmar, avisa la cantidad y refresca la lista', async () => {
    const backend = mockSessions({ revoked: 2 })
    renderWithProviders(<GatewayUserSessionsSection user={USER} isSelf={false} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar todas las sesiones' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/No cambia su contraseña ni su acceso/)).toBeInTheDocument()
    expect(backend.revokeCalls()).toBe(0)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar sesiones' }))

    expect(await screen.findByText('Se cerraron 2 sesiones de mlopez')).toBeInTheDocument()
    expect(backend.revokeCalls()).toBe(1)
    expect(await screen.findAllByText('No tiene sesiones abiertas')).not.toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('con 0 cerradas lo dice como resultado, no como error', async () => {
    mockSessions({ revoked: 0 })
    renderWithProviders(<GatewayUserSessionsSection user={USER} isSelf={false} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar todas las sesiones' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cerrar sesiones' }),
    )
    expect(await screen.findByText('mlopez no tenía sesiones abiertas')).toBeInTheDocument()
  })

  it('en la propia cuenta el botón va deshabilitado con el motivo, que apunta a Mi cuenta', async () => {
    const backend = mockSessions()
    renderWithProviders(<GatewayUserSessionsSection user={USER} isSelf />)

    const button = await screen.findByRole('button', { name: 'Cerrar todas las sesiones' })
    expect(button).toBeDisabled()
    const hint = screen.getByText(/Es tu propia cuenta/)
    expect(button).toHaveAttribute('aria-describedby', hint.id)
    expect(within(hint).getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute(
      'href',
      '/mi-cuenta?tab=sesiones',
    )
    expect(backend.revokeCalls()).toBe(0)
  })

  it('el 409 de la propia cuenta se explica con el copy del módulo', async () => {
    server.use(
      http.get(`${API}/gateway-users/7/sessions`, () => HttpResponse.json({ data: SESSIONS })),
      http.post(`${API}/gateway-users/7/sessions/revoke`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'No podés modificarte',
              type: 'AppHttpException',
              public_context: { code: 'access.self_modification_forbidden' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderWithProviders(<GatewayUserSessionsSection user={USER} isSelf={false} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar todas las sesiones' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cerrar sesiones' }),
    )
    expect(await screen.findByText('No se pudieron cerrar las sesiones')).toBeInTheDocument()
  })

  it('un 403 muestra el estado de acceso compartido, sin «Reintentar»', async () => {
    server.use(
      http.get(`${API}/gateway-users/7/sessions`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'Prohibido',
              type: 'AppHttpException',
              public_context: { code: 'access.forbidden' },
            },
          },
          { status: 403 },
        ),
      ),
    )
    renderWithProviders(<GatewayUserSessionsSection user={USER} isSelf={false} />)

    expect(
      await screen.findByText('No tenés acceso a las sesiones de esta persona'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cerrar todas las sesiones' }),
    ).not.toBeInTheDocument()
  })
})
