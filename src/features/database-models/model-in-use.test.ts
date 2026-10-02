import { describe, expect, it } from 'vitest'
import { normalizeApiError } from '@/lib/api/errors'
import { modelInUseText } from './model-in-use'

/** El 409 de `DELETE /database-models/{id}` tal como lo arma `database_model_controller.py`. */
function inUse(count: number | undefined, names: string[]) {
  return normalizeApiError(409, {
    detail: {
      msg: `No se puede eliminar el blueprint: ${count} base(s) de datos gestionada(s) lo usan.`,
      type: 'AppHttpException',
      public_context: {
        code: 'database_model.in_use',
        ...(count === undefined ? {} : { managed_database_count: count }),
        blocking_databases: names.map((name, index) => ({ id: index + 1, name })),
      },
    },
  })
}

describe('modelInUseText', () => {
  it('extrae las bases {id, name} del public_context', () => {
    const error = inUse(2, ['ventas', 'compras'])
    expect(error.databaseModelContext?.inUseDatabases).toEqual([
      { id: 1, name: 'ventas' },
      { id: 2, name: 'compras' },
    ])
    expect(error.databaseModelContext?.managedDatabaseCount).toBe(2)
  })

  it('una base: singular, con su nombre', () => {
    expect(modelInUseText(inUse(1, ['ventas']))).toBe(
      'No se puede eliminar: lo usa la base gestionada «ventas». Desasociala o eliminala primero.',
    )
  })

  it('varias: plural, con todos los nombres', () => {
    expect(modelInUseText(inUse(3, ['a', 'b', 'c']))).toBe(
      'No se puede eliminar: lo usan 3 bases gestionadas: «a», «b» y «c». Desasocialas o eliminalas primero.',
    )
  })

  it('muchas: lista las primeras cinco y resume el resto', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(modelInUseText(inUse(7, names))).toBe(
      'No se puede eliminar: lo usan 7 bases gestionadas: «a», «b», «c», «d», «e» y 2 más. Desasocialas o eliminalas primero.',
    )
  })

  it('sin conteo cuenta las filas; sin filas, usa el conteo', () => {
    expect(modelInUseText(inUse(undefined, ['a', 'b']))).toContain('lo usan 2 bases gestionadas')
    expect(modelInUseText(inUse(4, []))).toBe(
      'No se puede eliminar: lo usan 4 bases gestionadas. Desasocialas o eliminalas primero.',
    )
  })

  it('no clasifica otros errores, ni por el texto del mensaje', () => {
    const other = normalizeApiError(409, {
      detail: {
        msg: 'No se puede eliminar el blueprint: lo usan.',
        type: 'AppHttpException',
        public_context: { code: 'database_model.slug_in_use', managed_database_count: 2 },
      },
    })
    expect(modelInUseText(other)).toBeNull()
  })
})
