import { z } from 'zod'

/**
 * Usuarios del GATEWAY: las identidades que se autentican contra este servicio (addendum de
 * identidades §2). Todo el módulo va detrás de `gateway.admin` salvo aceptar la invitación, que
 * es público.
 *
 * ⚠️ NO CONFUNDIR con los usuarios del MOTOR, que viven en `contracts/engine-users.ts` y
 * `contracts/server-users.ts`. El gateway tiene dos poblaciones de usuarios y usa las mismas
 * palabras para las dos: acá se administra quién entra al gateway; allá, quién existe dentro de
 * MySQL/MariaDB/PostgreSQL. No comparten ni identidad ni ciclo de vida.
 */

// ── Vocabularios ───────────────────────────────────────────────────────────────
/**
 * Roles base conocidos hoy. Se exportan como constante —y no solo como enum— porque alimentan el
 * selector del formulario cuando el backend todavía no devolvió un `allowed[]`.
 */
export const GATEWAY_ROLES = ['viewer', 'operator', 'owner'] as const
export const gatewayRoleSchema = z.enum(GATEWAY_ROLES)
export type GatewayRole = z.infer<typeof gatewayRoleSchema>

/** Capacidades globales conocidas hoy. Ninguna la otorga el rol `owner`: son independientes. */
export const GLOBAL_CAPABILITIES = ['access_admin', 'security_officer'] as const
export const globalCapabilitySchema = z.enum(GLOBAL_CAPABILITIES)
export type GlobalCapability = z.infer<typeof globalCapabilitySchema>

/** Tipos de alcance admitidos por `PUT /access`. El backend rechaza cualquier otro con 422. */
export const SCOPE_TYPES = ['environment', 'server'] as const
export const scopeTypeSchema = z.enum(SCOPE_TYPES)
export type ScopeType = z.infer<typeof scopeTypeSchema>

/**
 * ¿Por qué los vocabularios van `z.string()` en las respuestas y `z.enum` en las peticiones?
 *
 * En la RESPUESTA el vocabulario lo decide el backend y puede crecer sin desplegar la SPA. Un
 * `z.enum` duro ahí haría que un rol nuevo —o una capacidad nueva— tumbara el envelope entero y
 * desapareciera el listado COMPLETO de usuarios, no solo la fila rara (`apiRequest` valida todo
 * el envelope). Y `.catch('viewer')`, que es el degradado que usa `EnvironmentOut` para el color,
 * acá sería peor que fallar: mostraría a un `owner` como lector. Degradar decoración está bien;
 * degradar un nivel de privilegio es mentir sobre quién puede qué.
 *
 * En la PETICIÓN el vocabulario lo elegimos nosotros, así que el enum estricto sí corresponde:
 * atrapa en compilación un valor que el servidor rechazaría con un 422 sin detalle legible.
 */
const roleOutSchema = z.string()
const capabilityOutSchema = z.string()

/** ¿Es un rol de los que esta versión de la SPA sabe describir? */
export function isKnownGatewayRole(value: string): value is GatewayRole {
  return (GATEWAY_ROLES as readonly string[]).includes(value)
}

/** ¿Es una capacidad global de las que esta versión de la SPA sabe describir? */
export function isKnownGlobalCapability(value: string): value is GlobalCapability {
  return (GLOBAL_CAPABILITIES as readonly string[]).includes(value)
}

// ── Alcances ───────────────────────────────────────────────────────────────────
/**
 * Un grant REEMPLAZA al rol base dentro de su alcance; no se suma a él. O sea que puede BAJAR el
 * acceso: un `operator` con un grant `viewer` sobre producción es lector ahí y operador en todo lo
 * demás. Dos grants sobre el mismo destino resuelven al MÁS RESTRICTIVO. Presentarlos como
 * "permisos extra" comunicaría lo contrario de lo que hace el servidor.
 */
export const scopeGrantOutSchema = z.object({
  scope_type: z.string(),
  scope_id: z.number().int(),
  role: roleOutSchema,
})
export type ScopeGrantOut = z.infer<typeof scopeGrantOutSchema>

/** El mismo grant, de ida: acá sí con vocabulario cerrado. */
export const scopeGrantInSchema = z.object({
  scope_type: scopeTypeSchema,
  scope_id: z.number().int().min(1, 'Debe ser un id válido'),
  role: gatewayRoleSchema,
})
export type ScopeGrantIn = z.infer<typeof scopeGrantInSchema>

