import {
  QUERY_LIMITS,
  SYSTEM_DATABASES,
  type ConnectionMode,
  type DangerLevel,
  type EngineType,
  type HistoryStatus,
  type QueryConnectionIn,
  type QueryExecuteIn,
  type QueryExecuteOut,
  type QueryHistoryOut,
  type QueryPreviewOut,
  type QueryStatementResultOut,
} from '@/lib/contracts'

/**
 * Lógica PURA de la Consola SQL: identidad de ejecución, vigencia del `confirm_token`,
 * decisión de camino, y presentación de resultados. Sin React ni acceso a red — se testea
 * directamente en `logic.test.ts`.
 *
 * Aquí vive TODO el mapeo del contrato v6 a decisiones de UI, a propósito: §2.8 avisa que
 * el backend todavía no se validó contra motores reales, así que un ajuste del contrato
 * debe tocar este archivo y no diez componentes.
 */

// ── Identidad de ejecución (§4) ───────────────────────────────────────────────

/**
 * Borrador del selector de identidad. `mode: null` = "sin elegir", que es el estado inicial
 * DELIBERADO: el schema del backend usa `admin` por defecto, pero arrancar ahí invitaría al
 * error exacto que el módulo existe para evitar (creer que se prueban permisos cuando en
 * realidad se están evitando con la credencial pseudo-root).
 */
export interface IdentityDraft {
  mode: ConnectionMode | null
  username: string
  /** Solo `stored` en MySQL/MariaDB. Vacío ⇒ el backend asume `%`. */
  host: string
  /** Solo `provided`. Nunca se persiste: ni aquí, ni en el backend, ni en el historial. */
  password: string
  /** Solo `impersonate` (PostgreSQL). */
  role: string
}

export const EMPTY_IDENTITY: IdentityDraft = {
  mode: null,
  username: '',
  host: '',
  password: '',
  role: '',
}

export interface ModeOption {
  mode: ConnectionMode
  label: string
  /** Qué hace, en una línea, para que la elección no dependa de leer la documentación. */
  hint: string
}

/**
 * Orden deliberado: `provided` primero porque es el caso más común al verificar permisos
 * (un usuario que el gateway no administra), y `admin` último porque es el que NO prueba nada.
 */
export const MODE_OPTIONS: readonly ModeOption[] = [
  // Los `hint` son deliberadamente cortos: van dentro de tarjetas angostas, en una fila, y su
  // trabajo es hacer distinguibles las opciones de un vistazo. El detalle completo de cada
  // modo vive en el panel que aparece al elegirlo, donde hay sitio para explicarlo.
  {
    mode: 'provided',
    label: 'Usuario con contraseña',
    hint: 'Cualquier usuario del motor, con su contraseña. El caso más común.',
  },
  {
    mode: 'stored',
    label: 'Usuario del inventario',
    hint: 'Una cuenta que el gateway administra y cuya contraseña ya fijó.',
  },
  {
    mode: 'impersonate',
    label: 'Adoptar un rol',
    hint: 'Prueba un rol sin conocer su contraseña. Solo PostgreSQL.',
  },
  {
    mode: 'admin',
    label: 'Credencial pseudo-root',
    hint: 'Administra el servidor entero: los permisos no se prueban, se evitan.',
  },
]

/** `SET ROLE` solo existe en PostgreSQL; en MySQL/MariaDB el backend responde 422 siempre. */
export function supportsImpersonate(engine: EngineType | null): boolean {
  return engine === 'postgresql'
}

/** En PostgreSQL los roles no tienen host: el campo se oculta y el backend lo ignora. */
export function supportsHost(engine: EngineType | null): boolean {
  return engine === 'mysql' || engine === 'mariadb'
}

export function modeOptionsFor(engine: EngineType | null): readonly ModeOption[] {
  if (supportsImpersonate(engine)) return MODE_OPTIONS
  return MODE_OPTIONS.filter((option) => option.mode !== 'impersonate')
}

