import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { VersionsTable } from './VersionsTable'

function version(overrides: Partial<ModelMigrationSummary> = {}): ModelMigrationSummary {
  return {
    id: 1,
    model_id: 3,
    version: '0001',
    name: 'Esquema inicial',
    has_mysql_override: false,
    has_postgresql_override: false,
    has_rollback: true,
    kind: 'schema',
    is_baseline: false,
    reviewed: true,
    capture_selects: false,
    sql_frozen: false,
    deletable: true,
    has_seed: false,
    forced_collations: [],
    destructive: false,
    checksum: 'sha-1',
    created_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

function render(versions: ModelMigrationSummary[], onSelect = vi.fn()) {
  renderWithProviders(
    <VersionsTable versions={versions} selectedVersion={null} onSelect={onSelect} />,
  )
  return onSelect
}

/**
 * `DataTable` renderiza los DOS árboles a la vez —tabla en `≥md` y una tarjeta por fila por
 * debajo— y CSS decide cuál se ve. En jsdom no hay media queries, así que todo elemento
 * aparece duplicado: hay que consultar en plural.
 */
function badge(pattern: RegExp | string) {
  return screen.getAllByText(pattern)[0]
}

describe('VersionsTable', () => {
  it('marca la siembra de datos', () => {
    render([version({ has_seed: true })])
    expect(badge(/siembra/)).toBeInTheDocument()
  })

  it('marca un COLLATE forzado y lo nombra en el tooltip', () => {
    render([version({ forced_collations: ['utf8mb4_bin'] })])
    const marca = badge(/collate/)
    expect(marca).toBeInTheDocument()
    expect(marca).toHaveAttribute('title', 'utf8mb4_bin')
  })

  it('marca las sentencias destructivas', () => {
    render([version({ destructive: true })])
    expect(badge(/destructiva/)).toBeInTheDocument()
  })

  it('marca la captura de resultados de SELECT', () => {
    render([version({ capture_selects: true })])
    expect(badge(/captura/)).toBeInTheDocument()
  })

  it('una versión sin nada de eso no pinta ninguna de esas insignias', () => {
    render([version()])
    expect(screen.queryAllByText(/siembra/)).toHaveLength(0)
    expect(screen.queryAllByText(/collate/)).toHaveLength(0)
    expect(screen.queryAllByText(/destructiva/)).toHaveLength(0)
    expect(screen.queryAllByText(/captura/)).toHaveLength(0)
  })

  it('avisa cuando NO hay rollback: un rollback que la atraviese fallaría con 409', () => {
    render([version({ has_rollback: false })])
    expect(badge('sin rollback')).toBeInTheDocument()
  })

  it('muestra que el SQL está congelado', () => {
    render([version({ sql_frozen: true })])
    expect(badge('SQL congelado')).toBeInTheDocument()
  })

  it('al pedir el detalle avisa con la versión, no con el índice de fila', async () => {
    const user = userEvent.setup()
    const onSelect = render([version({ version: '0007' })])
    await user.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]!)
    expect(onSelect).toHaveBeenCalledWith('0007')
  })
})
