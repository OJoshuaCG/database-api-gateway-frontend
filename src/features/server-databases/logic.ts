import {
  DATABASE_NAME_PATTERN,
  MAX_DATABASE_NAME_LENGTH,
  RESERVED_DATABASE_NAMES,
  type DatabaseCreateIn,
  type DatabaseDropOut,
  type DatabaseGrantee,
  type EngineType,
  type ManagedDatabaseOut,
} from '@/lib/contracts'

/**
 * Lógica pura del módulo de ciclo de vida de BDs a nivel servidor: adaptación por motor,
 * validación de nombres, cruce con el inventario, filtros en cliente y composición de mensajes.
 * Sin React ni acceso a red — se testea directamente en `logic.test.ts`.
 */

// ── Adaptación por motor (§6.4) ─────────────────────────────────────────────

export interface EngineCopy {
  /** Etiqueta del campo de API `charset`. */
  charsetLabel: string
  charsetHint: string
  charsetSuggestions: readonly string[]
  /** Etiqueta del campo de API `collation`. */
  collationLabel: string
  collationHint: string
  collationSuggestions: readonly string[]
  /** El campo `owner` (rol nativo) solo existe en PostgreSQL; en MySQL el backend lo ignora. */
  showOwner: boolean
  /** En MySQL/MariaDB `force_disconnect` se acepta por paridad de contrato pero es un no-op. */
  forceDisconnectHint: string
  /** Las conexiones abiertas solo bloquean el DROP en PostgreSQL. */
  connectionsBlockDrop: boolean
}

const MYSQL_COPY: EngineCopy = {
  charsetLabel: 'Character set',
  charsetHint: 'Si se deja vacío, se usa el valor por omisión del servidor.',
  charsetSuggestions: ['utf8mb4', 'utf8mb3', 'latin1', 'ascii'],
  collationLabel: 'Collation',
  collationHint: 'Debe ser compatible con el character set elegido.',
  collationSuggestions: [
    'utf8mb4_general_ci',
    'utf8mb4_unicode_ci',
    'utf8mb4_0900_ai_ci',
    'utf8mb4_bin',
  ],
  showOwner: false,
  forceDisconnectHint:
    'En MySQL/MariaDB no tiene efecto: el motor no bloquea el borrado por conexiones abiertas.',
  connectionsBlockDrop: false,
}

const POSTGRES_COPY: EngineCopy = {
  charsetLabel: 'Encoding',
  charsetHint: 'Si se deja vacío se usa UTF8. La base se crea siempre desde template0.',
  charsetSuggestions: ['UTF8', 'LATIN1', 'SQL_ASCII'],
  collationLabel: 'Locale',
  collationHint: 'Fija LC_COLLATE y LC_CTYPE (por ejemplo en_US.UTF-8).',
  collationSuggestions: ['en_US.UTF-8', 'es_ES.UTF-8', 'C', 'C.UTF-8'],
  showOwner: true,
  forceDisconnectHint:
    'En PostgreSQL es OBLIGATORIO si hay conexiones: sin esto el borrado falla porque la base está en uso.',
  connectionsBlockDrop: true,
}

export function engineCopy(engine: EngineType): EngineCopy {
  return engine === 'postgresql' ? POSTGRES_COPY : MYSQL_COPY
}

/** Vive en `lib/utils/format` desde que la consola SQL necesita la misma etiqueta. */
export { engineLabel } from '@/lib/utils/format'

// ── Validación del nombre a crear (§2.10, §2.11) ────────────────────────────

export function isReservedDatabaseName(engine: EngineType, name: string): boolean {
  return RESERVED_DATABASE_NAMES[engine].includes(name.trim().toLowerCase())
}

/**
 * Replica en cliente lo que el backend rechaza al CREAR, para no gastar un request en un error
 * garantizado. Devuelve `undefined` si el nombre es aceptable.
 *
 * Ojo: esto NO aplica al campo de confirmación del borrado, que compara por igualdad exacta
 * contra un nombre que puede ser legado y no pasar esta whitelist.
 */
export function validateNewDatabaseName(engine: EngineType, rawName: string): string | undefined {
  const name = rawName.trim()
  if (name.length === 0) return 'El nombre es obligatorio.'
  if (name.length > MAX_DATABASE_NAME_LENGTH) {
    return `Máximo ${MAX_DATABASE_NAME_LENGTH} caracteres para este motor.`
  }
  if (!/^[A-Za-z_]/.test(name)) return 'Debe empezar con una letra o «_».'
  if (!DATABASE_NAME_PATTERN.test(name)) return 'Solo se permiten letras, dígitos y «_».'
  if (isReservedDatabaseName(engine, name)) {
    return `«${name}» es una base de datos del sistema y no puede crearse.`
  }
  return undefined
}

/**
 * Aviso NO bloqueante: el nombre ya figura en el listado físico del servidor, así que la
 * creación fallará con 409. Se avisa sin impedir el envío porque el listado puede estar obsoleto.
 */
export function warnDuplicateDatabaseName(
  rawName: string,
  existingNames: readonly string[],
): string | undefined {
  const name = rawName.trim()
  if (name.length === 0) return undefined
  return existingNames.includes(name)
    ? 'Ya existe una base con ese nombre en el servidor; la creación fallará.'
    : undefined
}

// ── Construcción del payload de creación (§2.4) ─────────────────────────────

export interface CreateFormValues {
  name: string
  charset: string
  collation: string
  owner: string
  register: boolean
  ownerId: number | null
  notes: string
}

