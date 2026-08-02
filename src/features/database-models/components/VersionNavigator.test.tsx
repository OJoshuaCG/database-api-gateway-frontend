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
    renderNavigator(null)
    expect(screen.getByRole('button', { name: 'Versión siguiente' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Versión anterior' })).toBeEnabled()
  })

  it('en la más antigua no se puede retroceder', () => {
    renderNavigator('0001')
    expect(screen.getByRole('button', { name: 'Versión anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Versión siguiente' })).toBeEnabled()
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

  it('avisa cuando el backend tiene más versiones de las cargadas', () => {
    const sorted = sortVersionsAscending(RAW)
    renderWithProviders(
      <VersionNavigator sorted={sorted} index={2} onSelect={vi.fn()} total={120} />,
    )
    expect(screen.getByText('· 120 versión(es) en total')).toBeInTheDocument()
  })
})
