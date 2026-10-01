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
    // El título no repite la procedencia: ya la dice el badge de al lado.
    expect(screen.getByText('operator · 17 capacidades')).toBeInTheDocument()
    expect(screen.getByText('Producción · viewer')).toBeInTheDocument()
    expect(screen.getByText('Permiso de entorno')).toBeInTheDocument()
    // «Pierde 5» sin más exageraría: de las cinco, hoy solo se recorta `databases.write`.
    const lost = screen.getByText(/Pierde 5:/)
    expect(lost).toHaveTextContent(
      '(hoy solo se aplica a: Crear y editar bases gestionadas; el resto todavía no).',
    )
    // Solo recorta: la nota es informativa, no una alerta.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    // Escalada real por encima del base: el aviso sube a `warning` (que se anuncia como alerta).
    expect(screen.getByRole('alert')).toHaveTextContent(SCOPE_ENFORCEMENT_NOTE)
    // Suma destructivas: la marca no depende solo del color (WCAG 1.4.1).
    expect(screen.getByText('Incluye destructivas')).toBeInTheDocument()
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
    expect(screen.getByText('access_admin')).toBeInTheDocument()
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

  it('con parte de lo perdido fuera de la capa 2, nombra solo lo que hoy se recorta', () => {
    renderWithProviders(
      <EffectiveAccessPanel
        mode="admin"
        baseRole="owner"
        globalCapabilities={[]}
        grants={[{ scopeType: 'server', scopeId: 9, role: 'operator', targetLabel: 'db-01' }]}
        catalog={CATALOG_FIXTURE}
      />,
    )
    // owner → operator pierde `databases.drop` y `blueprints.apply` (capa 2) y otras que no.
    const lost = screen.getByText(/Pierde \d+:/)
    expect(lost).toHaveTextContent(/hoy solo se aplica a: .*Borrar bases de datos/)
    expect(lost).toHaveTextContent('; el resto todavía no).')
    expect(screen.getByText('Incluye destructivas')).toBeInTheDocument()
  })
})
