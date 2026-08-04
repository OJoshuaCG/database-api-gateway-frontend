import { describe, expect, it } from 'vitest'
import {
  QUERY_LIMITS,
  type QueryConnectionIn,
  type QueryExecuteOut,
  type QueryHistoryOut,
  type QueryPreviewOut,
  type QueryStatementPlanOut,
  type QueryStatementResultOut,
} from '@/lib/contracts'
import {
  blocksSystemDatabaseWrite,
  buildConnection,
  buildExecuteInput,
  clampMaxRows,
  clampTimeoutMs,
  decidePath,
  EMPTY_IDENTITY,
  estimatedRowsTotal,
  executionSummary,
  identityFromHistory,
  isPreviewStale,
  isSystemDatabase,
  modeOptionsFor,
  requestFingerprint,
  safeFilenamePart,
  soleUsableDatabase,
  sqlByteLength,
  statementOutcome,
  toCsv,
  validateIdentity,
  type IdentityDraft,
} from './logic'

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Objetos base + overrides parciales: los contratos de la consola tienen 15-20 campos y
// repetirlos en cada caso escondería justo el campo que el test está probando.

function identity(overrides: Partial<IdentityDraft> = {}): IdentityDraft {
  return { ...EMPTY_IDENTITY, ...overrides }
}

function statementPlan(overrides: Partial<QueryStatementPlanOut> = {}): QueryStatementPlanOut {
  return {
    seq: 1,
    sql: 'SELECT 1',
    kind: 'select',
    danger: 'read',
    reasons: [],
    estimated_rows: null,
    ...overrides,
  }
}

function preview(overrides: Partial<QueryPreviewOut> = {}): QueryPreviewOut {
  return {
    server_id: 7,
    database: 'ventas',
    engine: 'mysql',
    run_as: 'app_rw',
    connection_mode: 'provided',
    danger: 'read',
    requires_confirmation: false,
    blocked: false,
    statements: [],
    reasons: [],
    warnings: [],
    confirm_token: null,
    expires_at: null,
    ...overrides,
  }
}

function statementResult(
  overrides: Partial<QueryStatementResultOut> = {},
): QueryStatementResultOut {
  return {
    seq: 1,
    sql: 'SELECT 1',
    kind: 'select',
    danger: 'read',
    executed: true,
    success: true,
    duration_ms: 3,
    columns: ['n'],
    rows: [[1]],
    row_count: 1,
    rows_affected: null,
    truncated: false,
    policy_miss: false,
    error: null,
    ...overrides,
  }
}

function executeResult(overrides: Partial<QueryExecuteOut> = {}): QueryExecuteOut {
  return {
    server_id: 7,
    database: 'ventas',
    engine: 'mysql',
    run_as: 'app_rw',
    connection_mode: 'provided',
    danger: 'read',
    success: true,
    read_only: true,
    dry_run: false,
    committed: false,
    rolled_back: false,
    ddl_persisted: false,
    statements: [statementResult()],
    connection_error: null,
    warnings: [],
    execution_id: 100,
    ...overrides,
  }
}

function historyEntry(overrides: Partial<QueryHistoryOut> = {}): QueryHistoryOut {
  return {
    id: 1,
    server_id: 7,
    database_name: 'ventas',
    engine: 'mysql',
    admin_username: 'admin',
    connection_mode: 'provided',
    run_as_username: 'app_rw',
    impersonated_role: null,
    sql_text: 'SELECT 1',
    danger_level: 'read',
    statement_count: 1,
    status: 'success',
    read_only: true,
    dry_run: false,
    committed: false,
    rows_returned: 1,
    rows_affected: 0,
    duration_ms: 3,
    error_code: null,
    error_message: null,
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  }
}

// ── decidePath ────────────────────────────────────────────────────────────────

