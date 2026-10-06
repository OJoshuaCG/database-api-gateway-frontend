import { describe, expect, it } from 'vitest'
import { dataScopesOf, hasDefinitionsScope, rowScopesOf } from './data-scopes'

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
