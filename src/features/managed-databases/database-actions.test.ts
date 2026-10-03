import { describe, expect, it } from 'vitest'
import {
  allowsEngineDropOnRemove,
  DATABASE_ACTION_LABELS,
  DESTRUCTIVE_ACTIONS,
  DOMAIN_ACTIONS,
  getDatabaseActions,
  resolveDatabaseState,
  type DatabaseActionId,
  type DatabaseActionSurface,
  type DatabaseState,
} from './database-actions'

const STATES: DatabaseState[] = [
  'managed-active',
  'managed-unprovisioned',
  'managed-error',
  'managed-missing',
  'managed-archived',
  'managed-archived-unlisted',
  'unmanaged',
  'unresolved',
]
const SURFACES: DatabaseActionSurface[] = ['inventory', 'physical', 'detail']
const ROW_SURFACES: DatabaseActionSurface[] = ['inventory', 'physical']
const ALL_CAPS = { canDropFromEngine: true }
const NO_DROP = { canDropFromEngine: false }

describe('getDatabaseActions', () => {
  describe('gestionada activa', () => {
    it('en la fila del inventario, la destructiva es «Quitar del inventario»', () => {
      expect(getDatabaseActions('managed-active', 'inventory', ALL_CAPS)).toEqual([
        'edit',
        'reassign',
        'agent-access',
        'migrations',
        'compare',
        'clone',
        'export',
        'remove-from-inventory',
      ])
    })

    it('en la fila física, la destructiva es «Eliminar del motor»', () => {
      expect(getDatabaseActions('managed-active', 'physical', ALL_CAPS)).toEqual([
        'edit',
        'reassign',
        'agent-access',
        'migrations',
        'compare',
        'clone',
        'export',
        'drop-from-engine',
      ])
    })

    it('la ficha tiene las dos destructivas, cada una con su consecuencia', () => {
      expect(getDatabaseActions('managed-active', 'detail', ALL_CAPS)).toEqual([
        'edit',
        'reassign',
        'agent-access',
        'migrations',
        'compare',
        'clone',
        'export',
        'remove-from-inventory',
        'drop-from-engine',
      ])
    })

    it('sin `databases.drop` no ofrece el DROP en ningún sitio', () => {
      for (const surface of SURFACES) {
        expect(getDatabaseActions('managed-active', surface, NO_DROP)).not.toContain(
          'drop-from-engine',
        )
      }
    })
  })

  describe('gestionada sin aprovisionar', () => {
    it('ofrece aprovisionar primero y nada que requiera que exista en el motor', () => {
      for (const surface of SURFACES) {
        expect(getDatabaseActions('managed-unprovisioned', surface, ALL_CAPS)).toEqual([
          'provision',
          'edit',
          'reassign',
          'agent-access',
          'remove-from-inventory',
        ])
      }
    })
  })

  describe('gestionada en error sin saber si existe (fila del inventario)', () => {
    it('ofrece Migraciones —la salida de la cuarentena— y no Aprovisionar', () => {
      for (const surface of SURFACES) {
        const actions = getDatabaseActions('managed-error', surface, ALL_CAPS)
        expect(actions).toEqual([
          'edit',
          'reassign',
          'agent-access',
          'migrations',
          'remove-from-inventory',
        ])
        expect(actions).not.toContain('provision')
      }
    })
  })

  describe('gestionada archivada', () => {
    it('presente en el motor: editar, exportar y quitar del inventario, nada que el backend rechace', () => {
      for (const surface of SURFACES) {
        expect(getDatabaseActions('managed-archived', surface, ALL_CAPS)).toEqual([
          'edit',
          'export',
          'remove-from-inventory',
        ])
      }
    })

    it('fuera del motor (o sin saberlo): sin exportar ni recrear', () => {
      for (const surface of SURFACES) {
        expect(getDatabaseActions('managed-archived-unlisted', surface, ALL_CAPS)).toEqual([
          'edit',
          'remove-from-inventory',
        ])
      }
    })
  })

  describe('gestionada desaparecida del motor', () => {
    it('ofrece recrearla y, como sin aprovisionar, nada que dependa del motor', () => {
      for (const surface of SURFACES) {
        expect(getDatabaseActions('managed-missing', surface, ALL_CAPS)).toEqual([
          'recreate',
          'edit',
          'reassign',
          'agent-access',
          'remove-from-inventory',
        ])
      }
    })
  })

  describe('no gestionada', () => {
    it('ofrece adoptar, exportar y eliminar del motor', () => {
      for (const surface of SURFACES) {
        expect(getDatabaseActions('unmanaged', surface, ALL_CAPS)).toEqual([
          'adopt',
          'export',
          'drop-from-engine',
        ])
      }
    })

    it('sin `databases.drop` queda en adoptar y exportar', () => {
      expect(getDatabaseActions('unmanaged', 'physical', NO_DROP)).toEqual(['adopt', 'export'])
    })
  })

  describe('inventario sin resolver', () => {
    it('no ofrece adoptar ni nada del inventario: todavía no se sabe si está registrada', () => {
      for (const surface of SURFACES) {
        expect(getDatabaseActions('unresolved', surface, ALL_CAPS)).toEqual([
          'export',
          'drop-from-engine',
        ])
      }
    })
  })

  describe('invariantes de todas las combinaciones', () => {
    const combos = STATES.flatMap((state) =>
      SURFACES.flatMap((surface) => [ALL_CAPS, NO_DROP].map((caps) => ({ state, surface, caps }))),
    )

    it.each(combos)(
      'R5: $state × $surface no produce dos destructivas con la misma etiqueta',
      ({ state, surface, caps }) => {
        const labels = getDatabaseActions(state, surface, caps)
          .filter((action) => DESTRUCTIVE_ACTIONS.has(action))
          .map((action) => DATABASE_ACTION_LABELS[action])
        expect(new Set(labels).size).toBe(labels.length)
      },
    )

    it.each(combos)(
      'orden: $state × $surface pone el dominio primero y la destructiva al final',
      ({ state, surface, caps }) => {
        const actions = getDatabaseActions(state, surface, caps)
        const rank = (action: DatabaseActionId) =>
          DOMAIN_ACTIONS.has(action) ? 0 : DESTRUCTIVE_ACTIONS.has(action) ? 2 : 1
        const ranks = actions.map(rank)
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
      },
    )

    it.each(combos)('$state × $surface no repite acciones', ({ state, surface, caps }) => {
      const actions = getDatabaseActions(state, surface, caps)
      expect(new Set(actions).size).toBe(actions.length)
    })

    it.each(
      STATES.flatMap((state) =>
        ROW_SURFACES.flatMap((surface) =>
          [ALL_CAPS, NO_DROP].map((caps) => ({ state, surface, caps })),
        ),
      ),
    )(
      'R1: toda acción de la fila $surface en $state está también en la ficha',
      ({ state, surface, caps }) => {
        const detail = getDatabaseActions(state, 'detail', caps)
        for (const action of getDatabaseActions(state, surface, caps)) {
          expect(detail).toContain(action)
        }
      },
    )

    it.each(
      STATES.flatMap((state) =>
        ROW_SURFACES.flatMap((surface) =>
          [ALL_CAPS, NO_DROP].map((caps) => ({ state, surface, caps })),
        ),
      ),
    )(
      'una fila ($surface, $state) tiene como mucho una destructiva',
      ({ state, surface, caps }) => {
        const destructive = getDatabaseActions(state, surface, caps).filter((action) =>
          DESTRUCTIVE_ACTIONS.has(action),
        )
        expect(destructive.length).toBeLessThanOrEqual(1)
      },
    )

    it('las dos destructivas tienen etiquetas distintas entre sí', () => {
      expect(DATABASE_ACTION_LABELS['remove-from-inventory']).not.toBe(
        DATABASE_ACTION_LABELS['drop-from-engine'],
      )
    })
  })
})

