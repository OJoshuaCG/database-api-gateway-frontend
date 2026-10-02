import { z } from 'zod'
import { myCapabilityGrantSchema } from './capability-grants'

/**
 * Autenticación y contrato de autorización (api-reference-v23).
 *
 * Antes un endpoint solo exigía **sesión válida**: quien entraba podía todo. Ahora cada endpoint
 * declara una capacidad de un vocabulario cerrado y el servidor la exige, así que existe una
 * respuesta 403 donde antes no podía haberla.
 */

// ── Alcances y roles ───────────────────────────────────────────────────────────
/**
 * Eje sobre el que se otorga un rol. `global` no aparece en `scope_roles` —un rol global ES
 * `role`— pero sí en el `scope_axis` del catálogo.
 */
export const AUTHZ_SCOPE_AXES = ['global', 'environment', 'server'] as const
export const authzScopeAxisSchema = z.enum(AUTHZ_SCOPE_AXES)
export type AuthzScopeAxis = z.infer<typeof authzScopeAxisSchema>

/**
 * Rol sobre un alcance concreto. `role` va `z.string()` y no `z.enum` por la misma razón que en
 * `contracts/gateway-users.ts`: el vocabulario lo decide el backend y un rol nuevo no debe tumbar
 * la respuesta de `/auth/me`, que es la que sostiene la sesión entera.
 */
export const scopeRoleSchema = z.object({
  scope_type: z.string(),
  scope_id: z.number().int(),
  role: z.string(),
})
export type ScopeRole = z.infer<typeof scopeRoleSchema>

// ── `/auth/me` ─────────────────────────────────────────────────────────────────
/**
 * `AdminOut` — el usuario autenticado y **con qué decidir la UI** (§1).
 *
 * Son ONCE campos, no ocho: `previous_login_at` y `last_failed_at` entran acá aunque el §7.4 los
 * describa aparte, y `base_role` llegó después. Tipar este schema desde un ejemplo recortado es exactamente cómo se dispara el
 * `safeParse` que el propio documento advierte.
 *
 * Todo lo nuevo va **nullish con default**, nunca `.optional()` a secas: así un backend viejo —que
 * devuelve solo `id` y `username`— sigue validando y la UI cae al lado seguro (sin capacidades)
 * en vez de romper la sesión entera.
 *
 * ⚠️ **`capabilities` es una PISTA DE UI. Decide el servidor, siempre.** Ocultar un botón no es
 * autorización: es cortesía. Se deriva del mismo predicado que hace cumplir el backend, así que
 * sirve para no llevar al usuario hasta un 403 — no para reemplazarlo.
 *
 * `last_login_at` NO está acá a propósito: cuando la SPA pide `/auth/me`, el último login es el que
 * está en curso. Ese campo vive en `GatewayUserOut`.
 */
export const adminOutSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  /** Rol efectivo = el máximo sobre todos los alcances. */
  role: z.string().nullish(),
  /**
   * Rol BASE: el que rige donde ningún permiso por alcance aplica. `role` sigue siendo el efectivo
   * (la unión) por compatibilidad. Nullish porque un backend anterior no lo manda.
   */
  base_role: z.string().nullish(),
  /** Las capacidades EFECTIVAS. Única fuente para habilitar o deshabilitar controles. */
  capabilities: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  global_capabilities: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  scope_roles: z
    .array(scopeRoleSchema)
    .nullish()
    .transform((value) => value ?? []),
  /**
   * Capacidades que van a pedir reautenticación. **Se publican y todavía NO se exigen** (§1/§6):
   * el mecanismo de step-up es una fase posterior. No construir ningún flujo que dependa de que el
   * servidor rechace por falta de step-up, porque hoy no lo hace — sirve solo para poder avisar
   * antes de mandar la operación.
   */
  step_up_capabilities: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  /**
   * Capacidades puntuales VIVAS (`pending` | `active`) de la propia persona, y solo las suyas. Las
   * activas ya están sumadas en `capabilities`; las pendientes no conceden nada todavía.
   * Nullish con default: un backend anterior a las capacidades puntuales no lo manda.
   */
  capability_grants: z
    .array(myCapabilityGrantSchema)
    .nullish()
    .transform((value) => value ?? []),
  /** El login ANTERIOR al actual (§7.4). El actual es el que está en curso. */
  previous_login_at: z.string().nullish(),
  last_failed_at: z.string().nullish(),
  /** sha256 corto del catálogo. Cambia cuando cambia el catálogo: es la clave de caché. */
  catalog_version: z.string().nullish(),
})
export type AdminOut = z.infer<typeof adminOutSchema>

