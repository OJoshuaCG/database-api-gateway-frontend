import { describe, expect, it } from 'vitest'
import type { EngineUserIdentity, GroupedEngineUser } from '@/lib/contracts'
import {
  ACTION_LABELS,
  DESTRUCTIVE_IDENTITY_ACTIONS,
  engineUserAccessNote,
  identityActions,
  liveHostsOf,
  rowIdentityActions,
  usernameActions,
} from './engine-user-actions'

const identity = (overrides: Partial<EngineUserIdentity> = {}): EngineUserIdentity => ({
  host: '%',
  status: 'adopted',
  server_user_id: 7,
  has_password: true,
  is_active: true,
  notes: null,
  ...overrides,
})

const user = (identities: EngineUserIdentity[]): GroupedEngineUser => ({
  username: 'app',
  identity_count: identities.length,
  identities,
})

const ids = (list: { id: string }[]) => list.map((item) => item.id)

const ALL_STATES: EngineUserIdentity[] = [
  identity(),
  identity({ has_password: false }),
  identity({ server_user_id: null }),
  identity({ status: 'unmanaged', server_user_id: null }),
  identity({ status: 'orphan' }),
  identity({ status: 'orphan', server_user_id: null }),
]

describe('identityActions', () => {
  it('una adoptada ofrece las dos destructivas, cada una con su consecuencia', () => {
    expect(ids(identityActions(identity()))).toEqual([
      'viewGrants',
      'reveal',
      'rotatePassword',
      'edit',
      'removeFromInventory',
      'dropFromEngine',
    ])
  })

  it('solo ofrece «Revelar» si el gateway conoce la contraseña', () => {
    expect(ids(identityActions(identity({ has_password: false })))).not.toContain('reveal')
  })

  it('sin registro de inventario no hay nada que editar ni que quitar', () => {
    const result = ids(identityActions(identity({ server_user_id: null })))
    expect(result).not.toContain('edit')
    expect(result).not.toContain('removeFromInventory')
  })

  it('una sin adoptar se puede adoptar pero no quitar del inventario', () => {
    expect(ids(identityActions(identity({ status: 'unmanaged', server_user_id: null })))).toEqual([
      'adopt',
      'viewGrants',
      'rotatePassword',
      'dropFromEngine',
    ])
  })

  it('una huérfana no se elimina del motor: ya no existe en él', () => {
    const result = ids(identityActions(identity({ status: 'orphan' })))
    expect(result).toEqual(['recreate', 'edit', 'viewGrants', 'removeFromInventory'])
    expect(result).not.toContain('dropFromEngine')
    expect(result).not.toContain('rotatePassword')
  })

  it('quitar una huérfana no necesita el registro completo; quitar una adoptada sí', () => {
    const orphanRemove = identityActions(identity({ status: 'orphan' })).find(
      (item) => item.id === 'removeFromInventory',
    )
    const adoptedRemove = identityActions(identity()).find(
      (item) => item.id === 'removeFromInventory',
    )
    expect(orphanRemove?.needsRecord).toBe(false)
    expect(adoptedRemove?.needsRecord).toBe(true)
  })
})

describe('rowIdentityActions (R1)', () => {
  it.each(ALL_STATES.map((item) => [item.status, item] as const))(
    'toda acción de la fila (%s) también está en la ficha',
    (_, item) => {
      const detail = ids(identityActions(item))
      for (const id of ids(rowIdentityActions(item))) expect(detail).toContain(id)
    },
  )

  it('la fila de una adoptada no ofrece lo que exige el registro completo', () => {
    expect(ids(rowIdentityActions(identity()))).toEqual([
      'viewGrants',
      'reveal',
      'rotatePassword',
      'dropFromEngine',
    ])
  })

  it('la fila de una huérfana sí ofrece quitarla del inventario', () => {
    expect(ids(rowIdentityActions(identity({ status: 'orphan' })))).toEqual([
      'recreate',
      'viewGrants',
      'removeFromInventory',
    ])
  })
})

describe('orden de las destructivas', () => {
  it.each(ALL_STATES.map((item) => [item.status, item] as const))(
    'en %s las destructivas van al final',
    (_, item) => {
      const list = identityActions(item).map((candidate) => candidate.id)
      const firstDestructive = list.findIndex((id) => DESTRUCTIVE_IDENTITY_ACTIONS.has(id))
      if (firstDestructive === -1) return
      for (const id of list.slice(firstDestructive)) {
        expect(DESTRUCTIVE_IDENTITY_ACTIONS.has(id)).toBe(true)
      }
    },
  )
})