/**
 * Traduce el borrador al payload exacto de la API, incluyendo SOLO los campos que el modo
 * usa. Es importante que no se cuelen campos de otros modos: el `confirm_token` se ata a
 * `(hash del SQL, mode, username, role, host)`, así que un `host` residual de un modo
 * anterior invalidaría el token entre el preview y el execute (→ 422).
 */
export function buildConnection(
  draft: IdentityDraft,
  engine: EngineType | null,
): QueryConnectionIn {
  switch (draft.mode) {
    case 'stored': {
      const connection: QueryConnectionIn = { mode: 'stored', username: draft.username.trim() }
      // El host solo viaja donde significa algo: 'app'@'localhost' y 'app'@'%' son cuentas
      // DISTINTAS en MySQL/MariaDB, pero en PostgreSQL el campo no existe.
      if (supportsHost(engine) && draft.host.trim().length > 0) {
        connection.host = draft.host.trim()
      }
      return connection
    }
    case 'provided':
      return { mode: 'provided', username: draft.username.trim(), password: draft.password }
    case 'impersonate':
      return { mode: 'impersonate', role: draft.role.trim() }
    default:
      return { mode: 'admin' }
  }
}

/**
 * Valida el borrador en cliente. Devuelve el mensaje del problema o `null` si está completo.
 * Duplica a propósito las reglas del 422 del backend: gastar un request para descubrir que
 * falta la contraseña consume rate limit (30/min) sin aportar nada.
 */
export function validateIdentity(draft: IdentityDraft, engine: EngineType | null): string | null {
  if (draft.mode === null) return 'Elegí con qué usuario del motor se va a ejecutar.'
  if (draft.mode === 'admin') return null
  if (draft.mode === 'impersonate') {
    if (!supportsImpersonate(engine)) {
      return 'Adoptar un rol con SET ROLE solo existe en PostgreSQL.'
    }
    return draft.role.trim().length > 0 ? null : 'Indicá el rol que se va a adoptar.'
  }
  if (draft.username.trim().length === 0) return 'Indicá el usuario del motor.'
  if (draft.mode === 'provided' && draft.password.length === 0) {
    return 'Indicá la contraseña de ese usuario.'
  }
  return null
}

/** Identidad legible: `app_ro@%`, `rol reportes_ro`, `pseudo-root`. */
export function identityLabel(draft: IdentityDraft, engine: EngineType | null): string {
  switch (draft.mode) {
    case 'stored':
    case 'provided': {
      const username = draft.username.trim() || '(sin usuario)'
      if (!supportsHost(engine)) return username
      return `${username}@${draft.host.trim() || '%'}`
    }
    case 'impersonate':
      return `rol ${draft.role.trim() || '(sin rol)'}`
    case 'admin':
      return 'pseudo-root'
    default:
      return 'sin elegir'
  }
}

export type IdentityTone = 'danger' | 'primary' | 'accent' | 'neutral'

/**
 * Tono del banner de identidad. `admin` en rojo permanente no es decoración: es la única
 * señal continua de que lo que se está viendo NO es una prueba de permisos.
 */
export function identityTone(mode: ConnectionMode | null): IdentityTone {
  if (mode === 'admin') return 'danger'
  if (mode === 'impersonate') return 'accent'
  if (mode === null) return 'neutral'
  return 'primary'
}

/** Texto del banner de identidad, en la voz de la pantalla (los `warnings` los redacta el backend). */
export function identityBannerText(draft: IdentityDraft, engine: EngineType | null): string {
  switch (draft.mode) {
    case 'admin':
      return 'Operando como administrador total del servidor. No estás probando permisos: los estás evitando.'
    case 'impersonate':
      return `Rol adoptado con SET ROLE (${identityLabel(draft, engine)}). Reproduce sus permisos para esta sesión, pero es una herramienta de prueba, no una frontera de seguridad.`
    case 'stored':
    case 'provided':
      return `Ejecutando como ${identityLabel(draft, engine)} — este es el usuario que se está probando.`
    default:
      return 'Elegí con qué usuario del motor se va a ejecutar antes de escribir la consulta.'
  }
}

// ── Vigencia del `confirm_token` (§4, §14) ────────────────────────────────────