/** `LoginIn` — credenciales de login (§5). */
export const loginInSchema = z.object({
  username: z.string().min(1, 'Requerido').max(128, 'Máximo 128 caracteres'),
  password: z.string().min(1, 'Requerido'),
})
export type LoginIn = z.infer<typeof loginInSchema>

// ── Cambio de la contraseña propia (`POST /auth/password`) ─────────────────────
/**
 * `PasswordChangeIn` — lo que viaja al backend. El schema del backend solo exige 1–200 en
 * `new_password` a propósito: el mínimo real lo aplica la política compartida con la invitación y
 * responde `gateway_user.weak_password` con `min_length`. El formulario valida el mínimo antes
 * (con `GATEWAY_PASSWORD_MIN`) para no gastar un intento del rate limit en algo que ya se sabe.
 */
export interface PasswordChangeIn {
  current_password: string
  new_password: string
}

/**
 * `PasswordChangeOut` — cuántas sesiones OTRAS que la actual se cerraron. La actual también se
 * cierra, pero la misma respuesta abre una nueva (el `sid` rota y con él la cookie CSRF), así que
 * para quien cambió la contraseña la pestaña sigue funcionando.
 */
export const passwordChangeOutSchema = z.object({
  revoked_sessions: z.number().int().nonnegative(),
})
export type PasswordChangeOut = z.infer<typeof passwordChangeOutSchema>

// ── Catálogo de capacidades (§2) ───────────────────────────────────────────────
/**
 * Una fila del catálogo (`GET /authz/catalog`, detrás de `self.read` = cualquier sesión).
 *
 * ⚠️ **`mutates` y `discloses` son ejes INDEPENDIENTES**, y agrupar por «peligrosidad» mirando
 * solo `mutates` es el error que este contrato invita a cometer: `exports.download`,
 * `engine_users.secrets`, `blueprints.captures`, `clones.execute` y `sql_console.execute` no
 * destruyen nada y **divulgan**. Una pantalla que las pinte como inofensivas está mintiendo.
 */
export const capabilityDescriptorSchema = z.object({
  id: z.string(),
  module: z.string(),
  level: z.string(),
  /** Etiqueta en español, ya lista para mostrar: no la fabrica el cliente. */
  label: z.string(),
  mutates: z.boolean(),
  discloses: z.boolean(),
  requires_step_up: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  /** Techo de lo que puede vivir en un token del servidor MCP. */
  agent_allowed: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  scope_axis: z.string().nullish(),
  roles: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  global_capabilities: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  /**
   * Destruye o cambia de forma irreversible datos o estructura del tercero. NO es un tercer eje:
   * es un subconjunto de `mutates` (en el backend, destructiva ⇒ solo `owner` y con step-up).
   *
   * `null` = el backend no manda la columna (uno viejo). Se conserva la AUSENCIA en vez de caer a
   * `false` porque no es lo mismo «no es destructiva» que «no sé»: `isDestructive` lee esta marca
   * cuando viene y, si no, cae a `DESTRUCTIVE_CAPABILITIES`.
   */
  destructive: z
    .boolean()
    .nullish()
    .transform((value) => value ?? null),
  /**
   * Predicados de las capacidades puntuales. Con default seguro para un backend viejo: sin la
   * columna, nada es otorgable (no se ofrece), nada es sensible y no implica lecturas.
   */
  grantable: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  /** Exige un segundo aprobador al otorgarla de forma puntual. */
  sensitive: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  /** Lecturas que trae implícitas cuando se otorga de forma puntual. */
  implies: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
})
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>

