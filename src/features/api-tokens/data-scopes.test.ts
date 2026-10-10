import { describe, expect, it } from 'vitest'
import { dataScopesOf, hasBlueprintSqlScope, hasDefinitionsScope, rowScopesOf } from './data-scopes'

describe('dataScopesOf', () => {
  it('devuelve solo los scopes de datos, en orden', () => {
    expect(dataScopesOf(['blueprints.read', 'data.query', 'data.read'])).toEqual([
      'data.query',
      'data.read',
    ])
    expect(dataScopesOf(['blueprints.read'])).toEqual([])
  })

  it('data.definitions es un scope de datos', () => {
    expect(dataScopesOf(['blueprints.read', 'data.definitions'])).toEqual(['data.definitions'])
  })

  it('data.blueprint_sql es un scope de datos, aunque blueprints.read no lo sea', () => {
    expect(dataScopesOf(['blueprints.read', 'data.blueprint_sql'])).toEqual(['data.blueprint_sql'])
  })
})

describe('rowScopesOf / hasDefinitionsScope', () => {
  it('separa los scopes que leen filas del que lee código', () => {
    const scopes = ['data.read', 'data.definitions', 'blueprints.read', 'data.query']
    expect(rowScopesOf(scopes)).toEqual(['data.read', 'data.query'])
    expect(hasDefinitionsScope(scopes)).toBe(true)
  })

  it('sin data.definitions no hay aviso de código', () => {
    expect(rowScopesOf(['data.definitions'])).toEqual([])
    expect(hasDefinitionsScope(['data.read', 'data.query'])).toBe(false)
  })
})

describe('rowScopesOf / hasBlueprintSqlScope', () => {
  it('data.blueprint_sql no cuenta como scope de filas: no promete lectura de filas', () => {
    const scopes = ['data.read', 'data.blueprint_sql', 'data.definitions', 'data.query']
    expect(rowScopesOf(scopes)).toEqual(['data.read', 'data.query'])
    expect(rowScopesOf(['data.blueprint_sql'])).toEqual([])
    expect(hasBlueprintSqlScope(scopes)).toBe(true)
  })

  it('sin data.blueprint_sql no hay aviso de SQL de blueprints', () => {
    expect(hasBlueprintSqlScope(['data.read', 'data.query', 'data.definitions'])).toBe(false)
    expect(hasBlueprintSqlScope(['blueprints.read'])).toBe(false)
    expect(hasBlueprintSqlScope([])).toBe(false)
  })
})
