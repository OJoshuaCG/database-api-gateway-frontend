import { describe, expect, it } from 'vitest'
import type { ModelDatabaseStatus } from '@/lib/contracts'
import { pendingAdoptionOfVersion } from './version-adoption'

function database(overrides: Partial<ModelDatabaseStatus> = {}): ModelDatabaseStatus {
  return {
    id: 1,
    name: 'app_prod',
    server_id: 1,
    owner_id: 1,
    model_id: 3,
    model_version: '0001',
    environment_id: 10,
    status: 'active',
    pending_count: 0,
    pending_versions: [],
    has_partial_application: false,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

describe('pendingAdoptionOfVersion', () => {
  it('cuenta pendientes leyendo `pending_versions`, sin derivar nada de `model_version`', () => {
    const adoption = pendingAdoptionOfVersion('0007', [
      database({ id: 1, pending_versions: ['0007', '0008'] }),
      database({ id: 2, pending_versions: ['0008'] }),
      database({ id: 3, pending_versions: [] }),
    ])
    expect(adoption.pending).toBe(1)
    expect(adoption.total).toBe(3)
  })

  it('una BD sin `model_version` tiene todo pendiente, y así lo dice el backend', () => {
    const adoption = pendingAdoptionOfVersion('0001', [
      database({ model_version: null, pending_versions: ['0001', '0002'] }),
    ])
    expect(adoption.pending).toBe(1)
  })

  it('NO cuenta como aplicada una BD stampeada: no hay cubo «aplicada»', () => {
    // Es la razón de ser de este módulo. Una base declarada en `0007` por `stamp`, por `adopt` o
    // por el alta puede estar VACÍA. `pending` es lo único que el backend afirma, y una versión que
    // no figura pendiente no es prueba de que su SQL haya corrido.
    const adoption = pendingAdoptionOfVersion('0007', [
      database({ model_version: '0010', pending_versions: [] }),
    ])
    expect(adoption.pending).toBe(0)
    expect(adoption).not.toHaveProperty('applied')
  })

  it('excluye del denominador lo que no está `active`, y lo declara', () => {
    // `GET /database-models/{id}/databases` devuelve todas las filas sin filtrar por estado. Una
    // base registrada sin `CREATE DATABASE` (`pending`), en cuarentena (`error`) o archivada
    // contaminaría el «de M»: no es una base a la que se le pueda aplicar nada.
    const adoption = pendingAdoptionOfVersion('0007', [
      database({ id: 1, status: 'active', pending_versions: ['0007'] }),
      database({ id: 2, status: 'pending', pending_versions: ['0007'] }),
      database({ id: 3, status: 'error', pending_versions: ['0007'] }),
      database({ id: 4, status: 'archived', pending_versions: ['0007'] }),
    ])
    expect(adoption.total).toBe(1)
    expect(adoption.pending).toBe(1)
    expect(adoption.excluded).toBe(3)
  })

  it('agrupa los pendientes por entorno, y solo los entornos que tienen', () => {
    const adoption = pendingAdoptionOfVersion('0007', [
      database({ id: 1, environment_id: 10, pending_versions: ['0007'] }),
      database({ id: 2, environment_id: 10, pending_versions: ['0007'] }),
      database({ id: 3, environment_id: 20, pending_versions: ['0007'] }),
      // Al día: su entorno no aparece en el desglose.
      database({ id: 4, environment_id: 30, pending_versions: [] }),
    ])
    expect(adoption.byEnvironment).toEqual([
      { environmentId: 10, pending: 2 },
      { environmentId: 20, pending: 1 },
    ])
  })

  it('trata la BD sin clasificar como un grupo propio, no la esconde', () => {
    // `environment_id: null` es un valor legítimo y significa SIN protección de política: fundirla
    // con las demás borraría justo el caso que hay que mirar.
    const adoption = pendingAdoptionOfVersion('0007', [
      database({ id: 1, environment_id: null, pending_versions: ['0007'] }),
    ])
    expect(adoption.byEnvironment).toEqual([{ environmentId: null, pending: 1 }])
  })

  it('sin BDs activas no hay nada que contar', () => {
    const adoption = pendingAdoptionOfVersion('0007', [])
    expect(adoption).toEqual({ total: 0, pending: 0, excluded: 0, byEnvironment: [] })
  })
})