// ── Sesiones vivas (§7.4) ──────────────────────────────────────────────────────
/**
 * Una sesión viva del propio usuario (`GET /auth/sessions`).
 *
 * `sid_prefix` es un PREFIJO y nunca el identificador completo: el identificador de sesión es la
 * credencial, y publicarlo entero convertiría esta pantalla en el robo de sesión que pretende
 * ayudar a detectar.
 */
export const sessionInfoSchema = z.object({
  sid_prefix: z.string(),
  current: z.boolean(),
  created_at: z.string(),
  last_seen_at: z.string().nullish(),
  ip: z.string().nullish(),
})
export type SessionInfo = z.infer<typeof sessionInfoSchema>

// ── El vocabulario de capacidades (§5) ─────────────────────────────────────────
/**
 * Las 30 capacidades, para que la UI no use strings sueltos. La **autoridad sigue siendo el
 * catálogo del servidor** (`GET /authz/catalog`): esto es una comodidad de tipado y un punto único
 * donde corregir si el vocabulario cambia, no una segunda fuente de verdad.
 *
 * 🔓 marca las que **divulgan** (`discloses: true`). Es un eje INDEPENDIENTE de `mutates`: ninguna
 * de esas cinco destruye nada, y todas exponen datos o credenciales.
 */
export const CAPABILITIES = {
  selfRead: 'self.read',

  serversRead: 'servers.read',
  /** Ni `owner` la tiene: editar un servidor puede re-apuntar un `server_id` a otro host. */
  serversAdmin: 'servers.admin',

  engineUsersRead: 'engine_users.read',
  engineUsersWrite: 'engine_users.write',
  engineUsersDrop: 'engine_users.drop',
  /** 🔓 */
  engineUsersSecrets: 'engine_users.secrets',

  databasesRead: 'databases.read',
  databasesWrite: 'databases.write',
  databasesDrop: 'databases.drop',

  blueprintsRead: 'blueprints.read',
  blueprintsWrite: 'blueprints.write',
  blueprintsApply: 'blueprints.apply',
  /** 🔓 */
  blueprintsCaptures: 'blueprints.captures',

  schemaDiffRead: 'schema_diff.read',
  schemaDiffExecute: 'schema_diff.execute',

  clonesRead: 'clones.read',
  /** 🔓 — un clon COPIA DATOS: meter producción en un entorno de desarrollo es divulgación. */
  clonesExecute: 'clones.execute',

  collationRead: 'collation.read',
  collationExecute: 'collation.execute',

  exportsRead: 'exports.read',
  exportsExecute: 'exports.execute',
  /** 🔓 */
  exportsDownload: 'exports.download',

  sqlConsoleHistory: 'sql_console.history',
  /** 🔓 */
  sqlConsoleExecute: 'sql_console.execute',

  catalogsRead: 'catalogs.read',
  /** Ni `owner`: toda fila que un guard lee es una frontera de privilegio. */
  catalogsWrite: 'catalogs.write',

  environmentsRead: 'environments.read',
  /**
   * Solo `security_officer`: crear, editar y borrar entornos, abrir bases a agentes y reclasificar
   * una base. Sin nadie con `security_officer` esas escrituras quedan BLOQUEADAS (no hay
   * fallback a `gateway.admin`).
   */
  environmentsWrite: 'environments.write',

  gatewayAdmin: 'gateway.admin',
} as const

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

/**
 * Las capacidades que **borran o cambian algo en un motor real y no se deshacen**. Dos borran
 * (`*.drop`) y cinco ejecutan DDL, SQL o una copia sobre el motor —un clon puede vaciar el destino
 * con `clean_mode`, y una conversión de collation reescribe tablas enteras—. Lo que solo toca el
 * inventario o la configuración del gateway queda fuera: eso es «modifica», no «destructiva».
 *
 * **Es solo el RESPALDO de un backend que no publica la marca.** La fuente es la columna
 * `destructive` del catálogo, y `isDestructive` la lee cuando viene. Desde que `collation.execute`
 * pasó a ser solo de `owner` (v23 §5) el backend la marca también, así que las dos coinciden: son
 * las siete de `capability_catalog.py`. Esta lista solo decide con un catálogo sin la columna.
 */