// ── Lectura ────────────────────────────────────────────────────────────────────
/**
 * `GatewayUserOut` (§2.1).
 *
 * `credential_set: false` es un ESTADO PROPIO, no un usuario roto ni desactivado: la cuenta
 * existe, tiene rol y accesos, `is_active` sigue en `true` — y no puede iniciar sesión, porque
 * nadie fijó todavía la contraseña. Pintarlo igual que al resto hace que un administrador crea
 * que la persona ya tiene acceso, y el error se descubre recién cuando esa persona avisa que no
 * puede entrar.
 *
 * `notes` NO está acá aunque el alta y el PATCH lo acepten: es un defecto de contrato conocido
 * (§2.8). Ver `GATEWAY_USER_WRITE_ONLY_FIELDS`.
 */
export const gatewayUserOutSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  /**
   * El servidor lo RELLENA con `{username}@gateway.local` si el alta lo omite (§2.8), así que
   * puede ser una dirección sintética que nadie escribió y que no recibe correo. La UI la marca
   * como «sin correo declarado» en vez de presentarla como dato de contacto: ver
   * `isSyntheticGatewayEmail`.
   */
  email: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  gateway_role: roleOutSchema,
  is_active: z.boolean(),
  credential_set: z.boolean(),
  global_capabilities: z.array(capabilityOutSchema).optional().default([]),
  scope_grants: z.array(scopeGrantOutSchema).optional().default([]),
  last_login_at: z.string().nullable().optional(),
  previous_login_at: z.string().nullable().optional(),
  last_failed_at: z.string().nullable().optional(),
  created_at: z.string(),
})
export type GatewayUserOut = z.infer<typeof gatewayUserOutSchema>

/** Dominio con el que el backend fabrica el correo cuando el alta no declara uno (§2.8). */
export const SYNTHETIC_EMAIL_DOMAIN = '@gateway.local'

/**
 * ¿El correo lo escribió una persona, o lo fabricó el servidor? Se compara contra el `username`
 * además del dominio: alguien podría tener de verdad una casilla en ese dominio, y marcársela
 * como inexistente sería igual de engañoso que el defecto que esto intenta señalar.
 */
export function isSyntheticGatewayEmail(user: GatewayUserOut): boolean {
  return user.email === `${user.username}${SYNTHETIC_EMAIL_DOMAIN}`
}

/**
 * `GatewayUserCreatedOut` (§2.3) — `GatewayUserOut` MÁS el token de invitación.
 *
 * ⚠️ El token viaja acá y en NINGUNA otra respuesta. El gateway no tiene sustrato de
 * notificación —ni SMTP, ni webhook, ni cola—, así que no se envía por ningún canal, y no existe
 * endpoint que lo vuelva a mostrar. Si la pantalla no lo muestra y no deja copiarlo, la cuenta
 * queda inutilizable y la única salida es reinvitar.
 */
export const gatewayUserCreatedOutSchema = gatewayUserOutSchema.extend({
  invite_token: z.string(),
  invite_expires_at: z.string(),
})
export type GatewayUserCreatedOut = z.infer<typeof gatewayUserCreatedOutSchema>

/** `POST /{user_id}/invite` (§2.7) — reemitir sube el `credential_epoch` e invalida la anterior. */
export const gatewayUserInviteOutSchema = z.object({
  invite_token: z.string(),
  invite_expires_at: z.string(),
})
export type GatewayUserInviteOut = z.infer<typeof gatewayUserInviteOutSchema>

/** `POST /invite/accept` (§2.4) — lo único que devuelve. No abre sesión. */
export const acceptInviteOutSchema = z.object({
  username: z.string(),
})
export type AcceptInviteOut = z.infer<typeof acceptInviteOutSchema>

// ── Escritura ──────────────────────────────────────────────────────────────────
export const GATEWAY_USERNAME_MIN = 2
export const GATEWAY_USERNAME_MAX = 40
export const GATEWAY_EMAIL_MAX = 255
export const GATEWAY_FULL_NAME_MAX = 150
export const GATEWAY_PASSWORD_MIN = 12
export const GATEWAY_PASSWORD_MAX = 200
export const GATEWAY_INVITE_TOKEN_MIN = 8

