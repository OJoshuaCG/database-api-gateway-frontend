import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from './auth'
import {
  resolvedSelectionAddedItemSchema,
  schemaComparisonItemOutSchema,
} from './schema-comparisons'
import { dumpStatementSchema, structureDumpSchema } from './snapshot'

describe('capacidad schema.definitions', () => {
  it('existe con el valor del catálogo y no se confunde con el scope del MCP', () => {
    expect(CAPABILITIES.schemaDefinitions).toBe('schema.definitions')
    expect(CAPABILITIES.dataDefinitions).toBe('data.definitions')
    expect(CAPABILITIES.schemaDefinitions).not.toBe(CAPABILITIES.dataDefinitions)
  })
})

describe('dumpStatementSchema.redacted', () => {
  const base = { object_type: 'view', name: 'v_top', ddl: '' }

  it('es opcional: un backend anterior no lo manda y el contrato sigue valiendo', () => {
    const parsed = dumpStatementSchema.parse(base)
    expect(parsed.redacted).toBeUndefined()
    expect(parsed.redacted === true).toBe(false)
  })

  it('respeta true y false', () => {
    expect(dumpStatementSchema.parse({ ...base, redacted: true }).redacted).toBe(true)
    expect(dumpStatementSchema.parse({ ...base, redacted: false }).redacted).toBe(false)
  })

  it('llega dentro del dump completo', () => {
    const dump = structureDumpSchema.parse({
      database: 'legacy',
      source_engine: 'mysql',
      has_non_portable: false,
      statements: [
        { object_type: 'table', name: 'clientes', ddl: 'CREATE TABLE clientes (id INT)' },
        { object_type: 'routine', name: 'sp_x', ddl: '', redacted: true },
      ],
    })
    expect(dump.statements.map((statement) => statement.redacted === true)).toEqual([false, true])
  })
})

describe('schemaComparisonItemOutSchema.redacted', () => {
  const item = {
    id: 1,
    comparison_id: 2,
    seq: 1,
    object_type: 'routine',
    object_name: 'PROCEDURE:sp_x',
    change_type: 'new',
    phase: 5,
    sql: '',
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
    down_sql: null,
    down_confirmed: false,
    execution_status: null,
    execution_error: null,
    executed_at: null,
  }

  it('es opcional y respeta la marca del servidor', () => {
    expect(schemaComparisonItemOutSchema.parse(item).redacted).toBeUndefined()
    expect(schemaComparisonItemOutSchema.parse({ ...item, redacted: true }).redacted).toBe(true)
  })

  it('el ítem agregado por dependencia también la lleva', () => {
    const parsed = resolvedSelectionAddedItemSchema.parse({
      item_id: 3,
      object_type: 'routine',
      object_name: 'PROCEDURE:sp_x',
      change_type: 'new',
      sql: '',
      redacted: true,
    })
    expect(parsed.redacted).toBe(true)
  })
})