export const CREATE_FORM_DEFAULTS: CreateFormValues = {
  name: '',
  charset: '',
  collation: '',
  owner: '',
  register: false,
  ownerId: null,
  notes: '',
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Traduce los valores del formulario al payload de la API, omitiendo lo que el backend ignora
 * en cada modo: `owner` no se envía en MySQL/MariaDB (ignorado) ni con `register=true` (el
 * backend usa el username del ServerUser); `owner_id`/`notes` solo con `register=true`.
 */
export function buildCreateBody(values: CreateFormValues, engine: EngineType): DatabaseCreateIn {
  const body: DatabaseCreateIn = {
    name: values.name.trim(),
    charset: emptyToNull(values.charset),
    collation: emptyToNull(values.collation),
    register: values.register,
  }
  if (engineCopy(engine).showOwner && !values.register) {
    body.owner = emptyToNull(values.owner)
  }
  if (values.register) {
    body.owner_id = values.ownerId
    body.notes = emptyToNull(values.notes)
  }
  return body
}

// ── Cruce del listado físico con el inventario (§4.1) ───────────────────────

export interface ServerDatabaseRow {
  /** Nombre físico en el motor: la identidad real de la fila. */
  name: string
  /** `null` mientras el inventario no haya cargado o si la BD no está registrada. */
  managed: ManagedDatabaseOut | null
  isManaged: boolean
}

/**
 * Cruza `GET /servers/{id}/databases` (nombres físicos) con el inventario paginado. El listado
 * físico manda: una fila del inventario sin BD física no aparece aquí (eso es un huérfano, y su
 * sitio es la pantalla de reconciliación).
 */
export function crossWithInventory(
  physicalNames: readonly string[],
  inventory: readonly ManagedDatabaseOut[] | undefined,
): ServerDatabaseRow[] {
  const byName = new Map(inventory?.map((db) => [db.name, db]) ?? [])
  return physicalNames.map((name) => {
    const managed = byName.get(name) ?? null
    return { name, managed, isManaged: managed !== null }
  })
}

export type InventoryScope = 'all' | 'managed' | 'unmanaged'

export function filterDatabaseRows(
  rows: readonly ServerDatabaseRow[],
  filters: { search: string; scope: InventoryScope },
): ServerDatabaseRow[] {
  const needle = filters.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (needle.length > 0 && !row.name.toLowerCase().includes(needle)) return false
    if (filters.scope === 'managed' && !row.isManaged) return false
    if (filters.scope === 'unmanaged' && row.isManaged) return false
    return true
  })
}

// ── Filtros de la tabla de grantees (§4.3) ──────────────────────────────────

export type GranteeScope = 'all' | 'adopted' | 'unmanaged'

export function filterGrantees(
  grantees: readonly DatabaseGrantee[],
  filters: { search: string; onlyGlobal: boolean; scope: GranteeScope },
): DatabaseGrantee[] {
  const needle = filters.search.trim().toLowerCase()
  return grantees.filter((grantee) => {
    if (needle.length > 0) {
      const haystack = `${grantee.username} ${grantee.host ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (filters.onlyGlobal && !grantee.is_global) return false
    if (filters.scope !== 'all' && grantee.status !== filters.scope) return false
    return true
  })
}

/**
 * Privilegios que ameritan jerarquía visual: permiten destruir o redistribuir acceso. `OWNER`
 * es el pseudo-privilegio que PostgreSQL añade al dueño de la base.
 */
const DANGEROUS_PRIVILEGES = new Set([
  'ALL PRIVILEGES',
  'ALTER',
  'ALTER ROUTINE',
  'CREATE',
  'DROP',
  'GRANT OPTION',
  'OWNER',
  'REFERENCES',
  'SUPER',
  'TRUNCATE',
])

export function isDangerousPrivilege(privilege: string): boolean {
  return DANGEROUS_PRIVILEGES.has(privilege.trim().toUpperCase())
}

// ── Caducidad del `confirm_token` (§3.2, [SUPUESTO S2]) ─────────────────────

/**
 * La cuenta atrás vive en `lib/utils/countdown` desde que la consola SQL pasó a necesitar el
 * mismo mecanismo (`confirm_token` firmado con TTL). Se reexporta para no tocar los
 * consumidores ni los tests de esta feature.
 */
export { CLOCK_SKEW_MARGIN_MS, formatCountdown, remainingMs } from '@/lib/utils/countdown'

// ── Composición de mensajes de resultado (§4.5) ─────────────────────────────

/**
 * Notificación compuesta tras un borrado exitoso. `terminated_connections` solo se menciona si
 * es `> 0`: con `force_disconnect=false` vale 0 aunque hubiera conexiones, así que nombrarlo
 * siempre daría a entender que no había ninguna.
 */
export function buildDropSuccessDescription(result: DatabaseDropOut): string {
  const parts: string[] = []
  if (result.inventory_removed) parts.push('También se eliminó su registro del inventario.')
  const terminated = result.terminated_connections ?? 0
  if (terminated > 0) parts.push(`Se terminaron ${terminated} conexión(es) activa(s).`)
  return parts.join(' ')
}

/** Preselección de `force_disconnect`: solo donde las conexiones realmente bloquean el DROP. */
export function shouldPreselectForceDisconnect(
  engine: EngineType,
  activeConnections: number,
): boolean {
  return engineCopy(engine).connectionsBlockDrop && activeConnections > 0
}
