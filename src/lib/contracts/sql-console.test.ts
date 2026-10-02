import { describe, expect, it } from 'vitest'
import { queryHistoryOutSchema } from '.'

const entry = {
  id: 501,
  server_id: 7,
  database_name: 'ventas',
  engine: 'mysql',
  admin_username: 'admin',
  connection_mode: 'stored',
  run_as_username: 'app_rw',
  impersonated_role: null,
  sql_text: 'SELECT * FROM clientes WHERE id = ?',
  danger_level: 'read',
  statement_count: 1,
  status: 'success',
  read_only: true,
  dry_run: false,
  committed: false,
  rows_returned: 1,
  rows_affected: 0,
  duration_ms: 4,
  error_code: null,
  error_message: null,
  created_at: '2026-10-01T10:00:00Z',
}

describe('queryHistoryOutSchema', () => {
  it('sin `sql_masked` (backend anterior al campo) lo toma como `false`', () => {
    expect(queryHistoryOutSchema.parse(entry).sql_masked).toBe(false)
  })

  it('respeta `sql_masked: true` cuando el backend lo envía', () => {
    expect(queryHistoryOutSchema.parse({ ...entry, sql_masked: true }).sql_masked).toBe(true)
  })
})
