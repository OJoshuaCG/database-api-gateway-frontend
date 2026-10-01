import { describe, expect, it } from 'vitest'
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
    expect(await screen.findByText('Otorga 12 de 29')).toBeInTheDocument()
    expect(screen.getByText('Otorga 17 de 29')).toBeInTheDocument()
    expect(screen.getByText('Otorga 26 de 29')).toBeInTheDocument()
    expect(screen.getByText('Capacidades globales (se suman a cualquier rol)')).toBeInTheDocument()
    expect(screen.getByText('29 de 29 capacidades')).toBeInTheDocument()
    // Una sección por módulo, con su encabezado.
    expect(screen.getByRole('heading', { name: 'Consola SQL' })).toBeInTheDocument()
  })

  it('«Solo destructivas» deja solo esas y esconde los módulos vacíos', async () => {
    mockSession()
    renderWithProviders(<RolesCapabilitiesPanel />)
    await screen.findByText('Otorga 12 de 29')
    await userEvent.click(screen.getByLabelText('Solo destructivas'))
    expect(screen.getByText('6 de 29 capacidades')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Entornos' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Consola SQL' })).toBeInTheDocument()
  })

  it('la búsqueda filtra por id', async () => {
    mockSession()
    renderWithProviders(<RolesCapabilitiesPanel />)
    await screen.findByText('Otorga 12 de 29')
    await userEvent.type(screen.getByLabelText('Buscar capacidad'), 'exports.download')
    expect(screen.getByText('1 de 29 capacidades')).toBeInTheDocument()
    const section = screen.getByRole('heading', { name: 'Exportaciones' }).closest('section')
    if (!section) throw new Error('falta la sección')
    expect(within(section).getAllByText('exports.download').length).toBeGreaterThan(0)
  })

  it('elegir un rol colapsa las columnas en «¿La otorga?»', async () => {
    mockSession()
    renderWithProviders(<RolesCapabilitiesPanel />)
    await screen.findByText('Otorga 12 de 29')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir lista' }))
    await userEvent.click(screen.getByRole('option', { name: 'operator' }))
    expect(screen.getAllByRole('columnheader', { name: '¿La otorga?' }).length).toBeGreaterThan(0)
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
})