/**
 * Huella de todo aquello a lo que el backend ata el `confirm_token`. Si cambia, el token
 * emitido por el preview deja de valer y el execute responde 422.
 *
 * `password` queda FUERA a propósito: el backend no la incluye en la ligadura, y hacer que
 * corregir una contraseña obligue a re-clasificar sería ruido puro. El SQL se compara
 * recortado en los extremos porque es exactamente lo que normaliza el backend antes de
 * hashear (por eso también se envía el texto crudo, sin reformatear, en ambas llamadas).
 */
export function requestFingerprint(
  sql: string,
  database: string,
  connection: QueryConnectionIn,
): string {
  return JSON.stringify([
    sql.trim(),
    database,
    connection.mode,
    connection.username ?? null,
    connection.host ?? null,
    connection.role ?? null,
  ])
}

/** Preview vigente + la huella con la que se pidió. Si la huella cambia, el token es basura. */
export interface PreviewSnapshot {
  preview: QueryPreviewOut
  fingerprint: string
}

export function isPreviewStale(snapshot: PreviewSnapshot | null, fingerprint: string): boolean {
  return snapshot === null || snapshot.fingerprint !== fingerprint
}

// ── Decisión de camino (§5, 🚨) ───────────────────────────────────────────────

export type ExecutionPath = 'blocked' | 'confirm' | 'direct'

/**
 * ⚠️ El orden importa. Un lote bloqueado vuelve con `blocked: true` Y
 * `requires_confirmation: true` a la vez, con `confirm_token: null`. Mirar
 * `requires_confirmation` primero abriría un diálogo de confirmación con token nulo, que
 * termina en un 403 después de hacerle tipear el nombre de la base al usuario.
 *
 * ⚠️ La segunda condición es MÁS ESTRICTA que el contrato, a propósito.
 * `requires_confirmation` refleja el flag de despliegue `QUERY_SAFE_MODE`: con el modo
 * seguro apagado, un lote `write` vuelve con `false` y el backend lo ejecutaría sin exigir
 * nada. Obedecer ese flag a secas convertiría un `UPDATE` sin `WHERE` en un clic sin
 * confirmación, con un botón que encima dice «Revisar y confirmar…». La confirmación por
 * tipeo es una decisión de esta interfaz, no del despliegue; el token se sigue enviando
 * cuando el preview lo emitió, así que exigirla de más es inofensivo (§5).
 */
export function decidePath(preview: QueryPreviewOut): ExecutionPath {
  if (preview.blocked) return 'blocked'
  if (preview.requires_confirmation) return 'confirm'
  if (preview.danger === 'write' || preview.danger === 'ddl') return 'confirm'
  return 'direct'
}

/**
 * Construye el body del execute.
 *
 * Regla del contrato (§5): el flujo de confirmación se decide por `requires_confirmation`,
 * pero el token se envía SIEMPRE que el preview lo haya producido. Con `QUERY_SAFE_MODE`
 * apagado un lote `write` puede volver sin exigir confirmación pero con token igualmente;
 * mandar una confirmación que no hacía falta es inofensivo, omitirla cuando hacía falta
 * es un 422.
 */
export function buildExecuteInput(args: {
  database: string
  /** El texto CRUDO, byte a byte el mismo que se mandó al preview. */
  sql: string
  connection: QueryConnectionIn
  preview: QueryPreviewOut | null
  /** Lo que el admin tipeó en el diálogo; el backend lo revalida contra `database`. */
  confirmTargetName: string | null
  dryRun: boolean
  maxRows: number | null
  timeoutMs: number | null
}): QueryExecuteIn {
  const input: QueryExecuteIn = {
    database: args.database,
    sql: args.sql,
    connection: args.connection,
  }
  const token = args.preview?.confirm_token
  if (token) {
    input.confirm_token = token
    input.confirm_target_name = args.confirmTargetName ?? args.database
  }
  if (args.dryRun) input.dry_run = true
  // `max_rows` solo puede BAJAR el tope global: mandar el default sería ruido.
  if (args.maxRows !== null) {
    const bounded = clampMaxRows(args.maxRows)
    if (bounded < QUERY_LIMITS.maxRows) input.max_rows = bounded
  }
  if (args.timeoutMs !== null) {
    const bounded = clampTimeoutMs(args.timeoutMs)
    if (bounded !== QUERY_LIMITS.defaultTimeoutMs) input.timeout_ms = bounded
  }
  return input
}