/**
 * Patrón de `username`: minúsculas, dígitos, punto, guion y guion bajo, empezando y terminando en
 * letra o dígito.
 *
 * ⚠️ El patrón y el rango declarado NO coinciden, y gana el patrón. El addendum dice «2–40», pero
 * el grupo opcional exige un carácter intermedio MÁS uno final, así que la regex acepta longitud
 * 1 o 3–40 y **rechaza 2**. Aplicamos las dos validaciones y el resultado es su intersección:
 * 3–40. Se hace del lado del cliente porque el 422 del servidor no es máquina-legible en
 * producción (§6): su detalle por campo viaja en `context`, que solo existe en `development`.
 */
export const GATEWAY_USERNAME_PATTERN = /^[a-z0-9]([a-z0-9._-]{1,38}[a-z0-9])?$/

/**
 * `GatewayUserCreate` (§2.2).
 *
 * **No hay campo de contraseña, y no es un olvido.** Si quien crea la cuenta tipeara la
 * credencial inicial, conocería una contraseña funcional de esa identidad, y con eso toda fila de
 * auditoría atribuida a esa persona sería repudiable — para un sistema cuyo valor central es el
 * rastro, eso es fatal. Un «cambio forzado en el primer login» no lo arregla: quien la puso pudo
 * haber entrado antes. Con `access_admin` en el modelo deja de ser solo repudio y pasa a ser la
 * vía de escalada: crear una identidad `owner`, conocer su contraseña y operar producción con la
 * cara de otro. Un formulario que pida «contraseña inicial» NO se puede construir contra esta API.
 */
export const gatewayUserCreateSchema = z.object({
  username: z
    .string()
    .min(GATEWAY_USERNAME_MIN, 'Requerido')
    .max(GATEWAY_USERNAME_MAX, `Máximo ${GATEWAY_USERNAME_MAX} caracteres`)
    .regex(
      GATEWAY_USERNAME_PATTERN,
      'Solo minúsculas, dígitos, punto, guion y guion bajo. Tiene que empezar y terminar en letra o dígito, y medir 3 caracteres o más.',
    ),
  email: z
    .string()
    .email('Correo no válido')
    .max(GATEWAY_EMAIL_MAX, `Máximo ${GATEWAY_EMAIL_MAX} caracteres`)
    .nullable()
    .optional(),
  full_name: z
    .string()
    .max(GATEWAY_FULL_NAME_MAX, `Máximo ${GATEWAY_FULL_NAME_MAX} caracteres`)
    .nullable()
    .optional(),
  /** Se ACEPTA pero no se devuelve nunca (§2.8). Ver `GATEWAY_USER_WRITE_ONLY_FIELDS`. */
  notes: z.string().nullable().optional(),
  gateway_role: gatewayRoleSchema.optional(),
  global_capabilities: z.array(globalCapabilitySchema).optional(),
})
export type GatewayUserCreate = z.infer<typeof gatewayUserCreateSchema>

/**
 * `GatewayUserUpdate` (§2.5). `exclude_unset`: lo que no se envía no cambia.
 *
 * **`username` no está, y no hay endpoint que lo edite.** Es la identidad que se audita, y
 * `audit_log` la guarda desnormalizada y sin FK: renombrar al usuario reescribiría retroactivamente
 * el significado de todas las filas viejas, que seguirían nombrando al usuario anterior. En la UI
 * el campo va deshabilitado con el motivo a la vista — ofrecerlo como editable y fallar después es
 * peor que no ofrecerlo.
 */
export const gatewayUserUpdateSchema = z.object({
  email: z
    .string()
    .email('Correo no válido')
    .max(GATEWAY_EMAIL_MAX, `Máximo ${GATEWAY_EMAIL_MAX} caracteres`)
    .nullable()
    .optional(),
  full_name: z
    .string()
    .max(GATEWAY_FULL_NAME_MAX, `Máximo ${GATEWAY_FULL_NAME_MAX} caracteres`)
    .nullable()
    .optional(),
  notes: z.string().nullable().optional(),
  gateway_role: gatewayRoleSchema.optional(),
  is_active: z.boolean().optional(),
})
export type GatewayUserUpdate = z.infer<typeof gatewayUserUpdateSchema>