export const DESTRUCTIVE_CAPABILITIES = [
  CAPABILITIES.databasesDrop,
  CAPABILITIES.engineUsersDrop,
  CAPABILITIES.blueprintsApply,
  CAPABILITIES.schemaDiffExecute,
  CAPABILITIES.clonesExecute,
  CAPABILITIES.collationExecute,
  CAPABILITIES.sqlConsoleExecute,
] as const satisfies readonly Capability[]

/**
 * Los endpoints donde un PARÁMETRO, o una segunda capacidad, sube el requisito (§4 y §6.6).
 *
 * Son ocho. Cinco dependen de un parámetro (encender la captura, sembrar datos, los dos
 * `drop_remote` y el `provision` de reasignar el dueño), uno de un flag del alta
 * (`apply_migrations`) y dos son acciones que crean una versión de blueprint DESDE OTRO MÓDULO y
 * por eso exigen `blueprints.write` además de la propia (adoptar un diff, registrar un lote de
 * collation como versión; este último, además, la STAMPEA en cada base, así que suma
 * `blueprints.apply`). Son los que la UI tiene que reflejar deshabilitando el control concreto,
 * porque el usuario ya está en la pantalla y el 403 llegaría recién al enviar — después de haber
 * llenado el formulario.
 *
 * **Apagar la captura no pide nada extra: solo encenderla.** Modelarlo al revés dejaría a un
 * operador sin poder desactivar algo que sí puede desactivar.
 */
export const CAPABILITY_ESCALATIONS = {
  /** `data_tables` (datos-semilla) en `POST /database-models/from-snapshot`. */
  snapshotDataTables: CAPABILITIES.blueprintsCaptures,
  /** `capture_selects: true` al crear o editar una versión de blueprint. */
  captureSelects: CAPABILITIES.blueprintsCaptures,
  /** `drop_remote=true` en `DELETE /managed-databases/{id}`. */
  dropManagedDatabaseRemote: CAPABILITIES.databasesDrop,
  /** `drop_remote=true` en `DELETE /server-users/{id}`. */
  dropServerUserRemote: CAPABILITIES.engineUsersDrop,
  /** `apply_migrations=true` en `POST /managed-databases`: el alta pasa a ejecutar migraciones. */
  createWithApplyMigrations: CAPABILITIES.blueprintsApply,
  /** `POST /schema-comparisons/{id}/adopt`: además de `schema_diff.execute`. */
  schemaDiffAdopt: CAPABILITIES.blueprintsWrite,
  /**
   * `provision=true` en `POST /managed-databases/{id}/reassign-owner`, EN la base: entregar el
   * control del motor (`ALTER DATABASE … OWNER TO`, o el re-GRANT de `ALL PRIVILEGES`) equivale a
   * poder borrarla. Sin `provision` basta `databases.write`.
   */
  reassignOwnerProvision: CAPABILITIES.databasesDrop,
  /**
   * `POST .../collation-batches/{id}/blueprint-version`: además de `collation.execute`, crear la
   * versión (`blueprints.write`) y stampearla en cada base del blueprint (`blueprints.apply`).
   */
  collationBlueprintVersion: [CAPABILITIES.blueprintsWrite, CAPABILITIES.blueprintsApply],
} as const satisfies Record<string, Capability | readonly Capability[]>

// ── Alcance por destino (§8) ───────────────────────────────────────────────────
/** Una fila por servidor de `GET /authz/scope-readiness`. */
export const scopeReadinessServerSchema = z.object({
  server_id: z.number().int(),
  server_name: z.string(),
  engine: z.string(),
  databases: z.number().int(),
  unclassified: z.number().int(),
  /** Entorno al que resuelven sus bases sin clasificar. */
  derived_environment_slug: z.string().nullish(),
  /**
   * `true` = este servidor tiene bases sin `environment_id`, así que su entorno derivado sale del
   * hueco y no de una decisión de nadie. Son exactamente las filas que hay que arreglar.
   */
  derived_from_gap: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
})
export type ScopeReadinessServer = z.infer<typeof scopeReadinessServerSchema>