describe('decidePath', () => {
  it('devuelve "blocked" aunque el lote bloqueado también pida confirmación', () => {
    // 🚨 El caso del contrato: `blocked` y `requires_confirmation` llegan juntos con
    // `confirm_token: null`. Mirar la confirmación primero abriría un diálogo con token nulo
    // que solo puede terminar en 403 después de hacer tipear el nombre de la base.
    const result = decidePath(
      preview({
        danger: 'blocked',
        blocked: true,
        requires_confirmation: true,
        confirm_token: null,
      }),
    )
    expect(result).toBe('blocked')
  })

  it('devuelve "confirm" cuando el lote exige confirmación y no está bloqueado', () => {
    expect(
      decidePath(preview({ danger: 'write', requires_confirmation: true, confirm_token: 'tok' })),
    ).toBe('confirm')
  })

  it('devuelve "direct" cuando no hay bloqueo ni confirmación', () => {
    expect(decidePath(preview({ danger: 'read' }))).toBe('direct')
  })

  it('exige confirmación en write/ddl aunque el backend no la pida (QUERY_SAFE_MODE apagado)', () => {
    // Con el modo seguro apagado el backend devuelve `requires_confirmation: false` y
    // ejecutaría la escritura sin más. La confirmación por tipeo es una decisión de esta
    // interfaz: obedecer el flag a secas convertiría un UPDATE sin WHERE en un solo clic.
    expect(
      decidePath(preview({ danger: 'write', requires_confirmation: false, confirm_token: 'tok' })),
    ).toBe('confirm')
    expect(
      decidePath(preview({ danger: 'ddl', requires_confirmation: false, confirm_token: 'tok' })),
    ).toBe('confirm')
  })
})

// ── requestFingerprint / isPreviewStale ───────────────────────────────────────

describe('requestFingerprint', () => {
  const baseConnection: QueryConnectionIn = {
    mode: 'stored',
    username: 'app_rw',
    host: 'localhost',
    role: null,
  }
  const base = requestFingerprint('SELECT 1', 'ventas', baseConnection)

  it('cambia si cambia el SQL', () => {
    expect(requestFingerprint('SELECT 2', 'ventas', baseConnection)).not.toBe(base)
  })

  it('cambia si cambia la base de datos', () => {
    expect(requestFingerprint('SELECT 1', 'compras', baseConnection)).not.toBe(base)
  })

  it('cambia si cambia el modo de conexión', () => {
    expect(requestFingerprint('SELECT 1', 'ventas', { ...baseConnection, mode: 'admin' })).not.toBe(
      base,
    )
  })

  it('cambia si cambia el usuario', () => {
    expect(
      requestFingerprint('SELECT 1', 'ventas', { ...baseConnection, username: 'app_ro' }),
    ).not.toBe(base)
  })

  it('cambia si cambia el host', () => {
    // 'app_rw'@'localhost' y 'app_rw'@'%' son cuentas distintas del motor.
    expect(requestFingerprint('SELECT 1', 'ventas', { ...baseConnection, host: '%' })).not.toBe(
      base,
    )
  })

  it('cambia si cambia el rol adoptado', () => {
    expect(
      requestFingerprint('SELECT 1', 'ventas', { ...baseConnection, role: 'reportes_ro' }),
    ).not.toBe(base)
  })

  it('NO cambia al recortar espacios en los extremos del SQL', () => {
    // El backend normaliza igual antes de hashear: obligar a re-clasificar por un salto de
    // línea al final sería gastar rate limit para nada.
    expect(requestFingerprint('\n  SELECT 1  \n', 'ventas', baseConnection)).toBe(base)
  })

  it('SÍ cambia si el espacio cambia en el medio del SQL', () => {
    expect(requestFingerprint('SELECT  1', 'ventas', baseConnection)).not.toBe(base)
  })

  it('NO cambia al cambiar solo la contraseña', () => {
    // La contraseña no forma parte de la ligadura del token en el backend.
    const conUna = requestFingerprint('SELECT 1', 'ventas', {
      mode: 'provided',
      username: 'app_rw',
      password: 'primera',
    })
    const conOtra = requestFingerprint('SELECT 1', 'ventas', {
      mode: 'provided',
      username: 'app_rw',
      password: 'segunda',
    })
    expect(conUna).toBe(conOtra)
  })
})

