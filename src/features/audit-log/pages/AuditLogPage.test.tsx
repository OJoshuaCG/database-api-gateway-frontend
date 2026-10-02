import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { AuditLogPage } from './AuditLogPage'

const API = 'http://localhost/api/v1'

/** Quien lee la auditoría: `security_officer` es la única global con `policy.admin`. */
const OFFICER = meFixture({ role: 'viewer', global_capabilities: ['security_officer'] })

const ROWS = [
  {
    id: 812,
    created_at: '2026-10-02T17:04:11',
    request_id: '4f0c9a',
    actor_type: 'admin',
    admin_id: 3,
    admin_username: 'ana',
    api_token_id: null,
    action: 'gateway_user.access_set',
    target_type: 'user',
    target_id: 9,
    server_id: null,
    touched_engine: false,
    status: 'success',
    detail: '{"username": "beto", "after": {"role": "owner"}}',
    detail_json: { username: 'beto', after: { role: 'owner' } },
    ip: '10.0.0.4',
    grantee: null,
    privilege: null,
    object_level: null,
    object_name: null,
    with_grant_option: null,
    grantor: null,
  },
  {
    id: 811,
    created_at: '2026-10-02T17:00:00',
    request_id: null,
    actor_type: 'api_token',
    admin_id: null,
    admin_username: 'token:tok_abc',
    api_token_id: 12,
    action: 'mcp.query',
    target_type: null,
    target_id: null,
    server_id: 4,
    touched_engine: true,
    status: 'denied',
    detail: 'texto libre',
    detail_json: null,
    ip: null,
  },
  {
    id: 810,
    created_at: '2026-10-02T16:00:00',
    actor_type: 'system',
    action: 'access.bootstrap_window_closed',
    touched_engine: false,
    status: 'success',
  },
  {
    id: 809,
    created_at: '2026-10-02T15:00:00',
    actor_type: 'anonymous',
    action: 'auth.login_failed',
    touched_engine: false,
    status: 'failure',
  },
]

function page(items: unknown[], total = items.length) {
  return {
    data: items,
    pagination: { page: 1, size: 20, total, pages: 1, has_next: false, has_prev: false },
  }
}

function forbidden() {
  return HttpResponse.json(
    {
      detail: {
        msg: 'Prohibido',
        type: 'AppHttpException',
        public_context: { code: 'access.forbidden' },
      },
    },
    { status: 403 },
  )
}

/** Registra la query de cada `GET /audit-log` para comprobar qué filtros viajaron. */
function mockBackend(me: Record<string, unknown> = OFFICER, items: unknown[] = ROWS) {
  const queries: URLSearchParams[] = []
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ data: me })),
    http.get(`${API}/audit-log`, ({ request }) => {
      queries.push(new URL(request.url).searchParams)
      return HttpResponse.json(page(items))
    }),
    http.get(`${API}/audit-log/:id`, ({ params }) => {
      const row = ROWS.find((item) => String(item.id) === params.id)
      return row
        ? HttpResponse.json({ data: row })
        : HttpResponse.json(
            {
              detail: {
                msg: 'No existe',
                type: 'AppHttpException',
                public_context: { code: 'audit.not_found' },
              },
            },
            { status: 404 },
          )
    }),
  )
  return { queries, last: () => queries[queries.length - 1] }
}