/**
 * Recorte de `max_rows` y `timeout_ms` a los rangos que acepta el backend.
 *
 * Se aplica dos veces a propósito: en el input, para que el campo no muestre un valor que
 * nunca se va a enviar, y aquí, porque este es el único punto por el que pasa todo lo que
 * viaja al execute. Un `timeout_ms: 0` que llegara al backend se cobraría un 422 y gastaría
 * una de las 30 llamadas por minuto para decir algo que se sabía en el cliente.
 */
export function clampMaxRows(value: number): number {
  if (!Number.isFinite(value)) return QUERY_LIMITS.maxRows
  return Math.min(Math.max(1, Math.trunc(value)), QUERY_LIMITS.maxRows)
}

export function clampTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) return QUERY_LIMITS.defaultTimeoutMs
  return Math.min(Math.max(QUERY_LIMITS.minTimeoutMs, Math.trunc(value)), QUERY_LIMITS.maxTimeoutMs)
}

/**
 * Suma de filas estimadas del lote, o `null` si ninguna sentencia pudo estimarse.
 *
 * Se usa para comparar dos previews del mismo SQL: cuando el token caduca y hay que
 * re-clasificar justo antes de ejecutar, si la cifra cambió NO se re-ejecuta en silencio —
 * el admin confirmó "2 481 902 filas", no lo que sea que diga la estimación nueva.
 */
export function estimatedRowsTotal(preview: QueryPreviewOut): number | null {
  let total: number | null = null
  for (const statement of preview.statements) {
    if (typeof statement.estimated_rows === 'number') {
      total = (total ?? 0) + statement.estimated_rows
    }
  }
  return total
}

// ── Límites del SQL (§2.3) ────────────────────────────────────────────────────

/** El tope del backend es en BYTES UTF-8, no en caracteres: un acento cuenta doble. */
export function sqlByteLength(sql: string): number {
  return new TextEncoder().encode(sql).length
}

export function exceedsSqlLimit(sql: string): boolean {
  return sqlByteLength(sql) > QUERY_LIMITS.maxSqlBytes
}

// ── Bases de datos de sistema (§6, gotcha) ────────────────────────────────────

export function isSystemDatabase(engine: EngineType | null, database: string): boolean {
  if (!engine || database.length === 0) return false
  return SYSTEM_DATABASES[engine].includes(database.toLowerCase())
}

/**
 * La única base de datos «de trabajo» del servidor, o `null` si hay varias (o ninguna).
 *
 * El contrato exige `database` en el preview y en el execute —la conexión se abre contra una
 * base concreta—, así que no se puede omitir. Lo que sí se puede es no hacer elegir cuando no
 * hay nada que elegir: si el servidor tiene una sola base que no sea del sistema, esa es. Con
 * dos o más NO se adivina: la confirmación por tipeo del nombre protege de un destino
 * equivocado, pero una lectura sobre la base errónea daría un resultado engañoso en silencio.
 */
export function soleUsableDatabase(
  databases: readonly string[] | undefined,
  engine: EngineType | null,
): string | null {
  if (!databases) return null
  const usable = databases.filter((database) => !isSystemDatabase(engine, database))
  return usable.length === 1 ? (usable[0] ?? null) : null
}

/**
 * El guard de BD de sistema solo corre en el EXECUTE: un preview sobre `mysql` con un
 * `UPDATE` devuelve `danger: "write"` y un token válido, y aun así el execute responde 403.
 * Se corta antes en cliente para no llevar al usuario por un callejón sin salida.
 */
export function blocksSystemDatabaseWrite(
  engine: EngineType | null,
  database: string,
  danger: DangerLevel,
): boolean {
  return danger !== 'read' && isSystemDatabase(engine, database)
}

// ── Presentación del nivel de peligro (§3) ────────────────────────────────────