/**
 * Campos que la API ACEPTA y nunca devuelve (§2.8). No es diseño: es una diferencia entre lo que
 * entra y lo que sale, y muerde a un formulario.
 *
 * `notes` se escribe en el alta y en el PATCH, y no está en `GatewayUserOut`. Un formulario que lo
 * muestre lo va a recibir vacío en cada recarga, lo va a reenviar vacío, y el valor anterior se
 * pierde SIN QUE NADA FALLE. Por eso la UI no lo pone en el formulario de edición: hasta que el
 * campo exista en la respuesta, la única forma segura de tratarlo es no reenviarlo jamás con el
 * valor leído.
 */
export const GATEWAY_USER_WRITE_ONLY_FIELDS = ['notes'] as const

/**
 * `PUT /{user_id}/access` (§2.6) — **REEMPLAZO TOTAL, no incremental.**
 *
 * ⚠️ Los dos campos tienen `default_factory=list` del lado del servidor, así que omitir uno
 * equivale a enviarlo vacío, y enviarlo vacío REVOCA todo. No hay diferencia entre «no lo mandé» y
 * «quiero que quede sin nada»: un PUT con solo `global_capabilities` borra todos los alcances de
 * la persona, en silencio y con 200.
 *
 * Por eso los dos campos son OBLIGATORIOS en este schema aunque la API los acepte ausentes: el
 * tipo obliga a construir el cuerpo entero, y un formulario que mande solo la sección que el
 * usuario tocó no compila. La única forma segura de usar el endpoint es leer el estado actual,
 * modificarlo completo y reenviarlo completo.
 */
export const gatewayUserAccessUpdateSchema = z.object({
  global_capabilities: z.array(globalCapabilitySchema),
  scope_grants: z.array(scopeGrantInSchema),
})
export type GatewayUserAccessUpdate = z.infer<typeof gatewayUserAccessUpdateSchema>

/**
 * `POST /invite/accept` (§2.4) — público: sin cookie de sesión y sin CSRF.
 *
 * El `user_id` viaja DENTRO del token firmado, no como parámetro ni en la URL, así que la pantalla
 * solo necesita el token. El largo de la contraseña se valida acá porque el rechazo del servidor
 * sale como 422 de Pydantic SIN `public_context` (§6) — `gateway_user.weak_password` es la red de
 * contención, no la vía normal.
 */
export const acceptInviteInSchema = z.object({
  token: z.string().min(GATEWAY_INVITE_TOKEN_MIN, 'El token de invitación es demasiado corto'),
  password: z
    .string()
    .min(GATEWAY_PASSWORD_MIN, `Mínimo ${GATEWAY_PASSWORD_MIN} caracteres`)
    .max(GATEWAY_PASSWORD_MAX, `Máximo ${GATEWAY_PASSWORD_MAX} caracteres`),
})
export type AcceptInviteIn = z.infer<typeof acceptInviteInSchema>

// ── Códigos de error (§2.9) ────────────────────────────────────────────────────
/**
 * Todos llegan en `detail.public_context.code`.
 *
 * ⚠️ `notFound` llega con DOS status distintos y significan cosas distintas: 404 es «ese id no
 * existe» (refrescar el listado) y 422 es «esta invitación no sirve» (pedir otra). Un cliente que
 * enrute solo por `code` muestra el mensaje equivocado en uno de los dos casos: hay que mirar
 * `code` **y** status. Ver `gatewayUserErrorMessage`.
 *
 * ⚠️ `invalidGlobalCapability` está mal nombrado y cubre dos errores distintos: la capacidad
 * global inválida (que trae `public_context.allowed[]`) y un `scope_type` inválido en `PUT /access`
 * (que **no trae `allowed` en absoluto**). Un cliente que asuma que el campo siempre está rompe en
 * ese caso.
 */
export const GATEWAY_USER_ERROR_CODES = {
  lastAdminProtected: 'access.last_admin_protected',
  notFound: 'gateway_user.not_found',
  usernameTaken: 'gateway_user.username_taken',
  credentialAlreadySet: 'gateway_user.credential_already_set',
  invalidRole: 'gateway_user.invalid_role',
  invalidGlobalCapability: 'gateway_user.invalid_global_capability',
  weakPassword: 'gateway_user.weak_password',
} as const