describe('isPreviewStale', () => {
  const fingerprint = requestFingerprint('SELECT 1', 'ventas', { mode: 'admin' })

  it('considera obsoleto el estado sin preview', () => {
    expect(isPreviewStale(null, fingerprint)).toBe(true)
  })

  it('considera vigente el preview pedido con la misma huella', () => {
    expect(isPreviewStale({ preview: preview(), fingerprint }, fingerprint)).toBe(false)
  })

  it('considera obsoleto el preview pedido con otra huella', () => {
    const otra = requestFingerprint('SELECT 1', 'compras', { mode: 'admin' })
    expect(isPreviewStale({ preview: preview(), fingerprint }, otra)).toBe(true)
  })
})

// ── buildConnection ───────────────────────────────────────────────────────────

describe('buildConnection', () => {
  // Un campo residual de otro modo invalida el token entre el preview y el execute (→ 422),
  // así que cada modo debe emitir exactamente sus campos y ninguno más.
  const sucio = identity({ username: 'app_rw', host: 'localhost', password: 'secreta', role: 'ro' })

  it('en modo admin no manda nada más que el modo', () => {
    expect(buildConnection({ ...sucio, mode: 'admin' }, 'mysql')).toEqual({ mode: 'admin' })
  })

  it('sin modo elegido cae en admin, también sin campos extra', () => {
    expect(buildConnection(sucio, 'mysql')).toEqual({ mode: 'admin' })
  })

  it('en modo stored manda usuario y host en MySQL/MariaDB', () => {
    for (const engine of ['mysql', 'mariadb'] as const) {
      expect(buildConnection({ ...sucio, mode: 'stored' }, engine)).toEqual({
        mode: 'stored',
        username: 'app_rw',
        host: 'localhost',
      })
    }
  })

  it('en modo stored omite el host en PostgreSQL', () => {
    const connection = buildConnection({ ...sucio, mode: 'stored' }, 'postgresql')
    expect(connection).toEqual({ mode: 'stored', username: 'app_rw' })
    expect(connection).not.toHaveProperty('host')
  })

  it('en modo stored omite el host vacío', () => {
    const connection = buildConnection({ ...sucio, mode: 'stored', host: '   ' }, 'mysql')
    expect(connection).not.toHaveProperty('host')
  })

  it('en modo provided manda usuario y contraseña, nunca el host', () => {
    const connection = buildConnection({ ...sucio, mode: 'provided' }, 'mysql')
    expect(connection).toEqual({ mode: 'provided', username: 'app_rw', password: 'secreta' })
    expect(connection).not.toHaveProperty('host')
  })

  it('en modo impersonate manda solo el rol', () => {
    expect(buildConnection({ ...sucio, mode: 'impersonate' }, 'postgresql')).toEqual({
      mode: 'impersonate',
      role: 'ro',
    })
  })
})

// ── validateIdentity ──────────────────────────────────────────────────────────

