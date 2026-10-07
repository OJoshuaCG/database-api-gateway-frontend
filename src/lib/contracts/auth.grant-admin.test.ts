import { describe, expect, it } from 'vitest'
import { CAPABILITIES, CAPABILITY_ESCALATIONS, DESTRUCTIVE_CAPABILITIES } from './auth'

describe('capacidad engine_users.grant_admin', () => {
  it('existe con el valor del catálogo del backend', () => {
    expect(CAPABILITIES.engineUsersGrantAdmin).toBe('engine_users.grant_admin')
  })

  it('no es destructiva: delegar privilegios no borra nada', () => {
    expect(DESTRUCTIVE_CAPABILITIES).not.toContain(CAPABILITIES.engineUsersGrantAdmin)
  })

  it('los grants que delegan la exigen, y el reassign-owner con provision suma databases.drop', () => {
    expect(CAPABILITY_ESCALATIONS.grantWithGrantOption).toBe(CAPABILITIES.engineUsersGrantAdmin)
    expect(CAPABILITY_ESCALATIONS.grantSensitivePrivilege).toBe(CAPABILITIES.engineUsersGrantAdmin)
    expect(CAPABILITY_ESCALATIONS.reassignOwnerProvision).toEqual([
      CAPABILITIES.databasesDrop,
      CAPABILITIES.engineUsersGrantAdmin,
    ])
  })
})
