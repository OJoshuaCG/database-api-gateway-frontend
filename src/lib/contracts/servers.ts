import { z } from 'zod'
import { engineTypeSchema, serverStatusSchema, sslModeSchema } from './common'

/** `ssl_mode` de salida: el backend puede devolver `null` o cadena vacía ⇒ sin TLS. */
const sslModeOutputSchema = z.union([sslModeSchema, z.literal('')]).nullable()

/** `ServerOut` (§6). La credencial pseudo-root nunca se devuelve. */
export const serverOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  engine: engineTypeSchema,
  root_username: z.string(),
  ssl_mode: sslModeOutputSchema.optional(),
  status: serverStatusSchema,
  is_active: z.boolean(),
  notes: z.string().nullable().optional(),
  has_root_password: z.boolean(),
  /**
   * Credencial de SOLO LECTURA que usa el MCP para leer el catálogo del motor (api-reference-v30).
   * Ni el usuario ni la contraseña salen nunca: solo si existe y cuándo pasó la sonda negativa.
   * Opcional y no obligatorio: un backend anterior a v30 no los manda, y eso equivale a «sin
   * credencial», no a una respuesta rota. La UI lee la ausencia como `false`/`null`.
   */
  has_readonly_credential: z.boolean().optional(),
  /** UTC sin zona. `null` = sin verificar: el MCP no la usa hasta que la sonda pase. */
  readonly_verified_at: z.string().nullable().optional(),
  /**
   * `SELECT ON mysql.proc` (SERVER-WIDE) habilitado para la credencial de solo lectura, que es lo
   * único que deja al MCP leer el código de las rutinas en MariaDB < 11.3 y MySQL 5.7. Es un dato de
   * riesgo, no un secreto. Opcional: un backend anterior no lo manda y eso equivale a `false`.
   */
  readonly_proc_grant: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ServerOut = z.infer<typeof serverOutSchema>

/** `ServerCreate` (§6). */
export const serverCreateSchema = z.object({
  name: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  host: z.string().min(1, 'Requerido').max(255, 'Máximo 255 caracteres'),
  port: z.number().int().min(1, 'Puerto 1–65535').max(65535, 'Puerto 1–65535'),
  engine: engineTypeSchema,
  root_username: z.string().min(1, 'Requerido').max(128, 'Máximo 128 caracteres'),
  root_password: z.string().min(1, 'Requerido'),
  ssl_mode: sslModeSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})
export type ServerCreate = z.infer<typeof serverCreateSchema>

/** `ServerUpdate` — todos los campos opcionales; `root_password` omitido ⇒ no cambia. */
export const serverUpdateSchema = serverCreateSchema.partial()
export type ServerUpdate = z.infer<typeof serverUpdateSchema>

/** `ConnectionInfo` — resultado de `test-connection` 🔌 (§6). */
export const connectionInfoSchema = z.object({
  ok: z.boolean(),
  dialect: z.string(),
  server_version: z.string().nullable().optional(),
  /** Solo con `?credential=readonly`: el instante en que la sonda negativa quedó verificada. */
  readonly_verified_at: z.string().nullable().optional(),
})
export type ConnectionInfo = z.infer<typeof connectionInfoSchema>

/**
 * `PUT /servers/{id}/readonly-credential` (v30). El backend lo declara `extra="forbid"`: un campo
 * de más es 422, así que el cuerpo lleva exactamente estos dos.
 */
export const readonlyCredentialInSchema = z.object({
  username: z.string().trim().min(1, 'Requerido').max(128, 'Máximo 128 caracteres'),
  password: z.string().min(1, 'Requerido'),
})
export type ReadonlyCredentialIn = z.infer<typeof readonlyCredentialInSchema>

/**
 * Texto de acknowledgement que `PUT /servers/{id}/readonly-credential/routine-bodies` exige,
 * carácter por carácter, para HABILITAR la bandera (422 `ack_mismatch` si difiere). Deshabilitar no
 * lo necesita. Es copia literal de `READONLY_PROC_ACK_TEXT` en `app/services/server_catalog.py` del
 * backend: si cambia allá, cambia acá. El diálogo lo muestra tal cual y el usuario lo acepta con
 * una casilla; el cliente lo reenvía sin tocarlo.
 */
export const READONLY_PROC_ACK_TEXT =
  'Entiendo que SELECT ON mysql.proc es server-wide: expone el código de las rutinas de TODAS ' +
  'las bases de datos de este servidor, incluidas las que están fuera del proyecto o excluidas, ' +
  'y que solo el filtrado del gateway lo contiene.'

/**
 * Cuerpo de `PUT /servers/{id}/readonly-credential/routine-bodies`. El backend lo declara
 * `extra="forbid"`: el cuerpo lleva exactamente estos dos campos. `acknowledgement` solo se manda al
 * habilitar.
 */
export const readonlyProcGrantInSchema = z.object({
  enabled: z.boolean(),
  acknowledgement: z.string().nullable().optional(),
})
export type ReadonlyProcGrantIn = z.infer<typeof readonlyProcGrantInSchema>

/**
 * Qué pasó con los grants del motor al cambiar la bandera (`ReadonlyProcGrantOut.engine_grant`):
 *
 * - `converged`: la cuenta propia del gateway se re-aprovisionó y la sonda pasó.
 * - `not_alterable`: la credencial se cargó a mano; el gateway NO toca sus grants y solo re-corrió
 *   la sonda. Si el DBA no ajustó los grants, el servidor queda sin verificar.
 * - `no_credential`: el servidor no tiene credencial de solo lectura; solo cambió la bandera.
 */
export const procGrantEngineStateSchema = z.enum(['converged', 'not_alterable', 'no_credential'])
export type ProcGrantEngineState = z.infer<typeof procGrantEngineStateSchema>

/** `ReadonlyProcGrantOut`: el servidor ya actualizado y qué pasó en el motor. */
export const readonlyProcGrantOutSchema = z.object({
  server: serverOutSchema,
  engine_grant: procGrantEngineStateSchema,
})
export type ReadonlyProcGrantOut = z.infer<typeof readonlyProcGrantOutSchema>

/** Con qué credencial corre `test-connection`: la pseudo-root (default) o la de solo lectura. */
export type TestConnectionCredential = 'root' | 'readonly'