describe('ACTION_LABELS (R5)', () => {
  it('no hay dos acciones distintas con la misma etiqueta', () => {
    const labels = Object.values(ACTION_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('la que ejecuta DROP lo dice y va marcada como acción sobre el motor', () => {
    expect(ACTION_LABELS.dropFromEngine).toBe('Eliminar del motor 🔌')
    expect(ACTION_LABELS.removeFromInventory).toBe('Quitar del inventario')
  })

  it('recrear también toca el motor y lo dice, igual que en las bases', () => {
    expect(ACTION_LABELS.recreate).toBe('Recrear en el motor 🔌')
  })
})

describe('liveHostsOf', () => {
  it('descarta los hosts huérfanos y las identidades sin host', () => {
    const result = liveHostsOf(
      user([
        identity({ host: '%' }),
        identity({ host: 'localhost', status: 'orphan' }),
        identity({ host: '10.0.0.%', status: 'unmanaged' }),
        identity({ host: null }),
      ]),
    )
    expect(result).toEqual(['%', '10.0.0.%'])
  })
})

describe('usernameActions', () => {
  it('sin hosts (PostgreSQL) solo queda definir la contraseña', () => {
    expect(ids(usernameActions(user([identity({ host: null })]), false))).toEqual([
      'definePassword',
    ])
  })

  it('«Agregar host» no depende de la identidad mirada: basta un host vivo del username', () => {
    const actions = usernameActions(
      user([identity({ host: 'localhost', status: 'orphan' }), identity({ host: '%' })]),
      true,
    )
    const addHost = actions.find((item) => item.id === 'addHost')
    expect(addHost).toBeDefined()
    expect(addHost?.disabledReason).toBeUndefined()
  })

  it('con todos los hosts huérfanos, «Agregar host» se deshabilita con motivo', () => {
    const actions = usernameActions(user([identity({ status: 'orphan' })]), true)
    expect(actions.find((item) => item.id === 'addHost')?.disabledReason).toMatch(/huérfanos/)
  })

  it('«Adoptar todos los hosts» solo aparece con alguna identidad sin adoptar', () => {
    expect(ids(usernameActions(user([identity()]), true))).not.toContain('adoptAllHosts')
    expect(
      ids(usernameActions(user([identity({ status: 'unmanaged', server_user_id: null })]), true)),
    ).toContain('adoptAllHosts')
  })

  it('«Rotar en todos los hosts» solo aparece con más de una identidad', () => {
    expect(ids(usernameActions(user([identity()]), true))).not.toContain('rotateAllHosts')
    expect(
      ids(usernameActions(user([identity(), identity({ host: 'localhost' })]), true)),
    ).toContain('rotateAllHosts')
  })
})

describe('acciones según capacidades', () => {
  // Un `operator`: escribe, pero ni revela contraseñas ni borra del motor.
  const operator = (capability: string) =>
    capability === 'engine_users.read' || capability === 'engine_users.write'

  it('sin `engine_users.secrets` no ofrece «Revelar» y sin `drop` no ofrece «Eliminar del motor»', () => {
    const actions = ids(identityActions(identity(), operator))
    expect(actions).not.toContain('reveal')
    expect(actions).not.toContain('dropFromEngine')
    expect(actions).toContain('edit')
  })

  it('sin `engine_users.credentials` no ofrece nada que siempre ponga una contraseña elegida', () => {
    expect(ids(identityActions(identity(), operator))).not.toContain('rotatePassword')
    expect(ids(identityActions(identity({ status: 'orphan' }), operator))).not.toContain('recreate')
    const batch = ids(
      usernameActions(
        user([identity(), identity({ host: 'localhost', status: 'unmanaged' })]),
        true,
        operator,
      ),
    )
    expect(batch).not.toContain('definePassword')
    expect(batch).not.toContain('rotateAllHosts')
    // Las que tienen un camino sin contraseña siguen: el diálogo deshabilita solo ese campo.
    expect(batch).toEqual(['addHost', 'adoptAllHosts'])
    expect(ids(identityActions(identity({ status: 'unmanaged' }), operator))).toContain('adopt')
  })

  it('con `engine_users.credentials` (owner) las ofrece todas', () => {
    expect(ids(identityActions(identity(), () => true))).toContain('rotatePassword')
    expect(
      ids(usernameActions(user([identity(), identity({ host: 'localhost' })]), true, () => true)),
    ).toEqual(expect.arrayContaining(['definePassword', 'rotateAllHosts']))
  })

  it('un lector solo ve los permisos efectivos', () => {
    const viewer = (capability: string) => capability === 'engine_users.read'
    expect(ids(identityActions(identity(), viewer))).toEqual(['viewGrants'])
    expect(usernameActions(user([identity()]), true, viewer)).toEqual([])
  })

  it('el aviso único nombra lo que falta, con voseo', () => {
    expect(engineUserAccessNote(operator)).toBe(
      'Con tu acceso podés ver estos usuarios, pero no elegir ni definir sus contraseñas, revelar sus contraseñas ni borrarlos del motor. Pedíselo a quien administra los accesos.',
    )
    expect(engineUserAccessNote(() => true)).toBeNull()
  })
})
