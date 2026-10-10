import { describe, expect, it } from 'vitest'
import { API_TOKEN_DATA_SCOPES, hasDataScope } from './api-tokens'
import { CAPABILITIES } from './auth'
import { dataCredentialOutSchema } from './managed-databases'

describe('dataCredentialOutSchema', () => {
  it('un backend que no manda los campos del opt-in los lee CERRADOS', () => {
    const parsed = dataCredentialOutSchema.parse({
      managed_database_id: 7,
      has_data_credential: true,
    })
    expect(parsed.data_access_allowed).toBe(false)
    expect(parsed.data_access_state).toBe('closed')
    expect(parsed.data_access_second_approver_required).toBe(true)
    expect(parsed.verified_at).toBeNull()
    expect(parsed.probe_violations).toEqual([])
  })

  it('rechaza un estado de opt-in fuera del vocabulario', () => {
    expect(() =>
      dataCredentialOutSchema.parse({
        managed_database_id: 7,
        has_data_credential: true,
        data_access_state: 'maybe',
      }),
    ).toThrow()
  })

  it('no declara usuario ni contraseña: lo que el backend manda de más se descarta', () => {
    const parsed = dataCredentialOutSchema.parse({
      managed_database_id: 7,
      has_data_credential: true,
      username: 'mcp_d_7',
      password: 'secreto',
    })
    expect(parsed).not.toHaveProperty('username')
    expect(parsed).not.toHaveProperty('password')
  })
})

describe('scopes de datos', () => {
  it('los cuatro scopes de datos están en el vocabulario de capacidades', () => {
    expect(CAPABILITIES.dataRead).toBe('data.read')
    expect(CAPABILITIES.dataQuery).toBe('data.query')
    expect(CAPABILITIES.dataDefinitions).toBe('data.definitions')
    expect(CAPABILITIES.dataBlueprintSql).toBe('data.blueprint_sql')
    expect([...API_TOKEN_DATA_SCOPES]).toEqual([
      'data.read',
      'data.query',
      'data.definitions',
      'data.blueprint_sql',
    ])
  })

  it('hasDataScope detecta cualquiera de los cuatro y nada más', () => {
    expect(hasDataScope(['blueprints.read', 'data.query'])).toBe(true)
    expect(hasDataScope(['data.read'])).toBe(true)
    expect(hasDataScope(['data.definitions'])).toBe(true)
    expect(hasDataScope(['data.blueprint_sql'])).toBe(true)
    expect(hasDataScope(['blueprints.read', 'databases.read'])).toBe(false)
    expect(hasDataScope([])).toBe(false)
  })
})
