import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import type { GatewayUserOut } from '@/lib/contracts'
import { SELF_ACCESS_NOTE } from '../self-access'
import { GatewayUserFormModal } from './GatewayUserFormModal'

const user: GatewayUserOut = {
  id: 1,
  username: 'admin',
  email: 'admin@empresa.com',
  full_name: null,
  gateway_role: 'owner',
  is_active: true,
  credential_set: true,
  global_capabilities: ['access_admin'],
  scope_grants: [],
  last_login_at: null,
  previous_login_at: null,
  last_failed_at: null,
  created_at: '2026-08-20T11:00:00Z',
}

function mockActor(role: string) {
  server.use(
    http.get('http://localhost/api/v1/auth/me', () =>
      HttpResponse.json({ data: meFixture({ role, global_capabilities: ['access_admin'] }) }),
    ),
    http.get('http://localhost/api/v1/authz/catalog', () =>
      HttpResponse.json({ data: CATALOG_FIXTURE }),
    ),
  )
}

beforeEach(() => mockActor('owner'))

describe('GatewayUserFormModal — rol base', () => {
  it('resume qué otorga el rol elegido desde el catálogo, sin descripciones escritas a mano', async () => {
    renderWithProviders(<GatewayUserFormModal open onClose={() => undefined} />)
    expect(await screen.findByText(/Otorga 12 de 32/)).toBeInTheDocument()
    // La frase vieja prometía que se podía «acotar o ampliar»: hoy no se cumple en todas las rutas.
    expect(screen.queryByText(/acotar o ampliar/)).not.toBeInTheDocument()
  })

  it('sin techo (C3): ofrece owner aunque quien crea sea operator, marcado como elevación', async () => {
    mockActor('operator')
    renderWithProviders(<GatewayUserFormModal open onClose={() => undefined} />)
    await screen.findByText(/Otorga 12 de 32/)
    expect(screen.queryByText(/Solo podés asignar un rol base hasta/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    expect(screen.getByRole('option', { name: 'operator' })).toBeInTheDocument()
    const owner = screen.getByRole('option', { name: /^owner\s*Requiere segundo aprobador$/ })
    await userEvent.click(owner)
    // Elegido, dice qué va a pasar al crear: nace viewer y la invitación sale igual.
    expect(
      screen.getByText(/La cuenta se crea como viewer y la invitación se emite igual/),
    ).toBeInTheDocument()
  })

  it('en la edición, owner solo se marca si la cuenta no lo es ya', async () => {
    renderWithProviders(
      <GatewayUserFormModal
        open
        user={{ ...user, id: 7, username: 'mlopez', gateway_role: 'operator' }}
        currentUserId={1}
        onClose={() => undefined}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    await userEvent.click(
      await screen.findByRole('option', { name: /^owner\s*Requiere segundo aprobador$/ }),
    )
    expect(screen.getByText(/el rol owner queda pendiente/)).toBeInTheDocument()
  })

  it('sobre una cuenta que ya es owner no marca nada', async () => {
    renderWithProviders(
      <GatewayUserFormModal open user={user} currentUserId={99} onClose={() => undefined} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    expect(await screen.findByRole('option', { name: 'owner' })).toBeInTheDocument()
    expect(screen.queryByText('Requiere segundo aprobador')).not.toBeInTheDocument()
  })
})

describe('GatewayUserFormModal — edición de la propia cuenta', () => {
  it('deshabilita el estado de la cuenta con el motivo a la vista', () => {
    renderWithProviders(
      <GatewayUserFormModal open user={user} currentUserId={1} onClose={() => undefined} />,
    )
    expect(screen.getByRole('switch', { name: 'Cuenta activa' })).toBeDisabled()
    // Una nota por control deshabilitado: rol base y estado.
    expect(screen.getAllByText(SELF_ACCESS_NOTE).length).toBeGreaterThanOrEqual(2)
    // El correo sigue editable: los datos de contacto sí se pueden cambiar sobre uno mismo.
    expect(screen.getByLabelText('Correo')).toBeEnabled()
  })

  it('sobre otra cuenta el estado sigue editable', () => {
    renderWithProviders(
      <GatewayUserFormModal open user={user} currentUserId={99} onClose={() => undefined} />,
    )
    expect(screen.getByRole('switch', { name: 'Cuenta activa' })).toBeEnabled()
    expect(screen.queryByText(SELF_ACCESS_NOTE)).not.toBeInTheDocument()
  })
})

describe('GatewayUserFormModal — separación de funciones', () => {
  const officer: GatewayUserOut = {
    ...user,
    id: 7,
    username: 'mlopez',
    gateway_role: 'viewer',
    global_capabilities: ['security_officer'],
  }

  const SOD_409 = {
    detail: {
      msg: 'Esta combinación de acceso viola la separación de deberes.',
      type: 'AppHttpException',
      public_context: {
        code: 'access.sod_conflict',
        rules: ['owner_security_officer'],
        conflicts: [
          { rule: 'owner_security_officer', sources: [{ kind: 'base_role', role: 'owner' }] },
        ],
        override: { field: 'sod_override', reason_min_length: 20, max_hours: 168 },
      },
    },
  }

  it('avisa al elegir owner y, ante el 409, reenvía el PATCH con `sod_override`', async () => {
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.get('http://localhost/api/v1/authz/sod-report', () =>
        HttpResponse.json({ data: { exceptions: [], uncovered: [] } }),
      ),
      http.patch('http://localhost/api/v1/gateway-users/7', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return body.sod_override
          ? HttpResponse.json({ data: { ...officer, gateway_role: 'owner' } })
          : HttpResponse.json(SOD_409, { status: 409 })
      }),
    )
    const closed: string[] = []
    renderWithProviders(
      <GatewayUserFormModal
        open
        user={officer}
        currentUserId={1}
        onClose={() => closed.push('cerrado')}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    await userEvent.click(await screen.findByRole('option', { name: /^owner/ }))
    expect(await screen.findByText('Este rol viola la separación de funciones')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(
      await screen.findByText('El servidor rechazó el cambio: separación de funciones'),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/rol base owner/).length).toBeGreaterThan(0)

    await userEvent.click(screen.getByText('Excepción de emergencia'))
    await userEvent.type(
      screen.getByLabelText(/^Motivo/),
      'Incidente 4711: no hay otro security_officer',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Guardar con excepción de emergencia' }),
    )

    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[0]).not.toHaveProperty('sod_override')
    expect(bodies[1]).toMatchObject({
      gateway_role: 'owner',
      sod_override: {
        reason: 'Incidente 4711: no hay otro security_officer',
        expires_in_hours: 168,
      },
    })
    await expect.poll(() => closed).toEqual(['cerrado'])
  })
})
