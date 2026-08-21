import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { MigrationValidationPanel } from './MigrationValidationPanel'

const VALIDATE = 'http://localhost/api/v1/database-models/3/migrations/validate'

function result(overrides: Record<string, unknown> = {}) {
  return {
    statements: [
      { seq: 0, sql: 'ALTER TABLE t ADD COLUMN c INT', kind: 'alter', danger: 'ddl', reasons: [] },
    ],
    has_seed: false,
    forced_collations: [],
    forced_charsets: [],
    destructive_statements: [],
    parse_errors: [],
    gateway_internal_tables: [],
    postgresql_blockers: [],
    resumable: true,
    referenced_tables: ['t'],
    checked_database: null,
    missing_tables: [],
    catalog_error: null,
    blueprint_collation: null,
    collation_conflicts: [],
    ...overrides,
  }
}

async function validate(
  overrides: Record<string, unknown> = {},
  upSql = 'ALTER TABLE t ADD c INT',
) {
  server.use(http.post(VALIDATE, () => HttpResponse.json({ data: result(overrides) })))
  const user = userEvent.setup()
  renderWithProviders(<MigrationValidationPanel modelId={3} upSql={upSql} />)
  await user.click(screen.getByRole('button', { name: 'Validar' }))
}

describe('MigrationValidationPanel', () => {
  it('no deja validar sin SQL', () => {
    renderWithProviders(<MigrationValidationPanel modelId={3} upSql="   " />)
    expect(screen.getByRole('button', { name: 'Validar' })).toBeDisabled()
  })

  it('dice que no hay problemas cuando el SQL está limpio', async () => {
    await validate()
    expect(await screen.findByText('Sin problemas')).toBeInTheDocument()
  })

  it('muestra el error de sintaxis con su mensaje, que es el producto', async () => {
    await validate({
      parse_errors: [{ seq: 0, message: 'Expected table name. Line 1, Col: 14.' }],
    })
    expect(await screen.findByText(/Sentencia #1 no parsea/)).toBeInTheDocument()
    expect(screen.getByText(/Line 1, Col: 14/)).toBeInTheDocument()
  })

  it('avisa de las tablas que no existen en la BD comprobada', async () => {
    await validate({ checked_database: 'app_prod', missing_tables: ['clientes'] })
    // Es el caso que ningún análisis estático detecta: un ALTER sobre una tabla inexistente
    // es sintácticamente impecable.
    expect(await screen.findByText(/no existen en app_prod/)).toBeInTheDocument()
    expect(screen.getByText(/clientes/)).toBeInTheDocument()
  })

  it('el catálogo inaccesible no borra el análisis estático', async () => {
    await validate({ checked_database: 'app_prod', catalog_error: 'motor inalcanzable' })
    expect(await screen.findByText(/No se pudo leer el catálogo/)).toBeInTheDocument()
    // El veredicto del análisis sigue estando.
    expect(screen.getByText('Sin problemas')).toBeInTheDocument()
  })

  it('avisa de que no se traduce a PostgreSQL antes de aplicar', async () => {
    await validate({ postgresql_blockers: ['MODIFY COLUMN sin equivalente'] })
    expect(await screen.findByText(/No se traduce con certeza a PostgreSQL/)).toBeInTheDocument()
    expect(screen.getByText(/MODIFY COLUMN sin equivalente/)).toBeInTheDocument()
  })

  it('señala el COLLATE que difiere del declarado por el blueprint', async () => {
    await validate({
      forced_collations: ['utf8mb4_bin'],
      blueprint_collation: 'utf8mb4_unicode_ci',
      collation_conflicts: ['utf8mb4_bin'],
    })
    expect(await screen.findByText(/utf8mb4_unicode_ci/)).toBeInTheDocument()
  })

  it('marca la siembra y las sentencias destructivas', async () => {
    await validate({ has_seed: true, destructive_statements: [0] })
    expect(await screen.findByText(/siembra datos/)).toBeInTheDocument()
    expect(screen.getByText(/sentencia\(s\) destructiva\(s\)/)).toBeInTheDocument()
  })
})
