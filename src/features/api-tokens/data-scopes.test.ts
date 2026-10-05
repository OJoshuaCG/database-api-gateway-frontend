import { describe, expect, it } from 'vitest'
import { dataScopesOf } from './data-scopes'

describe('dataScopesOf', () => {
  it('devuelve solo los scopes de datos, en orden', () => {
    expect(dataScopesOf(['blueprints.read', 'data.query', 'data.read'])).toEqual([
      'data.query',
      'data.read',
    ])
    expect(dataScopesOf(['blueprints.read'])).toEqual([])
  })
})