describe('validateIdentity', () => {
  it('exige elegir un modo', () => {
    expect(validateIdentity(identity(), 'mysql')).not.toBeNull()
  })

  it('exige la contraseña en modo provided', () => {
    expect(
      validateIdentity(identity({ mode: 'provided', username: 'app_rw' }), 'mysql'),
    ).not.toBeNull()
  })

  it('exige el usuario en modo stored', () => {
    expect(validateIdentity(identity({ mode: 'stored' }), 'mysql')).not.toBeNull()
  })

  it('rechaza impersonate fuera de PostgreSQL', () => {
    expect(validateIdentity(identity({ mode: 'impersonate', role: 'ro' }), 'mysql')).not.toBeNull()
  })

  it('exige el rol en impersonate sobre PostgreSQL', () => {
    expect(validateIdentity(identity({ mode: 'impersonate' }), 'postgresql')).not.toBeNull()
  })

  it('acepta los borradores completos de cada modo', () => {
    expect(validateIdentity(identity({ mode: 'admin' }), 'mysql')).toBeNull()
    expect(validateIdentity(identity({ mode: 'stored', username: 'app_rw' }), 'mysql')).toBeNull()
    expect(
      validateIdentity(identity({ mode: 'provided', username: 'app_rw', password: 'x' }), 'mysql'),
    ).toBeNull()
    expect(validateIdentity(identity({ mode: 'impersonate', role: 'ro' }), 'postgresql')).toBeNull()
  })
})

// ── buildExecuteInput ─────────────────────────────────────────────────────────

describe('buildExecuteInput', () => {
  const connection: QueryConnectionIn = { mode: 'admin' }

  function args(overrides: Partial<Parameters<typeof buildExecuteInput>[0]> = {}) {
    return {
      database: 'ventas',
      sql: 'UPDATE clientes SET activo = 1',
      connection,
      preview: preview({ danger: 'write', requires_confirmation: true, confirm_token: 'tok-1' }),
      confirmTargetName: 'ventas',
      dryRun: false,
      maxRows: null,
      timeoutMs: null,
      ...overrides,
    }
  }

  it('envía el token aunque el preview no exigiera confirmación', () => {
    // Con `QUERY_SAFE_MODE` apagado un lote `write` vuelve sin exigir confirmación pero CON
    // token: mandar una confirmación de más es inofensivo, omitirla cuando hacía falta es 422.
    const input = buildExecuteInput(
      args({
        preview: preview({ danger: 'write', requires_confirmation: false, confirm_token: 'tok-1' }),
        confirmTargetName: null,
      }),
    )
    expect(input.confirm_token).toBe('tok-1')
    expect(input.confirm_target_name).toBe('ventas')
  })

  it('usa el nombre tipeado en el diálogo cuando existe', () => {
    const input = buildExecuteInput(args({ confirmTargetName: 'Ventas' }))
    expect(input.confirm_target_name).toBe('Ventas')
  })

  it('omite la confirmación cuando el preview no trajo token', () => {
    const input = buildExecuteInput(args({ preview: preview({ confirm_token: null }) }))
    expect(input).not.toHaveProperty('confirm_token')
    expect(input).not.toHaveProperty('confirm_target_name')
  })

  it('omite la confirmación cuando todavía no hay preview', () => {
    const input = buildExecuteInput(args({ preview: null }))
    expect(input).not.toHaveProperty('confirm_token')
  })

  it('envía max_rows solo cuando BAJA del tope global', () => {
    expect(buildExecuteInput(args({ maxRows: 100 })).max_rows).toBe(100)
    expect(buildExecuteInput(args({ maxRows: QUERY_LIMITS.maxRows }))).not.toHaveProperty(
      'max_rows',
    )
    expect(buildExecuteInput(args({ maxRows: null }))).not.toHaveProperty('max_rows')
  })

  it('omite timeout_ms cuando es el valor por defecto', () => {
    expect(
      buildExecuteInput(args({ timeoutMs: QUERY_LIMITS.defaultTimeoutMs })),
    ).not.toHaveProperty('timeout_ms')
    expect(buildExecuteInput(args({ timeoutMs: 5_000 })).timeout_ms).toBe(5_000)
  })

  it('envía dry_run solo cuando está activado', () => {
    expect(buildExecuteInput(args({ dryRun: false }))).not.toHaveProperty('dry_run')
    expect(buildExecuteInput(args({ dryRun: true })).dry_run).toBe(true)
  })

  it('reenvía el SQL crudo y la base sin tocarlos', () => {
    const input = buildExecuteInput(args({ sql: '  SELECT 1  ' }))
    expect(input.sql).toBe('  SELECT 1  ')
    expect(input.database).toBe('ventas')
  })
})