/**
 * `GET /authz/scope-readiness` (§8, detrás de `gateway.admin`) — **se consulta ANTES de otorgar el
 * primer acceso por alcance.**
 *
 * Por qué existe, que es lo contraintuitivo: una base sin `environment_id` **no** resuelve al
 * entorno por defecto —ése es el más permisivo— sino al **más protegido**. Así que otorgar «lector
 * en producción» también le saca a esa persona el acceso a toda base que nadie clasificó. Sin esta
 * consulta, el administrador otorga un acceso creyendo que amplía y en realidad recorta.
 *
 * `ready: true` dice que se puede otorgar sin sorpresas; `derived_from_gap` marca qué arreglar.
 */
export const scopeReadinessSchema = z.object({
  total_databases: z.number().int(),
  unclassified_databases: z.number().int(),
  ready: z.boolean(),
  fallback_environment_slug: z.string().nullish(),
  /**
   * F-17. `true` = el entorno de un SERVIDOR se resuelve solo con las bases que el gateway tiene
   * inventariadas: una base que existe en el motor pero nadie adoptó no cuenta para la regla del
   * entorno más protegido, y el gateway no lista el motor mientras autoriza. Un backend anterior
   * no lo manda: cae a `false` (no se muestra el aviso) en vez de romper la respuesta.
   */
  server_resolution_inventory_only: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  servers: z
    .array(scopeReadinessServerSchema)
    .nullish()
    .transform((value) => value ?? []),
})
export type ScopeReadiness = z.infer<typeof scopeReadinessSchema>

// ── Códigos de error ───────────────────────────────────────────────────────────
/**
 * Códigos de `public_context.code` de los 403 de CSRF (§7.1).
 *
 * El token se deriva del identificador de sesión y el servidor lo **recomputa**: no es
 * double-submit. Ante `csrfInvalid`, el arreglo NUNCA es escribir la cookie desde JS.
 */
export const AUTH_CSRF_ERROR_CODES = {
  missing: 'auth.csrf_missing',
  invalid: 'auth.csrf_invalid',
  originRejected: 'auth.origin_rejected',
} as const

/**
 * Códigos de los 401 de sesión (§7.3). **La sesión ahora vence de verdad.**
 *
 * `sessionAbsolute` es el que va a sorprender: antes la sesión no expiraba nunca mientras hubiera
 * actividad, y ahora caduca a las 12 h del login **haya habido actividad o no**. Una SPA que asuma
 * «si el usuario está usando la app, la sesión sigue viva» lo va a tirar al login a mitad de una
 * operación.
 */
export const AUTH_SESSION_ERROR_CODES = {
  absolute: 'auth.session_absolute',
  idle: 'auth.session_idle',
  logout: 'auth.session_logout',
  passwordChange: 'auth.session_password_change',
  roleChange: 'auth.session_role_change',
  adminRevoked: 'auth.session_admin_revoked',
  unknown: 'auth.session_unknown',
  missing: 'auth.session_missing',
} as const

/**
 * Códigos de los 422 de `POST /auth/password`. El tercero posible, `gateway_user.weak_password`
 * (con `min_length`), es el mismo de la invitación y vive en `GATEWAY_USER_ERROR_CODES`.
 *
 * `invalidCurrentPassword` es un 422 y NO un 401 a propósito: la sesión sigue siendo válida, y un
 * 401 dispararía el cierre de sesión global de la SPA.
 */
export const AUTH_PASSWORD_ERROR_CODES = {
  invalidCurrentPassword: 'auth.invalid_current_password',
  passwordUnchanged: 'auth.password_unchanged',
} as const

/** El 403 de autorización (§3). Es CERRADO y **no nombra la capacidad que falta**, a propósito:
 * decir «falta `servers.admin`» le daría a un atacante un mapa de la superficie por fuerza bruta
 * de 403. No intentes parsear qué faltó — usá `capabilities` para no llegar hasta acá. */
export const ACCESS_FORBIDDEN_CODE = 'access.forbidden'