describe('allowsEngineDropOnRemove', () => {
  it('solo la fila del inventario de una base activa ofrece el DROP dentro de «Quitar»', () => {
    for (const state of STATES) {
      for (const surface of SURFACES) {
        expect(allowsEngineDropOnRemove(state, surface)).toBe(
          state === 'managed-active' && surface === 'inventory',
        )
      }
    }
  })
})

describe('resolveDatabaseState', () => {
  it('sin registro y con el inventario cargado es no gestionada', () => {
    expect(resolveDatabaseState({ managed: null, inventoryKnown: true, presence: 'present' })).toBe(
      'unmanaged',
    )
  })

  it('sin registro y con el inventario pendiente o caído es sin resolver', () => {
    expect(
      resolveDatabaseState({ managed: null, inventoryKnown: false, presence: 'present' }),
    ).toBe('unresolved')
  })

  it('pending ausente o desconocida es sin aprovisionar, no desaparecida', () => {
    for (const presence of ['absent', 'unknown'] as const) {
      expect(
        resolveDatabaseState({ managed: { status: 'pending' }, inventoryKnown: true, presence }),
      ).toBe('managed-unprovisioned')
    }
  })

  it('error que el motor confirma ausente es sin aprovisionar (el alta falló)', () => {
    expect(
      resolveDatabaseState({
        managed: { status: 'error' },
        inventoryKnown: true,
        presence: 'absent',
      }),
    ).toBe('managed-unprovisioned')
  })

  it('error con presencia desconocida NO supone ausencia: puede ser una cuarentena', () => {
    expect(
      resolveDatabaseState({
        managed: { status: 'error' },
        inventoryKnown: true,
        presence: 'unknown',
      }),
    ).toBe('managed-error')
  })

  it('error presente en el motor (cuarentena, vista desde la ficha) es activa', () => {
    expect(
      resolveDatabaseState({
        managed: { status: 'error' },
        inventoryKnown: true,
        presence: 'present',
      }),
    ).toBe('managed-active')
  })

  it('archivada va antes que la presencia: presente no la vuelve activa', () => {
    expect(
      resolveDatabaseState({
        managed: { status: 'archived' },
        inventoryKnown: true,
        presence: 'present',
      }),
    ).toBe('managed-archived')
    for (const presence of ['absent', 'unknown'] as const) {
      expect(
        resolveDatabaseState({ managed: { status: 'archived' }, inventoryKnown: true, presence }),
      ).toBe('managed-archived-unlisted')
    }
  })

  it('activa ausente del motor es desaparecida', () => {
    expect(
      resolveDatabaseState({
        managed: { status: 'active' },
        inventoryKnown: true,
        presence: 'absent',
      }),
    ).toBe('managed-missing')
  })

  it('si el motor la lista es activa aunque el registro diga pending', () => {
    expect(
      resolveDatabaseState({
        managed: { status: 'pending' },
        inventoryKnown: true,
        presence: 'present',
      }),
    ).toBe('managed-active')
  })

  it('en el inventario (presencia desconocida) una activa se asume presente', () => {
    expect(
      resolveDatabaseState({
        managed: { status: 'active' },
        inventoryKnown: true,
        presence: 'unknown',
      }),
    ).toBe('managed-active')
  })
})