// ── estimatedRowsTotal ────────────────────────────────────────────────────────

describe('estimatedRowsTotal', () => {
  it('suma solo las sentencias que sí pudieron estimarse', () => {
    const result = estimatedRowsTotal(
      preview({
        statements: [
          statementPlan({ seq: 1, estimated_rows: 12 }),
          statementPlan({ seq: 2, estimated_rows: null }),
          statementPlan({ seq: 3, estimated_rows: 30 }),
        ],
      }),
    )
    expect(result).toBe(42)
  })

  it('devuelve null (no 0) si NINGUNA sentencia pudo estimarse', () => {
    const result = estimatedRowsTotal(
      preview({ statements: [statementPlan({ estimated_rows: null })] }),
    )
    expect(result).toBeNull()
    expect(result).not.toBe(0)
  })

  it('devuelve null si el lote no tiene sentencias', () => {
    expect(estimatedRowsTotal(preview({ statements: [] }))).toBeNull()
  })

  it('distingue una estimación de cero filas de la ausencia de estimación', () => {
    expect(
      estimatedRowsTotal(preview({ statements: [statementPlan({ estimated_rows: 0 })] })),
    ).toBe(0)
  })
})

// ── Bases de datos de sistema ─────────────────────────────────────────────────

describe('isSystemDatabase', () => {
  it('reconoce las bases de sistema de MySQL/MariaDB', () => {
    expect(isSystemDatabase('mysql', 'mysql')).toBe(true)
    expect(isSystemDatabase('mysql', 'information_schema')).toBe(true)
    expect(isSystemDatabase('mariadb', 'performance_schema')).toBe(true)
  })

  it('reconoce las bases de sistema de PostgreSQL', () => {
    expect(isSystemDatabase('postgresql', 'postgres')).toBe(true)
    expect(isSystemDatabase('postgresql', 'template1')).toBe(true)
  })

  it('compara sin distinguir mayúsculas', () => {
    expect(isSystemDatabase('mysql', 'MySQL')).toBe(true)
    expect(isSystemDatabase('mysql', 'INFORMATION_SCHEMA')).toBe(true)
    expect(isSystemDatabase('postgresql', 'Template1')).toBe(true)
  })

  it('no marca las bases de usuario, ni sin motor o sin nombre', () => {
    expect(isSystemDatabase('mysql', 'ventas')).toBe(false)
    expect(isSystemDatabase(null, 'mysql')).toBe(false)
    expect(isSystemDatabase('mysql', '')).toBe(false)
  })
})

describe('blocksSystemDatabaseWrite', () => {
  it('bloquea escribir y cambiar la estructura de una base de sistema', () => {
    expect(blocksSystemDatabaseWrite('mysql', 'mysql', 'write')).toBe(true)
    expect(blocksSystemDatabaseWrite('mysql', 'information_schema', 'ddl')).toBe(true)
    expect(blocksSystemDatabaseWrite('postgresql', 'postgres', 'write')).toBe(true)
    expect(blocksSystemDatabaseWrite('postgresql', 'TEMPLATE1', 'ddl')).toBe(true)
  })

  it('NO bloquea leerlas: consultar los catálogos es justo lo que se viene a hacer', () => {
    expect(blocksSystemDatabaseWrite('mysql', 'mysql', 'read')).toBe(false)
    expect(blocksSystemDatabaseWrite('postgresql', 'postgres', 'read')).toBe(false)
  })

  it('no bloquea la escritura sobre una base de usuario', () => {
    expect(blocksSystemDatabaseWrite('mysql', 'ventas', 'write')).toBe(false)
  })
})

// ── executionSummary ──────────────────────────────────────────────────────────

