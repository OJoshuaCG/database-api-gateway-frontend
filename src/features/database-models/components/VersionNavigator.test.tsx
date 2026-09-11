import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { resolveVersionIndex, sortVersionsAscending } from '../version-nav'
import { VersionNavigator, type VersionPageMeta } from './VersionNavigator'

function migration(version: string, id: number, isLatest = false): ModelMigrationSummary {
  return {
    id,
    model_id: 1,
    version,
    name: `paso ${version}`,
    has_mysql_override: false,
    has_postgresql_override: false,
    has_rollback: false,
    kind: 'schema',
    is_baseline: false,
    reviewed: true,
    capture_selects: false,
    is_latest: isLatest,
    sql_frozen: false,
    deletable: true,
    delete_requires_stamps: false,
    has_seed: false,
    forced_collations: [],
    destructive: false,
    sql_diverged: false,
    checksum: `sha-${id}`,
    created_at: '2026-07-01T10:00:00Z',
  }
}

/** El backend no garantiza el orden: se entrega desordenado a propósito. */
const RAW = [migration('0002', 2), migration('0010', 10, true), migration('0001', 1)]

/** Una sola página: `pages: 1` oculta el paginador y las flechas marcan los extremos reales. */
const SINGLE_PAGE: VersionPageMeta = { page: 1, pages: 1, total: 3, size: 50 }

function renderNavigator(
  selectedVersion: string | null,
  pagination: VersionPageMeta = SINGLE_PAGE,
  raw: ModelMigrationSummary[] = RAW,
) {
  const onSelect = vi.fn()
  const onCrossPage = vi.fn()
  const onPageChange = vi.fn()
  const sorted = sortVersionsAscending(raw)
  const index = resolveVersionIndex(sorted, selectedVersion)
  renderWithProviders(
    <VersionNavigator
      sorted={sorted}
      index={index}
      onSelect={onSelect}
      pagination={pagination}
      onPageChange={onPageChange}
      onSizeChange={vi.fn()}
      onCrossPage={onCrossPage}
    />,
  )
  return { onSelect, onCrossPage, onPageChange }
}

describe('VersionNavigator', () => {
  it('sin selección arranca en la versión MÁS RECIENTE', () => {
    renderNavigator(null)
    expect(screen.getByDisplayValue('0010 · paso 0010')).toBeInTheDocument()
    expect(screen.getByText('3 de 3')).toBeInTheDocument()
    expect(screen.getByText('más reciente')).toBeInTheDocument()
  })

  it('en la más reciente no se puede avanzar', () => {
    // `aria-disabled` y NO `disabled`: un botón enfocado que se deshabilita pierde el foco —cae a
    // `<body>` y el siguiente Tab reinicia el documento—, y con estas flechas como navegación
    // principal eso se nota en cada recorrido hasta el extremo.
    renderNavigator(null)
    expect(screen.getByRole('button', { name: 'Versión siguiente' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Versión anterior' })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
  })

  it('en el extremo la flecha no navega, aunque siga siendo enfocable', async () => {
    const user = userEvent.setup()
    const { onSelect, onCrossPage } = renderNavigator(null)
    await user.click(screen.getByRole('button', { name: 'Versión siguiente' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCrossPage).not.toHaveBeenCalled()
  })

  it('en la más antigua no se puede retroceder', () => {
    renderNavigator('0001')
    expect(screen.getByRole('button', { name: 'Versión anterior' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText('1 de 3')).toBeInTheDocument()
    expect(screen.queryByText('más reciente')).not.toBeInTheDocument()
  })

  it('la flecha de retroceder salta a la versión inmediatamente anterior', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderNavigator('0010')
    await user.click(screen.getByRole('button', { name: 'Versión anterior' }))
    expect(onSelect).toHaveBeenCalledWith('0002')
  })

  it('la flecha de avanzar respeta el orden NUMÉRICO, no el del backend', async () => {
    const user = userEvent.setup()
    // Desde '0002' la siguiente es '0010' aunque como texto '0010' ordenaría antes que '0002'.
    const { onSelect } = renderNavigator('0002')
    await user.click(screen.getByRole('button', { name: 'Versión siguiente' }))
    expect(onSelect).toHaveBeenCalledWith('0010')
  })

  it('anuncia la versión ENTERA con su estado, no solo la posición', () => {
    // La región live decía «3 de 12» y nada más: quien navega con lector de pantalla pulsaba la
    // flecha y no se enteraba ni de qué versión ni de si estaba sin rollback.
    renderNavigator(null)
    expect(
      screen.getByText(/Versión 0010, paso 0010\. sin rollback\. Posición 3 de 3\./),
    ).toBeInTheDocument()
  })

  it('el desplegable pinta «sin rollback», que antes no existía en ninguna vista', async () => {
    const user = userEvent.setup()
    renderNavigator(null)
    await user.click(screen.getByRole('button', { name: 'Abrir lista' }))
    expect(screen.getAllByText('sin rollback').length).toBeGreaterThan(0)
  })

  // ─── Catálogo paginado ────────────────────────────────────────────────────
  //
  // Antes de esto el catálogo se pedía en una sola página y, si el blueprint tenía más versiones
  // que el tope, se avisaba del recorte y ya: no había forma de llegar a las que faltaban. Estos
  // tests fijan que ahora sí la hay.

  it('con una sola página no pinta el paginador', () => {
    renderNavigator(null)
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument()
  })

  it('con varias páginas pinta el paginador y el total del catálogo entero', () => {
    renderNavigator(null, { page: 2, pages: 2, total: 53, size: 50 })
    expect(screen.getByText(/Página 2 de 2 · 53 resultados/)).toBeInTheDocument()
    // El contador de posición aclara que es dentro de la página, no del catálogo.
    expect(screen.getByText('3 de 3 en esta página')).toBeInTheDocument()
  })

  it('en el borde de la página la flecha CRUZA en vez de morir', async () => {
    const user = userEvent.setup()
    // Página 2 de 2 (las más recientes en números de pantalla): hacia atrás hay página contigua.
    const { onCrossPage, onSelect } = renderNavigator('0001', {
      page: 2,
      pages: 2,
      total: 53,
      size: 50,
    })
    const back = screen.getByRole('button', { name: 'Versión anterior' })
    expect(back).toHaveAttribute('aria-disabled', 'false')
    await user.click(back)
    expect(onCrossPage).toHaveBeenCalledWith('older')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('en el extremo REAL del catálogo la flecha sigue apagada', () => {
    // Página 1 de 2: por debajo de la más antigua de esta página ya no hay nada.
    renderNavigator('0001', { page: 1, pages: 2, total: 53, size: 50 })
    expect(screen.getByRole('button', { name: 'Versión anterior' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('la insignia «más reciente» sale del backend, no de la posición en la lista', () => {
    // En una página que no contiene la punta, el último ítem NO es la versión más reciente del
    // blueprint. Deducirlo de la posición era el bug: afirmaba «más reciente» sobre una versión
    // intermedia, justo al lado de la ficha que ofrece borrar.
    const sinPunta = [migration('0001', 1), migration('0002', 2)]
    renderNavigator(null, { page: 1, pages: 2, total: 53, size: 50 }, sinPunta)
    expect(screen.getByDisplayValue('0002 · paso 0002')).toBeInTheDocument()
    expect(screen.queryByText('más reciente')).not.toBeInTheDocument()
  })
})
