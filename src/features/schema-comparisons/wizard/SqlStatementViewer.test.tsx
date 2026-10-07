import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import type { SchemaComparisonItemOut } from '@/lib/contracts'
import { SqlStatementViewer } from './SqlStatementViewer'

function item(overrides: Partial<SchemaComparisonItemOut> = {}): SchemaComparisonItemOut {
  return {
    id: 1,
    comparison_id: 9,
    seq: 1,
    object_type: 'view',
    object_name: 'v_top',
    change_type: 'modified',
    phase: 5,
    sql: 'CREATE OR REPLACE VIEW v_top AS SELECT 1',
    risk_flags: {
      destructive: false,
      lock_heavy: false,
      data_conversion: false,
      needs_review: false,
      requires_individual_review: true,
      cross_flavor_warning: false,
      possible_rename_of: null,
    },
    op_group: null,
    depends_on: [],
    down_sql: 'CREATE VIEW v_top AS SELECT 2',
    down_confirmed: true,
    execution_status: null,
    execution_error: null,
    executed_at: null,
    ...overrides,
  }
}

describe('SqlStatementViewer', () => {
  it('con el código a la vista, muestra el DDL y el rollback', () => {
    renderWithProviders(<SqlStatementViewer item={item()} />)
    expect(screen.getByText('DDL a ejecutar en el target')).toBeInTheDocument()
    expect(screen.getByText('Rollback (down_sql)')).toBeInTheDocument()
    expect(screen.queryByText(/Contenido oculto/)).not.toBeInTheDocument()
  })

  it('un ítem redactado muestra el aviso y ningún bloque de código', () => {
    renderWithProviders(
      <SqlStatementViewer item={item({ sql: '', down_sql: '', redacted: true })} />,
    )
    expect(
      screen.getByText('Contenido oculto: tu rol no ve el código de este objeto'),
    ).toBeInTheDocument()
    expect(screen.queryByText('DDL a ejecutar en el target')).not.toBeInTheDocument()
    expect(screen.queryByText('Rollback (down_sql)')).not.toBeInTheDocument()
  })

  it('`redacted: false` explícito se comporta como el backend anterior (sin la marca)', () => {
    renderWithProviders(<SqlStatementViewer item={item({ redacted: false })} />)
    expect(screen.queryByText(/Contenido oculto/)).not.toBeInTheDocument()
  })
})