describe('executionSummary', () => {
  it('ddl_persisted gana sobre cualquier otra condición', () => {
    const summary = executionSummary(
      executeResult({
        ddl_persisted: true,
        success: false,
        connection_error: { code: '1045', message: 'Access denied' },
        statements: [statementResult({ policy_miss: true })],
      }),
    )
    expect(summary.tone).toBe('error')
    expect(summary.title).toBe('Quedaron cambios de estructura aplicados')
  })

  it('policy_miss gana sobre el error de conexión y el rechazo del motor', () => {
    const summary = executionSummary(
      executeResult({
        success: false,
        connection_error: { code: '1045', message: 'Access denied' },
        statements: [statementResult({ policy_miss: true, success: false })],
      }),
    )
    expect(summary.tone).toBe('error')
    expect(summary.title).toBe('El gateway clasificó mal esta consulta')
  })

  it('el error de conexión gana sobre el rechazo del motor y es neutro', () => {
    const summary = executionSummary(
      executeResult({
        success: false,
        run_as: 'app_ro',
        connection_error: { code: '1045', message: 'Access denied' },
      }),
    )
    expect(summary.tone).toBe('neutral')
    expect(summary.title).toContain('app_ro')
  })

  it('el rechazo del motor es NEUTRO, nunca rojo: es el resultado que se fue a buscar', () => {
    const summary = executionSummary(
      executeResult({ success: false, statements: [statementResult({ success: false })] }),
    )
    expect(summary.tone).toBe('neutral')
    expect(summary.tone).not.toBe('error')
    expect(summary.title).toContain('Prueba completada')
  })

  it('informa que el modo de prueba no guardó nada', () => {
    const summary = executionSummary(executeResult({ dry_run: true, rolled_back: true }))
    expect(summary.tone).toBe('success')
    expect(summary.title).toBe('Modo de prueba: nada se guardó')
  })

  it('resume la ejecución normal según se haya confirmado o no', () => {
    expect(executionSummary(executeResult({ committed: true }))).toMatchObject({
      tone: 'success',
      title: 'Ejecución completada',
      description: 'Los cambios quedaron confirmados en el motor.',
    })
    expect(executionSummary(executeResult({ committed: false })).description).toContain(
      'solo lectura',
    )
  })
})

// ── toCsv ─────────────────────────────────────────────────────────────────────

describe('toCsv', () => {
  it('escribe el encabezado y una fila por resultado, separadas por CRLF', () => {
    const csv = toCsv(
      ['id', 'nombre'],
      [
        [1, 'Ana'],
        [2, 'Luis'],
      ],
    )
    expect(csv).toBe('id,nombre\r\n1,Ana\r\n2,Luis')
  })

  it('entrecomilla los campos con coma, comilla o salto de línea (RFC 4180)', () => {
    const csv = toCsv(['valor'], [['García, Ana'], ['Dijo "hola"'], ['línea1\nlínea2']])
    expect(csv).toBe('valor\r\n"García, Ana"\r\n"Dijo ""hola"""\r\n"línea1\nlínea2"')
  })

  it('duplica las comillas dobles dentro de un campo entrecomillado', () => {
    expect(toCsv(['v'], [['a"b']])).toBe('v\r\n"a""b"')
  })

  it('entrecomilla también los nombres de columna que lo necesitan', () => {
    expect(toCsv(['id,seq'], [[1]])).toBe('"id,seq"\r\n1')
  })

  it('escribe NULL para las celdas nulas o ausentes', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\nNULL,NULL')
  })

  it('emite solo el encabezado cuando no hay filas', () => {
    expect(toCsv(['id'], [])).toBe('id')
  })

  it('neutraliza las celdas que la hoja de cálculo interpretaría como fórmula', () => {
    // Las filas vienen de una base ajena: `=cmd|…` o `=HYPERLINK(…)` ejecutarían código o
    // exfiltrarían la hoja al abrir el CSV en Excel/LibreOffice.
    expect(toCsv(['v'], [['=1+1']])).toBe("v\r\n'=1+1")
    expect(toCsv(['v'], [['@SUM(A1)']])).toBe("v\r\n'@SUM(A1)")
    expect(toCsv(['v'], [['+1']])).toBe("v\r\n'+1")
    expect(toCsv(['v'], [['\tvalor']])).toBe("v\r\n'\tvalor")
  })

  it('neutraliza también los nombres de columna (un alias del SELECT los controla)', () => {
    expect(toCsv(['=A1'], [[1]])).toBe("'=A1\r\n1")
  })

  it('NO toca los números negativos, que no son fórmulas', () => {
    // Sin esta excepción, una columna numérica con negativos se exportaría entera como texto.
    expect(toCsv(['saldo'], [[-5], ['-3.14'], ['-1e3']])).toBe('saldo\r\n-5\r\n-3.14\r\n-1e3')
  })

  it('combina la neutralización con el entrecomillado RFC 4180', () => {
    expect(toCsv(['v'], [['=A1,B1']])).toBe('v\r\n"\'=A1,B1"')
  })
})

