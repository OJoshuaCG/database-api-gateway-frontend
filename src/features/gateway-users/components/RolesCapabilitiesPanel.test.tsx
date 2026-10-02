import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CATALOG_FIXTURE, meFixture } from '@/test/fixtures/authz-catalog'
import { RolesCapabilitiesPanel } from './RolesCapabilitiesPanel'

function mockSession(me: Record<string, unknown> = meFixture()) {
  server.use(
    http.get('http://localhost/api/v1/auth/me', () => HttpResponse.json({ data: me })),
    http.get('http://localhost/api/v1/authz/catalog', () =>
      HttpResponse.json({ data: CATALOG_FIXTURE }),
    ),
  )
}

describe('RolesCapabilitiesPanel', () => {
  it('pinta una tarjeta por rol con su cuenta, leída del catálogo', async () => {
    mockSession()
    renderWithProviders(<RolesCapabilitiesPanel />)
    expect(await screen.findByText('Otorga 12 de 32')).toBeInTheDocument()
    // operator: 16, sin `collation.execute` desde que es solo de `owner` (backend c5edee5).
    expect(screen.getByText('Otorga 16 de 32')).toBeInTheDocument()
    // owner: 27, con `engine_users.credentials` (elegir una contraseña del motor divulga).
    expect(screen.getByText('Otorga 27 de 32')).toBeInTheDocument()
    // Una línea de intención por rol y por global, de `ROLE_PURPOSES`.
    expect(screen.getByText('Consulta sin cambiar nada.')).toBeInTheDocument()
    expect(
      screen.getByText('Opera todo en su alcance, incluido lo destructivo.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Administración de accesos')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Administra servidores, catálogos, entornos, el acceso de agentes y el cifrado.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Capacidades globales (se suman a cualquier rol)')).toBeInTheDocument()
    expect(screen.getByText('32 de 32 capacidades')).toBeInTheDocument()
    // Plurales sin «(s)»: viewer no tiene ninguna destructiva.
    expect(screen.getAllByText('0 destructivas').length).toBeGreaterThan(0)
    // Las siete destructivas son de owner; operator ya no tiene ninguna (tenía `collation.execute`).
    expect(screen.getByText('7 destructivas')).toBeInTheDocument()
    expect(screen.queryByText('1 destructiva')).not.toBeInTheDocument()
    expect(screen.queryByText(/\(s\)|\(es\)/)).not.toBeInTheDocument()
    // Una sección por módulo, con su encabezado.
    expect(screen.getByRole('heading', { name: 'Consola SQL' })).toBeInTheDocument()
  })

  it('«Solo destructivas» deja solo esas y esconde los módulos vacíos', async () => {
    mockSession()
    renderWithProviders(<RolesCapabilitiesPanel />)
    await screen.findByText('Otorga 12 de 32')
    await userEvent.click(screen.getByLabelText('Solo destructivas'))
    expect(screen.getByText('7 de 32 capacidades')).toBeInTheDocument()
    // El conteo también va en una región viva, para quien filtra sin ver la pantalla.
    expect(screen.getByText('7 de 32 capacidades coinciden')).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('heading', { name: 'Entornos' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Consola SQL' })).toBeInTheDocument()
    // Un clon puede vaciar el destino (clean_mode), así que su ejecución también es destructiva.
    expect(screen.getByRole('heading', { name: 'Clones' })).toBeInTheDocument()
  })

  it('la búsqueda filtra por id', async () => {
    mockSession()
    renderWithProviders(<RolesCapabilitiesPanel />)
    await screen.findByText('Otorga 12 de 32')
    await userEvent.type(screen.getByLabelText('Buscar capacidad'), 'exports.download')
    expect(screen.getByText('1 de 32 capacidades')).toBeInTheDocument()
    const section = screen.getByRole('heading', { name: 'Exportaciones' }).closest('section')
    if (!section) throw new Error('falta la sección')
    expect(within(section).getAllByText('exports.download').length).toBeGreaterThan(0)
  })

  it('elegir un rol colapsa las columnas en «¿La otorga <rol>?»', async () => {
    mockSession()
    renderWithProviders(<RolesCapabilitiesPanel />)
    await screen.findByText('Otorga 12 de 32')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    await userEvent.click(screen.getByRole('option', { name: 'operator' }))
    expect(
      screen.getAllByRole('columnheader', { name: '¿La otorga operator?' }).length,
    ).toBeGreaterThan(0)
  })

  it('todas las secciones comparten los mismos anchos de columna (una sola matriz, sin escalera)', async () => {
    mockSession()
    const { container } = renderWithProviders(<RolesCapabilitiesPanel />)
    await screen.findByText('Otorga 12 de 32')
    const widthsOf = (colgroup: Element) =>
      Array.from(colgroup.querySelectorAll('col')).map((col) => (col as HTMLElement).style.width)

    const colgroups = Array.from(container.querySelectorAll('colgroup'))
    // Una tabla por módulo, y todas con anchos fijos: el ancho ya no sale del contenido.
    expect(colgroups.length).toBeGreaterThan(1)
    const first = widthsOf(colgroups[0] as Element)
    // Capacidad (resto), Alcance y las cinco columnas de rol y global, repartidas por igual.
    expect(first).toEqual(['', '14%', '9.2%', '9.2%', '9.2%', '9.2%', '9.2%'])
    for (const colgroup of colgroups) expect(widthsOf(colgroup)).toEqual(first)
    for (const table of container.querySelectorAll('table')) {
      expect(table).toHaveClass('table-fixed')
    }

    // Con un rol elegido queda una sola columna, y sigue igual en todas las secciones.
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    await userEvent.click(screen.getByRole('option', { name: 'operator' }))
    const filtered = Array.from(container.querySelectorAll('colgroup')).map(widthsOf)
    expect(filtered[0]).toEqual(['', '14%', '20%'])
    for (const widths of filtered) expect(widths).toEqual(filtered[0])
  })

  it('con un backend sin catálogo lo dice en vez de quedarse cargando', async () => {
    mockSession({ id: 1, username: 'admin', role: 'owner' })
    renderWithProviders(<RolesCapabilitiesPanel />)
    expect(
      await screen.findByText(
        'Este backend no publica el catálogo de capacidades. Actualizalo para ver qué otorga cada rol.',
      ),
    ).toBeInTheDocument()
  })

  describe('en pantallas estrechas', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('arranca filtrado por el primer rol: una sola columna en vez de cinco', async () => {
      vi.stubGlobal(
        'matchMedia',
        (query: string) =>
          ({
            matches: query === '(max-width: 47.99rem)',
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }) as unknown as MediaQueryList,
      )
      mockSession()
      renderWithProviders(<RolesCapabilitiesPanel />)
      await screen.findByText('Otorga 12 de 32')
      expect(
        screen.getAllByRole('columnheader', { name: '¿La otorga viewer?' }).length,
      ).toBeGreaterThan(0)
    })
  })
})
