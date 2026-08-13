import { describe, expect, it } from 'vitest'
import type { DatabaseGrantee, ManagedDatabaseOut } from '@/lib/contracts'
import {
  buildCreateBody,
  buildDropSuccessDescription,
  CLOCK_SKEW_MARGIN_MS,
  CREATE_FORM_DEFAULTS,
  crossWithInventory,
  engineCopy,
  engineLabel,
  filterDatabaseRows,
  filterGrantees,
  formatCountdown,
  isDangerousPrivilege,
  isReservedDatabaseName,
  remainingMs,
  shouldPreselectForceDisconnect,
  validateNewDatabaseName,
  warnDuplicateDatabaseName,
  type CreateFormValues,
} from './logic'

function managedDatabase(overrides: Partial<ManagedDatabaseOut> = {}): ManagedDatabaseOut {
  return {
    id: 1,
    name: 'ventas',
    server_id: 10,
    owner_id: 5,
    status: 'active',
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

function grantee(overrides: Partial<DatabaseGrantee> = {}): DatabaseGrantee {
  return {
    username: 'app',
    host: '%',
    is_global: false,
    privileges: ['SELECT'],
    levels: ['database'],
    status: 'adopted',
    server_user_id: 12,
    ...overrides,
  }
}

describe('adaptación por motor', () => {
  it('usa la terminología de MySQL en mysql y mariadb', () => {
    for (const engine of ['mysql', 'mariadb'] as const) {
      const copy = engineCopy(engine)
      expect(copy.combinedLabel).toBe('Juego de caracteres y ordenamiento')
      expect(copy.showOwner).toBe(false)
      // Las conexiones abiertas no bloquean el DROP en MySQL/MariaDB.
      expect(copy.connectionsBlockDrop).toBe(false)
    }
  })

  it('usa la terminología de PostgreSQL y expone el campo owner', () => {
    const copy = engineCopy('postgresql')
    expect(copy.combinedLabel).toBe('Codificación y locale')
    expect(copy.showOwner).toBe(true)
    expect(copy.connectionsBlockDrop).toBe(true)
  })

  it('nombra los motores de forma legible', () => {
    expect(engineLabel('mysql')).toBe('MySQL')
    expect(engineLabel('mariadb')).toBe('MariaDB')
    expect(engineLabel('postgresql')).toBe('PostgreSQL')
  })
})

describe('validateNewDatabaseName', () => {
  it('acepta un nombre conforme a la whitelist estricta', () => {
    expect(validateNewDatabaseName('mysql', 'ventas_2026')).toBeUndefined()
    expect(validateNewDatabaseName('mysql', '_interno')).toBeUndefined()
  })

  it('exige un nombre', () => {
    expect(validateNewDatabaseName('mysql', '   ')).toBe('El nombre es obligatorio.')
  })

  it('rechaza un primer carácter que no sea letra ni «_»', () => {
    expect(validateNewDatabaseName('mysql', '1ventas')).toBe('Debe empezar con una letra o «_».')
  })

  it('rechaza los caracteres que el backend no admite al crear', () => {
    for (const name of ['mi-base', 'mi base', 'mi.base', 'ventas$', 'café']) {
      expect(validateNewDatabaseName('mysql', name)).toBe('Solo se permiten letras, dígitos y «_».')
    }
  })

  it('rechaza por longitud en los tres motores: la regex del backend tope en 63', () => {
    const tooLong = 'a'.repeat(64)
    for (const engine of ['mysql', 'mariadb', 'postgresql'] as const) {
      expect(validateNewDatabaseName(engine, tooLong)).toBe('Máximo 63 caracteres para este motor.')
    }
    expect(validateNewDatabaseName('postgresql', 'a'.repeat(63))).toBeUndefined()
  })

  it('bloquea las bases de sistema de cada motor, sin distinguir mayúsculas', () => {
    expect(validateNewDatabaseName('mysql', 'MySQL')).toContain('base de datos del sistema')
    expect(validateNewDatabaseName('mysql', 'performance_schema')).toContain('del sistema')
    expect(validateNewDatabaseName('postgresql', 'template0')).toContain('del sistema')
  })

  it('no confunde las reservadas de un motor con las de otro', () => {
    // `postgres` es reservada en PostgreSQL pero es un nombre válido en MySQL.
    expect(validateNewDatabaseName('mysql', 'postgres')).toBeUndefined()
    expect(validateNewDatabaseName('postgresql', 'postgres')).toContain('del sistema')
    expect(validateNewDatabaseName('postgresql', 'sys')).toBeUndefined()
  })

  it('isReservedDatabaseName normaliza espacios y mayúsculas', () => {
    expect(isReservedDatabaseName('mysql', '  MYSQL ')).toBe(true)
    expect(isReservedDatabaseName('mysql', 'ventas')).toBe(false)
  })
})

describe('warnDuplicateDatabaseName', () => {
  it('avisa sin bloquear cuando el nombre ya existe en el motor', () => {
    expect(warnDuplicateDatabaseName('ventas', ['ventas', 'compras'])).toContain('Ya existe')
  })

  it('no avisa con un nombre nuevo ni con el campo vacío', () => {
    expect(warnDuplicateDatabaseName('nueva', ['ventas'])).toBeUndefined()
    expect(warnDuplicateDatabaseName('', ['ventas'])).toBeUndefined()
  })
})

describe('buildCreateBody', () => {
  const base: CreateFormValues = { ...CREATE_FORM_DEFAULTS, name: '  ventas  ' }

  it('recorta el nombre y usa el valor por defecto del motor sin charsetCollation', () => {
    const body = buildCreateBody(base, 'mysql')
    expect(body.name).toBe('ventas')
    expect(body.charset).toBeNull()
    expect(body.collation).toBeNull()
    expect(body.register).toBe(false)
  })

  it('vuelca charset/collation de la combinación elegida en el selector', () => {
    const body = buildCreateBody(
      { ...base, charsetCollation: { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' } },
      'mysql',
    )
    expect(body.charset).toBe('utf8mb4')
    expect(body.collation).toBe('utf8mb4_unicode_ci')
  })

  it('usa el valor por defecto del motor con charsetCollation en null', () => {
    const body = buildCreateBody({ ...base, charsetCollation: null }, 'mysql')
    expect(body.charset).toBeNull()
    expect(body.collation).toBeNull()
  })

  it('omite `owner` en MySQL/MariaDB porque el backend lo ignora', () => {
    const body = buildCreateBody({ ...base, owner: 'app_role' }, 'mysql')
    expect(body.owner).toBeUndefined()
  })

  it('envía `owner` en PostgreSQL sin registro en inventario', () => {
    const body = buildCreateBody({ ...base, owner: 'app_role' }, 'postgresql')
    expect(body.owner).toBe('app_role')
  })

  it('omite `owner` con register=true: el backend usa el username del ServerUser', () => {
    const body = buildCreateBody(
      { ...base, owner: 'app_role', register: true, ownerId: 7 },
      'postgresql',
    )
    expect(body.owner).toBeUndefined()
    expect(body.owner_id).toBe(7)
  })

  it('solo envía owner_id y notes cuando se registra en el inventario', () => {
    const sinRegistro = buildCreateBody({ ...base, ownerId: 7, notes: 'hola' }, 'mysql')
    expect(sinRegistro.owner_id).toBeUndefined()
    expect(sinRegistro.notes).toBeUndefined()

    const conRegistro = buildCreateBody(
      { ...base, register: true, ownerId: 7, notes: 'hola' },
      'mysql',
    )
    expect(conRegistro.owner_id).toBe(7)
    expect(conRegistro.notes).toBe('hola')
  })
})

describe('crossWithInventory', () => {
  it('marca como gestionadas solo las que tienen fila en el inventario', () => {
    const rows = crossWithInventory(
      ['ventas', 'temporal'],
      [managedDatabase({ id: 42, name: 'ventas' })],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'ventas', isManaged: true })
    expect(rows[0]?.managed?.id).toBe(42)
    expect(rows[1]).toMatchObject({ name: 'temporal', isManaged: false, managed: null })
  })

  it('trata el inventario ausente como «todavía no se sabe», sin inventar filas', () => {
    const rows = crossWithInventory(['ventas'], undefined)
    expect(rows).toEqual([{ name: 'ventas', managed: null, isManaged: false }])
  })

  it('ignora los registros del inventario sin base física (huérfanos)', () => {
    const rows = crossWithInventory(['ventas'], [managedDatabase({ name: 'borrada_a_mano' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.isManaged).toBe(false)
  })

  it('conserva el orden del listado físico', () => {
    const rows = crossWithInventory(['b', 'a', 'c'], [])
    expect(rows.map((row) => row.name)).toEqual(['b', 'a', 'c'])
  })
})

describe('filterDatabaseRows', () => {
  const rows = crossWithInventory(
    ['ventas', 'ventas_old', 'compras'],
    [managedDatabase({ name: 'ventas' })],
  )

  it('busca por subcadena sin distinguir mayúsculas', () => {
    const result = filterDatabaseRows(rows, { search: 'VENT', scope: 'all' })
    expect(result.map((row) => row.name)).toEqual(['ventas', 'ventas_old'])
  })

  it('filtra por estado de inventario', () => {
    expect(filterDatabaseRows(rows, { search: '', scope: 'managed' })).toHaveLength(1)
    expect(filterDatabaseRows(rows, { search: '', scope: 'unmanaged' })).toHaveLength(2)
  })

  it('combina búsqueda y estado', () => {
    const result = filterDatabaseRows(rows, { search: 'ventas', scope: 'unmanaged' })
    expect(result.map((row) => row.name)).toEqual(['ventas_old'])
  })
})

describe('filterGrantees', () => {
  const grantees = [
    grantee({ username: 'app', host: '%' }),
    grantee({
      username: 'reportes',
      host: '10.0.0.1',
      is_global: true,
      status: 'unmanaged',
      server_user_id: null,
    }),
    grantee({ username: 'backup', host: 'localhost', status: 'unmanaged', server_user_id: null }),
  ]

  it('busca por username y por host', () => {
    expect(
      filterGrantees(grantees, { search: 'rep', onlyGlobal: false, scope: 'all' }),
    ).toHaveLength(1)
    expect(
      filterGrantees(grantees, { search: '10.0', onlyGlobal: false, scope: 'all' }),
    ).toHaveLength(1)
  })

  it('aísla los grantees con privilegios globales', () => {
    const result = filterGrantees(grantees, { search: '', onlyGlobal: true, scope: 'all' })
    expect(result.map((item) => item.username)).toEqual(['reportes'])
  })

  it('filtra por estado de inventario', () => {
    expect(
      filterGrantees(grantees, { search: '', onlyGlobal: false, scope: 'adopted' }),
    ).toHaveLength(1)
    expect(
      filterGrantees(grantees, { search: '', onlyGlobal: false, scope: 'unmanaged' }),
    ).toHaveLength(2)
  })

  it('tolera un host nulo (PostgreSQL) al buscar', () => {
    const pg = [grantee({ username: 'app_pg', host: null })]
    expect(filterGrantees(pg, { search: 'app', onlyGlobal: false, scope: 'all' })).toHaveLength(1)
  })
})

describe('isDangerousPrivilege', () => {
  it('destaca los privilegios destructivos o que redistribuyen acceso', () => {
    for (const privilege of ['DROP', 'ALTER', 'GRANT OPTION', 'ALL PRIVILEGES', 'OWNER']) {
      expect(isDangerousPrivilege(privilege)).toBe(true)
    }
  })

  it('no destaca los de solo lectura o escritura ordinaria', () => {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'CONNECT']) {
      expect(isDangerousPrivilege(privilege)).toBe(false)
    }
  })

  it('normaliza mayúsculas y espacios', () => {
    expect(isDangerousPrivilege(' drop ')).toBe(true)
  })
})

describe('vigencia del confirm_token', () => {
  const now = Date.parse('2026-07-30T12:00:00Z')

  it('descuenta el margen por desfase de reloj', () => {
    const expiresAt = new Date(now + 10_000).toISOString()
    expect(remainingMs(expiresAt, now)).toBe(10_000 - CLOCK_SKEW_MARGIN_MS)
  })

  it('nunca devuelve un restante negativo', () => {
    expect(remainingMs(new Date(now - 60_000).toISOString(), now)).toBe(0)
  })

  it('trata una fecha ilegible como vencida, en vez de dejar pasar el borrado', () => {
    expect(remainingMs('no-es-una-fecha', now)).toBe(0)
  })

  it('considera vencido el token dentro del margen de seguridad', () => {
    expect(remainingMs(new Date(now + 1_000).toISOString(), now)).toBe(0)
  })

  it('formatea la cuenta atrás en mm:ss', () => {
    expect(formatCountdown(120_000)).toBe('02:00')
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(0)).toBe('00:00')
    // Se redondea hacia arriba: mientras quede una fracción de segundo, no muestra 00:00.
    expect(formatCountdown(1)).toBe('00:01')
  })
})

describe('shouldPreselectForceDisconnect', () => {
  it('se premarca en PostgreSQL solo si hay conexiones abiertas', () => {
    expect(shouldPreselectForceDisconnect('postgresql', 3)).toBe(true)
    expect(shouldPreselectForceDisconnect('postgresql', 0)).toBe(false)
  })

  it('nunca se premarca en MySQL/MariaDB: ahí es un no-op', () => {
    expect(shouldPreselectForceDisconnect('mysql', 3)).toBe(false)
    expect(shouldPreselectForceDisconnect('mariadb', 3)).toBe(false)
  })
})

describe('buildDropSuccessDescription', () => {
  const result = {
    database: 'ventas',
    engine: 'postgresql' as const,
    dropped: true,
    inventory_removed: false,
    terminated_connections: 0,
  }

  it('no dice nada cuando no hubo efectos colaterales', () => {
    expect(buildDropSuccessDescription(result)).toBe('')
  })

  it('menciona la limpieza del inventario', () => {
    expect(buildDropSuccessDescription({ ...result, inventory_removed: true })).toContain(
      'registro del inventario',
    )
  })

  it('menciona las conexiones solo si se terminó alguna', () => {
    expect(buildDropSuccessDescription({ ...result, terminated_connections: 3 })).toContain(
      'Se terminaron 3',
    )
    // Con force_disconnect=false el backend devuelve 0 aunque hubiera conexiones: mencionarlo
    // daría a entender que no había ninguna.
    expect(buildDropSuccessDescription({ ...result, terminated_connections: 0 })).toBe('')
  })

  it('combina ambos efectos', () => {
    const description = buildDropSuccessDescription({
      ...result,
      inventory_removed: true,
      terminated_connections: 2,
    })
    expect(description).toContain('inventario')
    expect(description).toContain('Se terminaron 2')
  })
})
