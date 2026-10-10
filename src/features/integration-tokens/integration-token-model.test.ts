import { describe, expect, it } from 'vitest'
import type {
  IntegrationCeilingOut,
  IntegrationScopeCeilingEntry,
  IntegrationTokenOut,
} from '@/lib/contracts'
import {
  buildUpdateBody,
  groupCeilingScopesByTier,
  hasDestructiveSelection,
  maxTtlDaysFor,
  tokenHasDestructiveScope,
} from './integration-token-model'

const READ_ENTRY: IntegrationScopeCeilingEntry = {
  scope: 'servers.list',
  label: 'Listar servidores permitidos',
  mutates: false,
  tier: 'read',
}
const WRITE_ENTRY: IntegrationScopeCeilingEntry = {
  scope: 'databases.create',
  label: 'Crear una base de datos',
  mutates: true,
  tier: 'write',
}
const DESTRUCTIVE_ENTRY: IntegrationScopeCeilingEntry = {
  scope: 'migrations.rollback',
  label: 'Revertir migraciones',
  mutates: true,
  tier: 'destructive',
}

const CEILING: IntegrationCeilingOut = {
  enabled: true,
  scopes: [READ_ENTRY, WRITE_ENTRY, DESTRUCTIVE_ENTRY],
  max_ttl_days: 90,
  max_write_ttl_days: 30,
  max_destructive_ttl_days: 7,
  allow_non_expiring: false,
}

function token(overrides: Partial<IntegrationTokenOut> = {}): IntegrationTokenOut {
  return {
    id: 7,
    token_id: 'ab12cd34',
    name: 'web-tienda',
    scopes: ['servers.list'],
    suspended_scopes: [],
    server_ids: [1],
    blueprint_ids: [],
    created_by_admin_id: 3,
    expires_at: '2026-12-01T00:00:00Z',
    last_used_at: null,
    revoked_at: null,
    note: null,
    active: true,
    created_at: '2026-10-10T12:00:00Z',
    ...overrides,
  }
}

describe('groupCeilingScopesByTier', () => {
  it('ordena Lectura, Escritura, Destructivas y respeta el orden del servidor dentro de cada una', () => {
    const groups = groupCeilingScopesByTier([DESTRUCTIVE_ENTRY, WRITE_ENTRY, READ_ENTRY])
    expect(groups.map((group) => group.tier)).toEqual(['read', 'write', 'destructive'])
    expect(groups.map((group) => group.title)).toEqual(['Lectura', 'Escritura', 'Destructivas'])
  })

  it('NO crea grupos vacíos: un tier sin scopes en el techo no se dibuja', () => {
    const groups = groupCeilingScopesByTier([READ_ENTRY])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.entries).toEqual([READ_ENTRY])
  })

  it('un techo vacío no produce ningún grupo', () => {
    expect(groupCeilingScopesByTier([])).toEqual([])
  })
})

describe('hasDestructiveSelection', () => {
  it('mira el tier que informó el servidor para los scopes elegidos', () => {
    expect(hasDestructiveSelection(['servers.list'], CEILING.scopes)).toBe(false)
    expect(hasDestructiveSelection(['servers.list', 'migrations.rollback'], CEILING.scopes)).toBe(
      true,
    )
  })

  it('ignora un scope que el techo no ofrece', () => {
    expect(hasDestructiveSelection(['migrations.stamp'], CEILING.scopes)).toBe(false)
  })
})

describe('maxTtlDaysFor', () => {
  it('solo lectura usa el tope general', () => {
    expect(maxTtlDaysFor(['servers.list'], CEILING)).toBe(90)
  })

  it('con algún scope de escritura baja al tope de escritura', () => {
    expect(maxTtlDaysFor(['servers.list', 'databases.create'], CEILING)).toBe(30)
  })

  it('con algún scope destructivo baja al tope destructivo, aunque haya de escritura', () => {
    expect(maxTtlDaysFor(['databases.create', 'migrations.rollback'], CEILING)).toBe(7)
  })

  it('sin selección usa el tope general', () => {
    expect(maxTtlDaysFor([], CEILING)).toBe(90)
  })
})

describe('tokenHasDestructiveScope', () => {
  it('usa el vocabulario conocido, sin techo, para marcar la fila del listado', () => {
    expect(tokenHasDestructiveScope(token({ scopes: ['migrations.stamp'] }))).toBe(true)
    expect(tokenHasDestructiveScope(token({ scopes: ['migrations.apply_forward'] }))).toBe(false)
  })

  it('un token con el scope destructivo solo SUSPENDIDO no se marca como destructivo', () => {
    expect(
      tokenHasDestructiveScope(
        token({ scopes: ['servers.list'], suspended_scopes: ['migrations.rollback'] }),
      ),
    ).toBe(false)
  })
})

describe('buildUpdateBody', () => {
  const baseDraft = {
    name: 'web-tienda',
    scopes: ['servers.list'],
    serverIds: [1],
    blueprintIds: [] as number[],
    note: '',
  }

  it('sin cambios devuelve un cuerpo vacío', () => {
    expect(buildUpdateBody(token(), baseDraft)).toEqual({})
  })

  it('manda solo lo que cambió, y los scopes como lista COMPLETA', () => {
    const body = buildUpdateBody(token(), {
      ...baseDraft,
      scopes: ['servers.list', 'databases.create'],
    })
    expect(body).toEqual({ scopes: ['servers.list', 'databases.create'] })
  })

  it('el orden distinto de los mismos scopes no cuenta como cambio', () => {
    const body = buildUpdateBody(token({ scopes: ['servers.list', 'databases.create'] }), {
      ...baseDraft,
      scopes: ['databases.create', 'servers.list'],
    })
    expect(body).toEqual({})
  })

  it('detecta cambios de nombre, servidores y blueprints', () => {
    const body = buildUpdateBody(token(), {
      ...baseDraft,
      name: '  web-tienda-2  ',
      serverIds: [1, 2],
      blueprintIds: [5],
    })
    expect(body).toEqual({ name: 'web-tienda-2', server_ids: [1, 2], blueprint_ids: [5] })
  })

  it('una nota vacía sobre una nota existente se envía como cadena vacía; sin nota previa no cambia', () => {
    expect(buildUpdateBody(token({ note: 'pipeline' }), { ...baseDraft, note: '' })).toEqual({
      note: '',
    })
    expect(buildUpdateBody(token({ note: null }), { ...baseDraft, note: '' })).toEqual({})
  })
})