describe('AuditLogPage', () => {
  it('pinta las filas: hora local, acción, actor (token y sistema con palabras), destino y estado', async () => {
    mockBackend()
    renderWithProviders(<AuditLogPage />, { route: '/audit-log' })

    // Cada fila existe dos veces en el DOM (tabla y tarjeta): `DataTable` oculta una por CSS.
    expect((await screen.findAllByText('gateway_user.access_set')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ana').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Token #12').length).toBeGreaterThan(0)
    expect(screen.queryByText('token:tok_abc')).not.toBeInTheDocument()
    expect(screen.getAllByText('Sistema').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Anónimo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Usuario #9').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Éxito').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Denegado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fallo').length).toBeGreaterThan(0)
  })

  it('aplica los filtros como query del backend, con la fecha local pasada a UTC', async () => {
    const backend = mockBackend()
    renderWithProviders(<AuditLogPage />, { route: '/audit-log' })
    await screen.findAllByText('gateway_user.access_set')
    expect(backend.last()?.get('page')).toBe('1')
    expect(backend.last()?.has('action')).toBe(false)

    await userEvent.type(screen.getByLabelText('Acción'), 'gateway_user.*')
    await userEvent.selectOptions(screen.getByLabelText('Tipo de actor'), 'api_token')
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'denied')
    await userEvent.type(screen.getByLabelText('Request ID'), '4f0c9a')
    // `datetime-local` no se tipea carácter a carácter en jsdom: se fija el valor de una vez.
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01T08:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))

    await waitFor(() => expect(backend.last()?.get('action')).toBe('gateway_user.*'))
    const query = backend.last()
    expect(query?.get('actor_type')).toBe('api_token')
    expect(query?.get('status')).toBe('denied')
    expect(query?.get('request_id')).toBe('4f0c9a')
    expect(query?.get('from')).toBe(new Date('2026-10-01T08:00').toISOString())
    expect(query?.get('page')).toBe('1')
  })

  it('un preset aplica el prefijo al toque', async () => {
    const backend = mockBackend()
    renderWithProviders(<AuditLogPage />, { route: '/audit-log' })
    await screen.findAllByText('gateway_user.access_set')

    await userEvent.click(screen.getByRole('button', { name: /Capacidades puntuales/ }))
    await waitFor(() => expect(backend.last()?.get('action')).toBe('capability_grant.*'))
    expect(screen.getByRole('button', { name: /Capacidades puntuales/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('los filtros de la URL viajan desde el primer pedido y rellenan la barra', async () => {
    const backend = mockBackend()
    renderWithProviders(<AuditLogPage />, {
      route: '/audit-log?action=access.*&status=success&target_type=user&target_id=9&page=2',
    })
    await screen.findAllByText('gateway_user.access_set')
    const first = backend.queries[0]
    expect(first?.get('action')).toBe('access.*')
    expect(first?.get('status')).toBe('success')
    expect(first?.get('target_type')).toBe('user')
    expect(first?.get('target_id')).toBe('9')
    expect(first?.get('page')).toBe('2')
    expect(screen.getByLabelText('Acción')).toHaveValue('access.*')
  })

  it('un rango invertido se avisa y no se pide', async () => {
    const backend = mockBackend()
    renderWithProviders(<AuditLogPage />, {
      route: '/audit-log?from=2026-10-02T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
    })
    expect(
      await screen.findByText('«Hasta» tiene que ser posterior a «Desde».'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar filtros' })).toBeDisabled()
    expect(backend.queries).toHaveLength(0)
  })

  it('el detalle muestra detail_json con sangría, plegable, y filtra por su request', async () => {
    const backend = mockBackend()
    renderWithProviders(<AuditLogPage />, { route: '/audit-log' })

    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Ver detalle de la entrada #812' }))[0]!,
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Entrada #812')).toBeInTheDocument()
    const pre = within(dialog).getByText(/"username": "beto"/)
    expect(pre.tagName).toBe('PRE')
    expect(pre.textContent).toBe(
      JSON.stringify({ username: 'beto', after: { role: 'owner' } }, null, 2),
    )
    expect(pre.closest('details')).toHaveAttribute('open')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Ver todo el request' }))
    await waitFor(() => expect(backend.last()?.get('request_id')).toBe('4f0c9a'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('un detail de texto libre se muestra tal cual', async () => {
    mockBackend()
    renderWithProviders(<AuditLogPage />, { route: '/audit-log?entrada=811' })
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('texto libre')).toBeInTheDocument()
    expect(within(dialog).getByText(/tocó el motor/)).toBeInTheDocument()
  })

  it('una entrada que no existe lo dice, sin «Reintentar»', async () => {
    mockBackend()
    renderWithProviders(<AuditLogPage />, { route: '/audit-log?entrada=999' })
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('Esa entrada de auditoría no existe.'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })

  it('sin filtros y sin filas muestra el vacío; con filtros, ofrece limpiarlos', async () => {
    mockBackend(OFFICER, [])
    renderWithProviders(<AuditLogPage />, { route: '/audit-log?status=error' })
    expect(
      (await screen.findAllByText('Ninguna entrada coincide con los filtros')).length,
    ).toBeGreaterThan(0)
    await userEvent.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]!)
    expect((await screen.findAllByText('Todavía no hay entradas')).length).toBeGreaterThan(0)
  })

  it('access_admin sin security_officer ve el 403 compartido y no pide la auditoría', async () => {
    const backend = mockBackend(meFixture({ role: 'owner', global_capabilities: ['access_admin'] }))
    renderWithProviders(<AuditLogPage />, { route: '/audit-log' })
    expect(await screen.findByText('No tenés acceso a la auditoría')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver mi acceso' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(backend.queries).toHaveLength(0)
  })

  it('un 403 del servidor también cae en el estado compartido', async () => {
    mockBackend()
    server.use(http.get(`${API}/audit-log`, () => forbidden()))
    renderWithProviders(<AuditLogPage />, { route: '/audit-log' })
    expect(await screen.findByText('No tenés acceso a la auditoría')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })
})