// ── clampMaxRows / clampTimeoutMs ─────────────────────────────────────────────

describe('clampMaxRows', () => {
  it('recorta al tope del despliegue y nunca baja de 1', () => {
    expect(clampMaxRows(999_999)).toBe(QUERY_LIMITS.maxRows)
    expect(clampMaxRows(0)).toBe(1)
    expect(clampMaxRows(-10)).toBe(1)
    expect(clampMaxRows(250)).toBe(250)
  })

  it('cae al tope global si el valor no es un número', () => {
    expect(clampMaxRows(Number.NaN)).toBe(QUERY_LIMITS.maxRows)
  })
})

describe('clampTimeoutMs', () => {
  it('mantiene el timeout dentro del rango que acepta el backend', () => {
    // Vaciar el campo producía `0`, que el backend rechaza con un 422 gastando rate limit.
    expect(clampTimeoutMs(0)).toBe(QUERY_LIMITS.minTimeoutMs)
    expect(clampTimeoutMs(-1)).toBe(QUERY_LIMITS.minTimeoutMs)
    expect(clampTimeoutMs(999_999_999)).toBe(QUERY_LIMITS.maxTimeoutMs)
    expect(clampTimeoutMs(45_000)).toBe(45_000)
  })

  it('cae al default si el valor no es un número', () => {
    expect(clampTimeoutMs(Number.NaN)).toBe(QUERY_LIMITS.defaultTimeoutMs)
  })
})

// ── soleUsableDatabase ────────────────────────────────────────────────────────

describe('soleUsableDatabase', () => {
  it('devuelve la única base que no es del sistema', () => {
    // El contrato exige `database`, pero no hay que hacer elegir cuando no hay opción.
    expect(
      soleUsableDatabase(
        ['information_schema', 'mysql', 'performance_schema', 'sys', 'tienda'],
        'mysql',
      ),
    ).toBe('tienda')
    expect(soleUsableDatabase(['postgres', 'template0', 'template1', 'tienda'], 'postgresql')).toBe(
      'tienda',
    )
  })

  it('no adivina cuando hay más de una', () => {
    // Una lectura contra la base equivocada daría un resultado engañoso sin avisar.
    expect(soleUsableDatabase(['tienda', 'analitica'], 'mysql')).toBeNull()
  })

  it('devuelve null si no hay ninguna utilizable o la lista no llegó', () => {
    expect(soleUsableDatabase(['mysql', 'sys'], 'mysql')).toBeNull()
    expect(soleUsableDatabase([], 'mysql')).toBeNull()
    expect(soleUsableDatabase(undefined, 'mysql')).toBeNull()
  })
})

// ── safeFilenamePart ──────────────────────────────────────────────────────────

