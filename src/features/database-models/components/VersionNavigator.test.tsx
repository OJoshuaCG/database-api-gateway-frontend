import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { resolveVersionIndex, sortVersionsAscending } from '../version-nav'
import { VersionNavigator } from './VersionNavigator'

function migration(version: string, id: number): ModelMigrationSummary {
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
const RAW = [migration('0002', 2), migration('0010', 10), migration('0001', 1)]

function renderNavigator(selectedVersion: string | null) {
  const onSelect = vi.fn()
  const sorted = sortVersionsAscending(RAW)
  const index = resolveVersionIndex(sorted, selectedVersion)
  renderWithProviders(
    <VersionNavigator sorted={sorted} index={index} onSelect={onSelect} total={sorted.length} />,
  )
  return { onSelect }
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
    const { onSelect } = renderNavigator(null)
    await user.click(screen.getByRole('button', { name: 'Versión siguiente' }))
    expect(onSelect).not.toHaveBeenCalled()
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

  it('con el catálogo recortado avisa y RETIRA la afirmación de «más reciente»', () => {
    // Si el backend tiene 120 versiones y solo llegaron 3, la punta real puede no estar entre
    // ellas: afirmar «más reciente» al lado de la ficha que ofrece borrar sería inventar.
    const sorted = sortVersionsAscending(RAW)
    renderWithProviders(
      <VersionNavigator sorted={sorted} index={2} onSelect={vi.fn()} total={120} />,
    )
    expect(screen.getByText('Se cargaron 3 de 120 versiones')).toBeInTheDocument()
    expect(screen.queryByText('más reciente')).not.toBeInTheDocument()
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
})
