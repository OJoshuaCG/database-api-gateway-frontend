import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE } from '@/test/fixtures/authz-catalog'
import { SCOPE_ENFORCEMENT_NOTE } from '../authz-model'
import { EffectiveAccessPanel } from './EffectiveAccessPanel'

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
    expect(screen.getByText('Rol base · operator · 17 capacidades')).toBeInTheDocument()
    expect(screen.getByText('Producción · Permiso de entorno · viewer')).toBeInTheDocument()
    expect(screen.getByText(/Pierde 5:/)).toBeInTheDocument()
    // Sin esta nota el panel prometería una restricción que hoy solo existe en cuatro rutas.
    expect(screen.getByText(SCOPE_ENFORCEMENT_NOTE)).toBeInTheDocument()
  })

  it('un permiso que eleva avisa que hoy rige en todo el gateway fuera de las cuatro rutas', () => {
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
    expect(screen.getByText(/Suma 14:/)).toBeInTheDocument()
    expect(screen.getByText(/en esas otras operaciones tiene el rol/)).toBeInTheDocument()
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
    expect(screen.getByText('Capacidad global · access_admin')).toBeInTheDocument()
    const toggles = screen.getAllByRole('button', { name: 'Ver capacidades' })
    // Base, el permiso y la global: las tres plegadas al empezar.
    expect(toggles).toHaveLength(3)
    const grantToggle = toggles[1]
    if (!grantToggle) throw new Error('falta el botón del permiso')
    expect(grantToggle).toHaveAttribute('aria-expanded', 'false')
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
})