export interface DangerCopy {
  label: string
  tone: 'success' | 'warning' | 'error' | 'neutral'
  /** Texto del botón principal cuando el lote está clasificado con este nivel. */
  actionLabel: string
  /** Título del diálogo de confirmación (vacío si el nivel no lo abre). */
  dialogTitle: string
  description: string
}

const DANGER_COPY: Record<DangerLevel, DangerCopy> = {
  read: {
    label: 'Lectura',
    tone: 'success',
    actionLabel: 'Ejecutar',
    dialogTitle: '',
    description:
      'Solo lee. Se ejecuta dentro de una transacción de solo lectura real del motor, así que aunque la clasificación se equivocara el motor la abortaría.',
  },
  write: {
    label: 'Escritura',
    tone: 'warning',
    actionLabel: 'Revisar y confirmar…',
    dialogTitle: 'Confirmar operación de escritura',
    description:
      'Modifica filas. Pide confirmación tenga o no WHERE: no hay atajo para el caso chico.',
  },
  ddl: {
    label: 'Estructura',
    tone: 'warning',
    actionLabel: 'Revisar y confirmar…',
    dialogTitle: 'Confirmar cambio de estructura',
    description:
      'Afecta la estructura de la base, no solo sus filas. Aquí cae también todo lo que no se pudo clasificar con certeza.',
  },
  blocked: {
    label: 'Prohibido',
    tone: 'error',
    actionLabel: 'No se puede ejecutar',
    dialogTitle: '',
    description:
      'La política de la consola no ejecuta esto ni con confirmación. No es un fallo transitorio: hay un módulo del gateway que sí hace esta operación.',
  },
}

export function dangerCopy(danger: DangerLevel): DangerCopy {
  return DANGER_COPY[danger]
}

/**
 * Los tres motivos *fail-closed*: son los que más se ven con SQL legítimo (un `CALL` a un
 * procedimiento, por ejemplo) y merecen una redacción que no alarme de más — dicen "no se
 * pudo determinar qué hace", no "esto destruye datos".
 */
const FAIL_CLOSED_CODES = new Set(['opaque_statement', 'unparseable', 'unmapped_statement'])

export function isFailClosedReason(code: string): boolean {
  return FAIL_CLOSED_CODES.has(code)
}

export const FAIL_CLOSED_EXPLANATION =
  'No se pudo determinar con certeza qué hace esta sentencia, así que se trata como peligrosa y pide confirmación.'

// ── Presentación de resultados (§6, §11.3) ────────────────────────────────────

export type StatementOutcome = 'ok' | 'rejected' | 'skipped' | 'policy-miss'

/**
 * Desenlace de UNA sentencia. `policy-miss` va aparte de `rejected` porque no es un
 * resultado de la prueba sino un bug del gateway (clasificó como lectura algo que escribe),
 * y es la señal de telemetría más valiosa que produce el módulo.
 */
export function statementOutcome(statement: QueryStatementResultOut): StatementOutcome {
  if (statement.policy_miss) return 'policy-miss'
  if (!statement.executed) return 'skipped'
  return statement.success ? 'ok' : 'rejected'
}

export type ExecutionTone = 'success' | 'neutral' | 'warning' | 'error'

export interface ExecutionSummary {
  tone: ExecutionTone
  title: string
  description: string
}

/**
 * Titular del panel de resultados.
 *
 * La regla más importante del módulo: un rechazo del motor NO es rojo. Desde la perspectiva
 * del admin la prueba salió bien — confirmó que el permiso no está. El rojo queda reservado
 * para `ddl_persisted` (quedaron cambios de esquema pese al rollback) y `policy_miss`.
 */
