import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { effectiveAccessSchema } from '@/lib/contracts'
import {
  CATALOG_FIXTURE,
  GRANTS_CATALOG_FIXTURE,
  environmentFixture,
  pageOf,
} from '@/test/fixtures/authz-catalog'
import { SCOPE_ENFORCEMENT_NOTE, effectiveAccessRowId } from '../authz-model'
import {
  EffectiveAccessPanel,
  type EffectiveAccessGrant,
  type ServerAccessState,
} from './EffectiveAccessPanel'

// Con un permiso de entorno el panel pide los entornos para nombrar el más protegido.
beforeEach(() => {
  server.use(
    http.get('http://localhost/api/v1/environments', () =>
      HttpResponse.json(
        pageOf([environmentFixture(1, 'Desarrollo', 0), environmentFixture(3, 'Producción', 2)]),
      ),
    ),
  )
})

describe('EffectiveAccessPanel', () => {
  it('una fila por permiso con lo que pierde respecto del base, y la nota honesta', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="operator"
        globalCapabilities={[]}
        grants={[
          { scopeType: 'environment', scopeId: 3, role: 'viewer', targetLabel: 'Producción' },
        ]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    // El título no repite la procedencia: ya la dice el badge de al lado.
    expect(screen.getByText('operator · 16 capacidades')).toBeInTheDocument()
    expect(screen.getByText('Producción · viewer')).toBeInTheDocument()
    expect(screen.getByText('Permiso de entorno')).toBeInTheDocument()
    // Todo lo que pierde un rol por debajo del base es de capa 2: se recorta de verdad, sin salvedad.
    const lost = screen.getByText(/Pierde 4:/)
    expect(lost).not.toHaveTextContent('no se recorta')
    expect(lost).not.toHaveTextContent('el resto no')
    // Solo recorta: la nota es informativa, no una alerta.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Sin esta nota el panel prometería un recorte que lecturas y globales no tienen.
    expect(screen.getByText(SCOPE_ENFORCEMENT_NOTE)).toBeInTheDocument()
  })

  it('un permiso que eleva avisa que hoy rige en todo el gateway en lo que no se recorta por alcance', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="viewer"
        globalCapabilities={[]}
        grants={[
          { scopeType: 'environment', scopeId: 1, role: 'owner', targetLabel: 'Desarrollo' },
        ]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    expect(screen.getByText(/Suma 15:/)).toBeInTheDocument()
    expect(
      screen.getByText(
        /en esas otras operaciones \(lecturas y capacidades globales\) tiene el rol/,
      ),
    ).toBeInTheDocument()
    // Escalada real por encima del base: el aviso sube a `warning` (que se anuncia como alerta).
    expect(screen.getByRole('alert')).toHaveTextContent(SCOPE_ENFORCEMENT_NOTE)
    // Suma destructivas: la marca no depende solo del color (WCAG 1.4.1), y va en rojo.
    expect(screen.getByText('Suma destructivas')).toBeInTheDocument()
    expect(screen.getByText(/Suma 15:/)).toHaveClass('text-error')
  })

  it('el cruce entorno × servidor dice que rige el más restrictivo', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="operator"
        globalCapabilities={[]}
        grants={[
          { scopeType: 'environment', scopeId: 3, role: 'owner', targetLabel: 'Producción' },
          { scopeType: 'server', scopeId: 9, role: 'viewer', targetLabel: 'db-prod-01' },
        ]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    expect(
      screen.getByText(/Donde se cruzan Producción y db-prod-01 rige el más restrictivo/),
    ).toBeInTheDocument()
  })

  it('«Ver capacidades» despliega la lista y lo perdido va bajo «Pierde»', async () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="operator"
        globalCapabilities={['access_admin']}
        grants={[{ scopeType: 'server', scopeId: 9, role: 'viewer', targetLabel: 'db-01' }]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    expect(screen.getByText('Administración de accesos · access_admin')).toBeInTheDocument()
    expect(screen.getByText('Capacidad global')).toBeInTheDocument()
    const toggles = screen.getAllByRole('button', { name: /^Ver capacidades de / })
    // Base, el permiso y la global: las tres plegadas al empezar.
    expect(toggles).toHaveLength(3)
    const grantToggle = toggles[1]
    if (!grantToggle) throw new Error('falta el botón del permiso')
    // Cada botón se distingue por su fila, y su región existe aunque esté plegada.
    expect(grantToggle).toHaveAccessibleName('Ver capacidades de db-01 · viewer')
    expect(grantToggle).toHaveAttribute('aria-expanded', 'false')
    const regionId = grantToggle.getAttribute('aria-controls') ?? ''
    expect(document.getElementById(regionId)).not.toBeNull()
    expect(document.getElementById(regionId)).not.toBeVisible()
    await userEvent.click(grantToggle)
    expect(grantToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Pierde')).toBeInTheDocument()
  })

  it('en modo propio sin permisos lo dice con voseo y ofrece a quién pedir más', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="self"
        baseRole="viewer"
        globalCapabilities={[]}
        grants={[]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    expect(screen.getByText(/en todo el gateway, sin permisos por alcance/)).toBeInTheDocument()
    expect(
      screen.getByText('Si necesitás más acceso, pedíselo a quien administra los accesos.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(SCOPE_ENFORCEMENT_NOTE)).not.toBeInTheDocument()
  })

  it('lo perdido de capa 2 no lleva salvedad y quitar destructivas no es una escalada', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="owner"
        globalCapabilities={[]}
        grants={[{ scopeType: 'server', scopeId: 9, role: 'operator', targetLabel: 'db-01' }]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    // owner → operator pierde `databases.drop`, `blueprints.apply` y otras: todas de capa 2.
    const lost = screen.getByText(/Pierde \d+:/)
    expect(lost).toHaveTextContent(/Borrar bases de datos/)
    expect(lost).not.toHaveTextContent('el resto no')
    // Quitar destructivas es un recorte: marca neutra, no la alarma de una escalada.
    expect(screen.getByText('Quita destructivas')).toBeInTheDocument()
    expect(screen.queryByText('Suma destructivas')).not.toBeInTheDocument()
  })

  it('con permisos de entorno, la fila base nombra el entorno al que caen las bases sin clasificar', async () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="operator"
        globalCapabilities={[]}
        grants={[
          { scopeType: 'environment', scopeId: 1, role: 'viewer', targetLabel: 'Desarrollo' },
        ]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    expect(
      await screen.findByText(
        /una base sin entorno no cae acá, cuenta como el entorno más protegido \(«Producción»\)/,
      ),
    ).toBeInTheDocument()
  })

  it('cada fila de permiso tiene un id estable por destino, para enlazarla', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        idPrefix="acceso"
        baseRole="operator"
        globalCapabilities={[]}
        grants={[{ scopeType: 'server', scopeId: 9, role: 'viewer', targetLabel: 'db-01' }]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    const row = document.getElementById(effectiveAccessRowId('acceso', 'server', 9))
    expect(row).toHaveTextContent('db-01 · viewer')
  })

  it('lo desplegado sigue al destino, no a la posición, cuando se quita un permiso de arriba', async () => {
    const first: EffectiveAccessGrant = {
      scopeType: 'server',
      scopeId: 9,
      role: 'viewer',
      targetLabel: 'db-01',
    }
    const second: EffectiveAccessGrant = {
      scopeType: 'server',
      scopeId: 4,
      role: 'owner',
      targetLabel: 'db-02',
    }
    const panel = (grants: EffectiveAccessGrant[]) => (
      <EffectiveAccessPanel
        mode="admin"
        baseRole="operator"
        globalCapabilities={[]}
        grants={grants}
        catalog={CATALOG_FIXTURE}
      />
    )
    const { rerender } = renderWithProviders(panel([first, second]))
    await userEvent.click(screen.getByRole('button', { name: 'Ver capacidades de db-01 · viewer' }))
    rerender(panel([second]))
    // db-02 ocupa ahora la posición de db-01, pero no hereda su despliegue.
    expect(
      screen.getByRole('button', { name: 'Ver capacidades de db-02 · owner' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })
})

/** Respuesta de `effective-access` (forma de `tests/test_effective_access.py` del backend). */
function serverState(
  overrides: Partial<Parameters<typeof effectiveAccessSchema.parse>[0]> = {},
  state: Partial<ServerAccessState> = {},
): ServerAccessState {
  return {
    data: effectiveAccessSchema.parse({
      user_id: 7,
      username: 'destino',
      active: true,
      base_role: 'viewer',
      scope_roles: [
        { scope_type: 'environment', scope_id: 3, scope_name: 'Producción', role: 'viewer' },
      ],
      global_capabilities: ['access_admin'],
      capabilities: [
        { capability: 'databases.read', source: 'role' },
        {
          capability: 'databases.read',
          source: 'scoped_role',
          scope_type: 'environment',
          scope_id: 3,
          scope_name: 'Producción',
        },
        { capability: 'access.admin', source: 'global' },
        {
          capability: 'blueprints.apply',
          source: 'capability_grant',
          scope_type: 'environment',
          scope_id: 3,
          scope_name: 'Producción',
          grant_id: 5,
        },
        {
          capability: 'blueprints.read',
          source: 'capability_grant',
          scope_type: 'environment',
          scope_id: 3,
          scope_name: 'Producción',
          grant_id: 5,
          implied_by: 'blueprints.apply',
        },
      ],
      catalog_version: 'v1',
      ...overrides,
    }),
    isLoading: false,
    isError: false,
    ...state,
  }
}

describe('EffectiveAccessPanel — lo que rige hoy según el servidor', () => {
  const baseProps = {
    mode: 'admin' as const,
    baseRole: 'viewer',
    globalCapabilities: ['access_admin'],
    grants: [
      { scopeType: 'environment', scopeId: 3, role: 'viewer', targetLabel: 'Producción' },
    ] satisfies EffectiveAccessGrant[],
    catalog: GRANTS_CATALOG_FIXTURE,
  }

  it('una fila por fuente, rotulada: por rol, rol por alcance, global y puntual con su alcance', () => {
    renderWithProviders(<EffectiveAccessPanel {...baseProps} serverAccess={serverState()} />)
    expect(screen.getByText('Por rol')).toBeInTheDocument()
    expect(screen.getByText('Rol por alcance')).toBeInTheDocument()
    expect(screen.getByText('Global')).toBeInTheDocument()
    expect(screen.getByText('Capacidad puntual')).toBeInTheDocument()
    expect(screen.getByText('viewer · 1 capacidades')).toBeInTheDocument()
    expect(screen.getByText('Producción · viewer')).toBeInTheDocument()
    expect(
      screen.getByText('Aplicar y revertir versiones sobre bases reales · Producción'),
    ).toBeInTheDocument()
    // La lectura implícita se nombra en la fila, y no como una capacidad más que alguien le dio.
    expect(
      screen.getByText(/Trae implícita la lectura: Ver blueprints y sus versiones/),
    ).toBeInTheDocument()
    // Sin cambios: ninguna vista previa ni título extra.
    expect(screen.queryByText('Vista previa: así quedaría al guardar')).not.toBeInTheDocument()
    expect(screen.queryByText('Rige hoy')).not.toBeInTheDocument()
    // La nota honesta va como texto (no como un segundo aviso).
    expect(screen.getByText(SCOPE_ENFORCEMENT_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('al desplegar la puntual, la lectura implícita dice de cuál viene', async () => {
    renderWithProviders(<EffectiveAccessPanel {...baseProps} serverAccess={serverState()} />)
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Ver capacidades de Aplicar y revertir versiones sobre bases reales · Producción',
      }),
    )
    expect(
      screen.getByText('lectura implícita de «Aplicar y revertir versiones sobre bases reales»'),
    ).toBeInTheDocument()
  })

  it('una puntual de una persona desactivada sale «Inactiva» y sin efecto', () => {
    const base = serverState()
    const inert = serverState({
      active: false,
      capabilities: (base.data?.capabilities ?? []).map((row) =>
        row.source === 'capability_grant' ? { ...row, inert: true } : row,
      ),
    })
    renderWithProviders(<EffectiveAccessPanel {...baseProps} serverAccess={inert} />)
    expect(screen.getByText('Inactiva')).toBeInTheDocument()
    expect(screen.getByText('Sin efecto mientras la cuenta esté desactivada.')).toBeInTheDocument()
    expect(screen.getByText(/La cuenta está desactivada/)).toBeInTheDocument()
  })

  it('con cambios sin guardar suma la vista previa rotulada y conserva lo del servidor', () => {
    renderWithProviders(
      <EffectiveAccessPanel {...baseProps} serverAccess={serverState()} hasUnsavedChanges />,
    )
    expect(
      screen.getByRole('heading', { name: 'Vista previa: así quedaría al guardar' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/todavía no rige/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rige hoy' })).toBeInTheDocument()
    // Lo del servidor sigue, y la vista previa trae la puntual que el servidor ya tiene.
    expect(screen.getByText('Rol por alcance')).toBeInTheDocument()
    expect(
      screen.getAllByText('Aplicar y revertir versiones sobre bases reales · Producción'),
    ).toHaveLength(2)
  })

  it('sin cambios las filas de permiso llevan el id enlazable; con cambios, solo la vista previa', () => {
    const { rerender } = renderWithProviders(
      <EffectiveAccessPanel {...baseProps} idPrefix="acceso" serverAccess={serverState()} />,
    )
    const id = effectiveAccessRowId('acceso', 'environment', 3)
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1)
    rerender(
      <EffectiveAccessPanel
        {...baseProps}
        idPrefix="acceso"
        serverAccess={serverState()}
        hasUnsavedChanges
      />,
    )
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1)
  })

  it('cargando y con error lo dice, y el error ofrece «Reintentar»', async () => {
    const onRetry = vi.fn()
    const { rerender } = renderWithProviders(
      <EffectiveAccessPanel
        {...baseProps}
        serverAccess={{ data: undefined, isLoading: true, isError: false }}
      />,
    )
    expect(screen.getByText('Cargando el acceso efectivo…')).toBeInTheDocument()
    rerender(
      <EffectiveAccessPanel
        {...baseProps}
        serverAccess={{ data: undefined, isLoading: false, isError: true, onRetry }}
      />,
    )
    expect(screen.getByText(/No se pudo leer el acceso efectivo/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('EffectiveAccessPanel — cálculo del navegador con capacidades puntuales', () => {
  it('una puntual activa suma una fila «Capacidad puntual» con su lectura implícita', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="viewer"
        globalCapabilities={[]}
        grants={[]}
        capabilityGrants={[
          {
            capability: 'sql_console.execute',
            scopeType: 'server',
            scopeId: 9,
            grantId: 4,
            targetLabel: 'db-01',
          },
        ]}
        catalog={GRANTS_CATALOG_FIXTURE}
      />,
    )
    expect(screen.getByText('Capacidad puntual')).toBeInTheDocument()
    expect(screen.getByText('Ejecutar SQL ad-hoc contra un motor · db-01')).toBeInTheDocument()
    expect(
      screen.getByText(/Trae implícita la lectura: Ver el historial de la consola SQL/),
    ).toBeInTheDocument()
  })

  it('una pendiente no suma fila: en «Mi acceso» se nombra aparte, sin conceder nada', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="self"
        baseRole="viewer"
        globalCapabilities={[]}
        grants={[]}
        capabilityGrants={[
          {
            capability: 'exports.download',
            scopeType: 'environment',
            scopeId: 3,
            status: 'pending',
          },
        ]}
        catalog={GRANTS_CATALOG_FIXTURE}
      />,
    )
    expect(screen.queryByText('Capacidad puntual')).not.toBeInTheDocument()
    expect(
      screen.getByText(/Tenés 1 solicitud de capacidad puntual pendiente de aprobación/),
    ).toHaveTextContent('No conceden nada hasta que otra persona las apruebe')
  })

  it('con un catálogo anterior (nada otorgable) no inventa filas puntuales', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="viewer"
        globalCapabilities={[]}
        grants={[]}
        capabilityGrants={[
          { capability: 'blueprints.apply', scopeType: 'environment', scopeId: 3 },
        ]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    expect(screen.queryByText('Capacidad puntual')).not.toBeInTheDocument()
  })
})