describe('safeFilenamePart', () => {
  it('sustituye lo que no sea alfanumérico, punto o guion', () => {
    // El nombre de la base es eco de un servidor ajeno: no debe llegar crudo al disco.
    expect(safeFilenamePart('mi base/../etc')).toBe('mi_base_.._etc')
    expect(safeFilenamePart('tienda')).toBe('tienda')
  })

  it('devuelve un nombre por defecto si no queda nada utilizable', () => {
    expect(safeFilenamePart('///')).toBe('resultado')
    expect(safeFilenamePart('')).toBe('resultado')
  })
})

// ── sqlByteLength ─────────────────────────────────────────────────────────────

describe('sqlByteLength', () => {
  it('cuenta bytes UTF-8, no caracteres', () => {
    // El tope del backend es en bytes: un acento cuenta doble y un emoji cuadruplica.
    expect(sqlByteLength('SELECT 1')).toBe(8)
    expect(sqlByteLength('ñ')).toBe(2)
    expect(sqlByteLength('🚀')).toBe(4)
    expect(sqlByteLength('🚀')).not.toBe('🚀'.length)
  })

  it('suma los bytes de un SQL con acentos', () => {
    const sql = "SELECT 'año'"
    expect(sql.length).toBe(12)
    expect(sqlByteLength(sql)).toBe(13)
  })
})

// ── statementOutcome ──────────────────────────────────────────────────────────

describe('statementOutcome', () => {
  it('policy-miss gana sobre cualquier otro desenlace', () => {
    expect(
      statementOutcome(statementResult({ policy_miss: true, executed: false, success: false })),
    ).toBe('policy-miss')
  })

  it('marca como omitida la sentencia que no llegó a ejecutarse', () => {
    expect(statementOutcome(statementResult({ executed: false, success: false }))).toBe('skipped')
  })

  it('marca como rechazada la sentencia ejecutada que falló', () => {
    expect(statementOutcome(statementResult({ executed: true, success: false }))).toBe('rejected')
  })

  it('marca como correcta la sentencia ejecutada con éxito', () => {
    expect(statementOutcome(statementResult())).toBe('ok')
  })
})

// ── identityFromHistory ───────────────────────────────────────────────────────

describe('identityFromHistory', () => {
  it('reconstruye el modo y el usuario de una fila del historial', () => {
    expect(identityFromHistory(historyEntry({ connection_mode: 'stored' }))).toEqual({
      mode: 'stored',
      username: 'app_rw',
      host: '',
      password: '',
      role: '',
    })
  })

  it('reconstruye el rol adoptado y deja el usuario vacío en impersonate', () => {
    const draft = identityFromHistory(
      historyEntry({ connection_mode: 'impersonate', impersonated_role: 'reportes_ro' }),
    )
    expect(draft.mode).toBe('impersonate')
    expect(draft.username).toBe('')
    expect(draft.role).toBe('reportes_ro')
  })

  it('NUNCA trae contraseña: no existe en ninguna parte y hay que volver a pedirla', () => {
    for (const mode of ['admin', 'stored', 'provided', 'impersonate'] as const) {
      expect(identityFromHistory(historyEntry({ connection_mode: mode })).password).toBe('')
    }
  })
})

// ── modeOptionsFor ────────────────────────────────────────────────────────────

describe('modeOptionsFor', () => {
  it('ofrece adoptar un rol solo en PostgreSQL', () => {
    const modos = modeOptionsFor('postgresql').map((option) => option.mode)
    expect(modos).toContain('impersonate')
  })

  it('oculta adoptar un rol fuera de PostgreSQL', () => {
    for (const engine of ['mysql', 'mariadb', null] as const) {
      const modos = modeOptionsFor(engine).map((option) => option.mode)
      expect(modos).not.toContain('impersonate')
      expect(modos).toEqual(['provided', 'stored', 'admin'])
    }
  })
})