export function executionSummary(result: QueryExecuteOut): ExecutionSummary {
  if (result.ddl_persisted) {
    return {
      tone: 'error',
      title: 'Quedaron cambios de estructura aplicados',
      description:
        'MySQL/MariaDB hacen COMMIT implícito en cada sentencia DDL: el ROLLBACK no deshizo las sentencias de esquema que ya se habían ejecutado. Verificá el estado real en el motor.',
    }
  }
  if (result.statements.some((statement) => statement.policy_miss)) {
    return {
      tone: 'error',
      title: 'El gateway clasificó mal esta consulta',
      description:
        'La trató como lectura y en realidad escribe, así que el motor la abortó. Es un fallo del gateway, no de la consulta: por favor reportala.',
    }
  }
  if (result.connection_error) {
    return {
      tone: 'neutral',
      title: `No se pudo conectar como ${result.run_as}`,
      description:
        'La conexión con esa identidad fue rechazada. Si estabas probando credenciales o accesos, este es el resultado de la prueba.',
    }
  }
  if (!result.success) {
    return {
      tone: 'neutral',
      title: 'Prueba completada — el motor rechazó la operación',
      description: `Lo ejecutado con ${result.run_as} no pasó. El error nativo del motor está en la sentencia correspondiente.`,
    }
  }
  if (result.dry_run) {
    return {
      tone: 'success',
      title: 'Modo de prueba: nada se guardó',
      description:
        'El lote se ejecutó y se revirtió al final. Las cifras son reales, los cambios no.',
    }
  }
  return {
    tone: 'success',
    title: 'Ejecución completada',
    description: result.committed
      ? 'Los cambios quedaron confirmados en el motor.'
      : 'El lote corrió en una transacción de solo lectura.',
  }
}

/**
 * Aviso previo al execute: `dry_run` + `ddl` en MySQL/MariaDB es la trampa del módulo. Hay
 * que decirlo ANTES de ejecutar, no después, porque después ya es irreversible.
 */
export function dryRunCannotRevertDdl(
  engine: EngineType | null,
  danger: DangerLevel,
  dryRun: boolean,
): boolean {
  return dryRun && danger === 'ddl' && (engine === 'mysql' || engine === 'mariadb')
}

// ── Celdas y exportación ──────────────────────────────────────────────────────

export function isNullCell(value: unknown): boolean {
  return value === null || value === undefined
}

/** Los valores llegan ya normalizados a JSON por el backend; solo falta hacerlos legibles. */
export function formatCellValue(value: unknown): string {
  if (isNullCell(value)) return 'NULL'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * Prefijos que Excel, LibreOffice y Google Sheets interpretan como el comienzo de una
 * FÓRMULA al abrir un CSV. Las filas vienen de una base de datos ajena, así que su contenido
 * es entrada no confiable: una celda con `=cmd|'/c calc'!A1` o `=HYPERLINK("http://…"&A1)`
 * ejecutaría código o exfiltraría el resto de la hoja en la máquina del admin.
 */
const CSV_FORMULA_PREFIXES = /^[=+\-@\t\r]/

/**
 * Número simple, con notación científica. Admite el signo `-` pero NO el `+`: Excel lee `-5`
 * como el número negativo y `+5` como una fórmula, así que exceptuar el `+` abriría de nuevo
 * el agujero que este escape cierra.
 */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/

/**
 * Un `-5` empieza por `-` pero no es una fórmula. Sin esta excepción, cualquier columna con
 * números negativos se exportaría entera como texto, que es un daño real a cambio de nada.
 */
function looksLikeFormula(value: string): boolean {
  return CSV_FORMULA_PREFIXES.test(value) && !PLAIN_NUMBER.test(value)
}

/**
 * CSV RFC 4180 del resultado de una sentencia. El historial no guarda filas (§2.4), así que
 * exportar es la única forma de conservar un resultado sin volver a ejecutar la consulta.
 *
 * Además del entrecomillado estándar, neutraliza la inyección de fórmulas anteponiendo un
 * apóstrofo a las celdas sospechosas: es lo que hace que la hoja de cálculo las trate como
 * texto. Se aplica también a los nombres de columna, que en un `SELECT` con alias los
 * controla igualmente quien escribe la consulta.
 */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const escape = (value: string): string => {
    const safe = looksLikeFormula(value) ? `'${value}` : value
    return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
  }
  const header = columns.map(escape).join(',')
  const body = rows.map((row) => row.map((cell) => escape(formatCellValue(cell))).join(','))
  return [header, ...body].join('\r\n')
}

// `safeFilenamePart` se promovió a `@/lib/utils`: los diagnósticos de clonado necesitan lo
// mismo y una feature no importa de otra. Se re-exporta para no romper a quien ya la importaba
// desde acá.
export { safeFilenamePart } from '@/lib/utils'

// ── Acciones rápidas (§10.5) ──────────────────────────────────────────────────

export interface QuickAction {
  label: string
  sql: string
  /** Ayuda a distinguir "qué está otorgado en el papel" de "qué pasa de verdad". */
  hint: string
}

/**
 * Consultas de un clic que responden la pregunta que trajo al admin a esta pantalla. Todas
 * son `read`: `SHOW GRANTS` no está bloqueado (la blocklist ancla en `^GRANT|^REVOKE`) y
 * leer los catálogos del sistema está permitido — lo que se bloquea es escribirlos.
 */
export function quickActions(engine: EngineType | null, username: string): readonly QuickAction[] {
  const target = username.trim().length > 0 ? username.trim() : 'usuario'
  if (engine === 'postgresql') {
    return [
      {
        label: 'Permisos otorgados',
        sql: `SELECT * FROM information_schema.table_privileges WHERE grantee = '${target}'`,
        hint: 'Lo que está otorgado en el papel, según el catálogo.',
      },
      {
        label: '¿Puede leer una tabla?',
        sql: `SELECT has_table_privilege('${target}', 'nombre_de_tabla', 'SELECT')`,
        hint: 'Respuesta booleana directa. Cambiá el nombre de la tabla.',
      },
      {
        label: 'Identidad efectiva',
        sql: 'SELECT current_user, session_user',
        hint: 'Confirma con qué rol quedó realmente la sesión.',
      },
    ]
  }
  return [
    {
      label: 'Permisos otorgados',
      sql: `SHOW GRANTS FOR '${target}'@'%'`,
      hint: 'Lo que está otorgado en el papel. Ajustá el host si la cuenta no es @%.',
    },
    {
      label: 'Permisos por base',
      sql: `SELECT * FROM mysql.db WHERE User = '${target}'`,
      hint: 'Leer un esquema de sistema está permitido; escribirlo es lo que se bloquea.',
    },
    {
      label: 'Identidad efectiva',
      sql: 'SELECT CURRENT_USER(), USER()',
      hint: 'Confirma con qué cuenta resolvió el motor la conexión.',
    },
  ]
}

// ── Historial (§7, §11.4) ─────────────────────────────────────────────────────

export interface HistoryStatusCopy {
  label: string
  tone: 'success' | 'neutral' | 'error' | 'warning'
  hint: string
}

const HISTORY_STATUS_COPY: Record<HistoryStatus, HistoryStatusCopy> = {
  success: {
    label: 'Correcta',
    tone: 'success',
    hint: 'Todas las sentencias corrieron sin error.',
  },
  // Neutro y no rojo: aquí caen los rechazos por permisos, que suelen ser el resultado buscado.
  error: {
    label: 'Rechazada',
    tone: 'neutral',
    hint: 'El motor rechazó alguna sentencia (incluye la falta de permisos).',
  },
  blocked: {
    label: 'Bloqueada',
    tone: 'warning',
    hint: 'La política la rechazó: nunca se tocó el motor.',
  },
  preview: { label: 'Previsualización', tone: 'neutral', hint: 'Clasificación sin ejecución.' },
}

export function historyStatusCopy(status: HistoryStatus): HistoryStatusCopy {
  return HISTORY_STATUS_COPY[status]
}

/**
 * Identidad reconstruida desde una fila del historial, para el botón "Cargar en el editor".
 *
 * `provided` es el caso especial: la contraseña no existe en ninguna parte (ni el backend la
 * tiene), así que se restaura el usuario y se deja el campo vacío para que vuelva a pedirse.
 */
export function identityFromHistory(entry: QueryHistoryOut): IdentityDraft {
  return {
    mode: entry.connection_mode,
    username: entry.connection_mode === 'impersonate' ? '' : entry.run_as_username,
    host: '',
    password: '',
    role: entry.impersonated_role ?? '',
  }
}
