import { z } from 'zod'
import {
  engineTypeSchema,
  migrationKindSchema,
  MIGRATION_VERSION_PATTERN,
  migrationStatusSchema,
} from './common'

/**
 * Migraciones de blueprint (§8): deltas SQL versionados por blueprint. CRUD de inventario;
 * la aplicación real sobre cada BD vive en §9 (db-migrations). El SQL base se escribe en
 * estilo MySQL y el gateway lo auto-traduce a PostgreSQL (`translated`).
 */

const SQL_MAX = 262144 // 256 KB

/**
 * Traducción cross-engine calculada por el gateway. Claves no garantizadas: en migraciones
 * `kind: 'data'` o baselines de snapshot atados a un `source_engine`, o cuando `sqlglot` no
 * logra transpilar el SQL, el motor contrario queda ausente (no `null`, directamente sin clave).
 */
export const migrationTranslatedSchema = z.object({
  mysql: z.string().optional(),
  postgresql: z.string().optional(),
})
export type MigrationTranslated = z.infer<typeof migrationTranslatedSchema>

/**
 * Motivo por el que una versión está restringida (api-reference-v18 §5).
 *
 * El vocabulario que v18 declara es **`'in_use' | 'partial' | null`**: `not_tip` desapareció
 * porque borrar dejó de exigir ser la punta, y `applied` nunca llegó a estar en v18. Los dos se
 * conservan aquí a propósito, y no porque el contrato los use.
 *
 * El motivo es que un `z.enum` **rechaza el valor desconocido y con él la respuesta ENTERA del
 * listado**: apuntar contra un gateway sin actualizar dejaría la pantalla de versiones en blanco
 * —"La API devolvió una respuesta inesperada."— por un texto de ayuda que solo matiza un botón ya
 * deshabilitado por `deletable`. Aceptar los dos valores legado cuesta dos strings; no aceptarlos
 * cuesta la pantalla.
 */
export const migrationBlockReasonSchema = z.enum(['in_use', 'partial', 'applied', 'not_tip'])
export type MigrationBlockReason = z.infer<typeof migrationBlockReasonSchema>

/**
 * Banderas de política que el backend calcula y publica (§8).
 *
 * Son la DECISIÓN, no sus insumos: el backend no manda «en cuántas BDs se aplicó» para que el
 * cliente deduzca la regla, porque entonces la misma política viviría escrita a los dos lados
 * del contrato y se desincronizarían. Con esto la UI puede bloquear el campo *antes* de que se
 * escriba, en vez de rechazarlo al guardar.
 *
 * Los tres son opcionales con default permisivo: un backend anterior a este contrato no los
 * envía, y en ese caso la UI se comporta como antes (todo editable, el 409 sigue de red).
 */
const migrationPolicyFields = {
  sql_frozen: z.boolean().optional().default(false),
  deletable: z.boolean().optional().default(true),
  block_reason: migrationBlockReasonSchema.nullable().optional(),
  /**
   * Borrar esta versión implicaría **escribir en el motor** de alguna BD (api-reference-v18 §5):
   * mover el puntero de versión de las bases que están más adelante, para que el renumerado no
   * las deje apuntando a una versión que ya no existe.
   *
   * Es una **pista de caché, no un veredicto**. Sale del inventario del gateway, que puede estar
   * rancio; el veredicto autoritativo —el que abre conexión a cada BD— lo da
   * `GET .../migrations/{version}/delete-plan`. Sirve para elegir QUÉ diálogo abrir (el simple o
   * el que muestra el plan de stamps), nunca para decidir si la operación va a proceder.
   *
   * La divergencia entre la pista y el plan siempre va en la misma dirección: el listado ofrece el
   * botón y el plan lo rechaza. Nunca al revés, porque el plan lee la realidad de ahora y la
   * caché solo puede quedarse corta. Por eso el flujo es «abrir el diálogo → pedir el plan →
   * obedecer al plan», y no «confiar en la bandera».
   */
  delete_requires_stamps: z.boolean().optional().default(false),
}

/**
 * Hechos derivados del SQL, para las insignias del listado (api-reference-v11).
 *
 * El backend los calcula con heurísticas de texto —baratas, se pagan por fila— y no con el
 * análisis completo: parsear hasta 256 KB por versión solo para decidir si se dibuja una
 * plantita no se sostiene. El veredicto fino lo da el endpoint de validación cuando se pide.
 */
const migrationSqlFactFields = {
  /**
   * El SQL de esta versión se editó DESPUÉS de que alguna BD la aplicara (api-reference-v15 §5).
   *
   * Es un hecho persistido derivado de la auditoría, no una bandera de política: **no restringe
   * ninguna acción** y no debe deshabilitar controles. Va aquí y no en `migrationPolicyFields`
   * justamente para que esa diferencia quede escrita: aquello decide, esto solo informa.
   *
   * El detalle de QUÉ bases divergieron y cuándo vive en `audit_log`, que no tiene endpoint
   * público: la UI puede decir que hubo divergencia, no reconstruir su historia.
   */
  sql_diverged: z.boolean().optional().default(false),
  has_seed: z.boolean().optional().default(false),
  forced_collations: z.array(z.string()).optional().default([]),
  destructive: z.boolean().optional().default(false),
}

/**
 * `ModelMigrationOut` — detalle completo de una migración (§8). Plan 09 añade los campos de
 * baseline de snapshot: `source_engine`, `is_baseline`, `has_non_portable` y `reviewed`
 * (un baseline de snapshot nace `reviewed=false` y no se puede aplicar hasta aprobarlo).
 */
export const modelMigrationOutSchema = z.object({
  id: z.number().int(),
  model_id: z.number().int(),
  version: z.string(),
  name: z.string(),
  up_sql: z.string(),
  up_sql_mysql: z.string().nullable().optional(),
  up_sql_postgresql: z.string().nullable().optional(),
  down_sql: z.string().nullable().optional(),
  down_sql_suggested: z.string().nullable().optional(),
  translated: migrationTranslatedSchema,
  checksum: z.string(),
  source_engine: engineTypeSchema.nullable().optional(),
  kind: migrationKindSchema.optional(),
  is_baseline: z.boolean().optional(),
  has_non_portable: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  /**
   * Captura de resultados de SELECT (api-reference-v9 §1/§7), opt-in por versión. Activarlo
   * (en la creación o en un PATCH posterior) fuerza `reviewed` a `false` — ver §2.3/§4.1.
   */
  capture_selects: z.boolean().optional().default(false),
  ...migrationPolicyFields,
  ...migrationSqlFactFields,
  created_at: z.string(),
  updated_at: z.string(),
})
export type ModelMigrationOut = z.infer<typeof modelMigrationOutSchema>

/**
 * `ModelMigrationSummary` — item de listado (§8). Los campos de baseline (`is_baseline`,
 * `has_non_portable`, `reviewed`) son opcionales: si el backend los incluye en el resumen, la
 * lista puede mostrar los badges sin pedir el detalle de cada versión.
 */
export const modelMigrationSummarySchema = z.object({
  id: z.number().int(),
  model_id: z.number().int(),
  version: z.string(),
  name: z.string(),
  has_mysql_override: z.boolean(),
  has_postgresql_override: z.boolean(),
  has_rollback: z.boolean(),
  kind: migrationKindSchema.optional(),
  is_baseline: z.boolean().optional(),
  has_non_portable: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  /** Ver `modelMigrationOutSchema.capture_selects` (api-reference-v9 §7). */
  capture_selects: z.boolean().optional().default(false),
  ...migrationPolicyFields,
  ...migrationSqlFactFields,
  checksum: z.string(),
  created_at: z.string(),
})
export type ModelMigrationSummary = z.infer<typeof modelMigrationSummarySchema>

/**
 * `ModelMigrationCreate` (§8 / Plan 09 §7-ter). El `up_sql` es el delta base en estilo MySQL.
 * `version` es **opcional**: si se omite, el gateway asigna la siguiente secuencial (max+1) de
 * forma autónoma y con reintento ante colisión. Pásala solo para fijarla a mano.
 */
export const modelMigrationCreateSchema = z.object({
  version: z
    .string()
    .regex(MIGRATION_VERSION_PATTERN, 'Solo dígitos, 4–10 (ej. 0001). Se ordena numéricamente.')
    .optional(),
  name: z.string().min(1, 'Requerido').max(200, 'Máximo 200 caracteres'),
  up_sql: z.string().min(1, 'Requerido').max(SQL_MAX, 'Máximo 256 KB'),
  up_sql_mysql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  up_sql_postgresql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  down_sql: z.string().max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  /** Opt-in de captura de SELECT (api-reference-v9 §1/§4.1): nace `reviewed: false`. */
  capture_selects: z.boolean().optional(),
})
export type ModelMigrationCreate = z.infer<typeof modelMigrationCreateSchema>

/**
 * `ModelMigrationPatch` (§8 / Plan 09 §7-ter / Cambio 2). Se puede corregir el `up_sql` de una
 * migración **mientras no se haya aplicado con éxito** en ninguna BD (si ya se aplicó, `409` que
 * sugiere fix-forward). Al cambiar `up_sql`, el backend regenera `down_sql_suggested` y recalcula
 * `checksum`, y exige reenviar corregidos o limpiar con `null` los overrides por motor (si no,
 * `409` de overrides obsoletos). `name`/`down_sql`/overrides/`reviewed` no tienen esa restricción;
 * `reviewed:true` aprueba un baseline de snapshot para que pueda aplicarse (R1).
 */
export const modelMigrationPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // `.nullable()` porque el contrato lo declara así (un `null` se ignora, el SQL base no puede
  // quedar vacío). Importa para el tipo, no para la UI: es lo que permite que el mismo objeto
  // alimente el `edit-preview` y el PATCH sin adaptadores, que es lo que el token exige.
  up_sql: z.string().min(1, 'Requerido').max(SQL_MAX, 'Máximo 256 KB').nullable().optional(),
  down_sql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_mysql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_postgresql: z.string().max(SQL_MAX).nullable().optional(),
  reviewed: z.boolean().optional(),
  /**
   * Activa/desactiva la captura de SELECT para esta versión (api-reference-v9 §3.1). ⚠️ El
   * reset automático de `reviewed` a `false` PISA lo que se envíe en el mismo PATCH: si además
   * se manda `reviewed: true` en la misma llamada, gana el reset (§2.3/§3.1).
   */
  capture_selects: z.boolean().optional(),
  /**
   * Doble factor para atravesar el freeze (api-reference-v15 §3). **Van los dos o no va ninguno**,
   * y cubren cosas distintas:
   *
   * - `confirm_version` obliga a identificar conscientemente QUÉ versión se toca — mismo molde
   *   que el `confirm_target_name` al borrar una base.
   * - `confirm_token` da frescura y anti-replay, y por su firma ata la autorización al SQL
   *   EXACTO que se previsualizó. Sin él se podría previsualizar una corrección inocua, mirar un
   *   `blocking_databases` tranquilizador y mandar otra cosa en el PATCH.
   */
  confirm_version: z.string().optional(),
  confirm_token: z.string().optional(),
})
export type ModelMigrationPatch = z.infer<typeof modelMigrationPatchSchema>

/**
 * Resultado por BD dentro de `apply-all` (§8). Las entradas de `applied` pueden traer los
 * campos de checkpoint/reconciliación de §9 (`resumed`, `failed_at_statement_index` 1-based…).
 */
export const applyAllItemSchema = z.object({
  managed_database_id: z.number().int(),
  /**
   * `.nullish()` y NO requerido: el backend los tipa `str | None` / `int | None`.
   *
   * Esto era un defecto real, no una precaución: `ApiResponse._exclude_none` filtra solo las
   * claves del ENVELOPE, así que los `None` anidados salen como `null`, y `apiRequest` hace
   * `safeParse` del envelope completo. Un solo `null` en un solo ítem de un lote de 50 BDs
   * descartaba TODA la respuesta —"La API devolvió una respuesta inesperada."— después de que el
   * apply YA ejecutó DDL, dejando al operador sin ver qué pasó en ninguna. Es el peor modo de
   * fallo del módulo. `migrationApplyOutSchema` tenía el mismo defecto (allá con `.optional()`,
   * que tampoco acepta `null`).
   *
   * Al renderizar hay que pasar por `databaseLabel(item)`: TypeScript no fuerza el fallback
   * porque `ReactNode` acepta `null`, y una fila fallada sin nombre es inaccionable.
   */
  database_name: z.string().nullish(),
  server_id: z.number().int().nullish(),
  ok: z.boolean(),
  applied: z
    .array(
      z.object({
        version: z.string(),
        status: migrationStatusSchema,
        execution_ms: z.number().optional(),
        resumed: z.boolean().optional(),
        resumed_from_statement: z.number().int().nullish(),
        statement_total: z.number().int().nullish(),
        failed_at_statement_index: z.number().int().nullish(),
      }),
    )
    .optional(),
  pending_versions: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
  /**
   * Código estable del rechazo. Va APARTE de `error`, que es prosa para mostrar: el `except` del
   * lote en el backend conserva solo `exc.message` y descarta el `public_context`, y la ruta
   * responde 200 con los ítems adentro — así que para los rechazos POR BD este campo es el
   * único transporte del código, y `extractEnvironmentContext` (que opera sobre `ApiError`)
   * nunca lo ve. La clasificación de filas se hace con el mapa de `environments/messages.ts`.
   *
   * `.nullish()` obligatorio: es `null` en TODOS los ítems OK, así que con `.optional()` fallaría
   * el parseo en CADA `apply-all`.
   */
  error_code: z.string().nullish(),
  /** Entorno de esta BD; `null` en toda BD sin clasificar (de ahí el `.nullish()`). */
  environment_slug: z.string().nullish(),
  /**
   * Versiones que el entorno bloquea. En dry-run es INFORMATIVO (el plan no falla); en un apply
   * real acompaña al rechazo. `default_factory=list` en el backend, nunca `null`.
   */
  blocked_by: z.array(z.string()).optional().default([]),
  /**
   * Paridad con el apply por BD (api-reference-v11 §3). Sin estos campos, tras un apply
   * masivo no había forma de saber en qué BDs quedaron capturas ni cómo llegar a ellas.
   */
  captured_select_count: z.number().int().optional().default(0),
  /**
   * Versiones en las que se escribieron capturas en ESTA BD. Sin esto el cliente adivinaba con
   * la última versión aplicada del ítem, que no tiene por qué ser en la que se capturó.
   */
  captured_versions: z.array(z.string()).optional().default([]),
  /**
   * Versiones con captura SIN revisar que frenaron a esta BD. Acompaña a
   * `error_code: 'migration.capture_unreviewed'`. Ese rechazo viaja por ítem dentro de una
   * respuesta 200 (el guard corre por BD dentro del bucle), así que el `public_context` de la
   * respuesta HTTP no existe para él y el `error_code` es el único canal clasificable.
   */
  unreviewed_capture: z.array(z.string()).optional().default([]),
  select_results_available: z.boolean().optional().default(false),
})
export type ApplyAllItem = z.infer<typeof applyAllItemSchema>

/** Respuesta de `POST .../migrations/apply-all` (§8). */
export const applyAllResultSchema = z.object({
  model_id: z.number().int(),
  /** TODAS las BDs del blueprint. NO refleja los filtros del lote. */
  total_databases: z.number().int(),
  /**
   * BDs que coincidieron con los filtros ANTES del tope `max_databases`. Comparado con
   * `processed` dice si hubo recorte: sin este número, "3 de 40 procesadas" no distingue
   * "sobraron 37" de "en ese entorno solo había 3". `int = 0` en el backend, nunca `null`.
   */
  matched_databases: z.number().int().optional().default(0),
  processed: z.number().int(),
  results: z.array(applyAllItemSchema),
})
export type ApplyAllResult = z.infer<typeof applyAllResultSchema>

/**
 * Validación estática del SQL de una migración (api-reference-v11 §1).
 *
 * La forma de `statements` es deliberadamente la misma que la del preview de la consola SQL,
 * para poder reutilizar su panel de clasificación en vez de inventar otra presentación.
 */
export const validateStatementSchema = z.object({
  seq: z.number().int(),
  sql: z.string(),
  kind: z.string(),
  danger: z.string(),
  reasons: z.array(z.object({ code: z.string(), message: z.string() })).default([]),
  seeds: z.boolean().default(false),
  destructive: z.boolean().default(false),
  collations: z.array(z.string()).default([]),
  parse_error: z.string().nullable().optional(),
})
export type ValidateStatement = z.infer<typeof validateStatementSchema>

export const migrationValidateOutSchema = z.object({
  statements: z.array(validateStatementSchema).default([]),
  has_seed: z.boolean().default(false),
  forced_collations: z.array(z.string()).default([]),
  destructive_statements: z.array(z.number().int()).default([]),
  parse_errors: z.array(z.object({ seq: z.number().int(), message: z.string() })).default([]),
  gateway_internal_tables: z.array(z.string()).default([]),
  /** No vacío = el apply contra PostgreSQL dará 422 salvo que se defina `up_sql_postgresql`. */
  postgresql_blockers: z.array(z.string()).default([]),
  resumable: z.boolean().default(true),
  /** Tablas que el SQL necesita PREEXISTENTES (no las que él mismo crea). */
  referenced_tables: z.array(z.string()).default([]),
  /**
   * Versiones que la BD comprobada tiene pendientes ANTES de la validada. Si no está vacío,
   * las tablas que ESAS versiones crean todavía no existen: lo que falla es la premisa de la
   * comprobación, no el SQL.
   */
  pending_before: z.array(z.string()).default([]),
  /** Solo si se pidió verificar contra una BD concreta. */
  checked_database: z.string().nullable().optional(),
  missing_tables: z.array(z.string()).default([]),
  /** El motor no era alcanzable: el análisis estático viene igual. */
  catalog_error: z.string().nullable().optional(),
  blueprint_collation: z.string().nullable().optional(),
  collation_conflicts: z.array(z.string()).default([]),
})
export type MigrationValidateOut = z.infer<typeof migrationValidateOutSchema>

export const migrationValidateInSchema = z.object({
  up_sql: z.string().max(SQL_MAX).optional(),
  version: z.string().optional(),
  managed_database_id: z.number().int().optional(),
})
export type MigrationValidateIn = z.infer<typeof migrationValidateInSchema>

// ── Editar una versión ya aplicada (api-reference-v15) ──────────────────────────

/**
 * Por qué una BD bloquea editar o borrar una versión (api-reference-v14 §2). Vocabulario cerrado.
 *
 * `unreadable` es el que más fácil se diseña mal: **no significa «no se puede», significa «no se
 * pudo comprobar»**. El backend falla cerrado —motor caído, base sin aprovisionar o credenciales
 * rotas cuentan como bloqueante— porque tratar un fallo de lectura como «esa BD ya no la tiene»
 * convertiría un corte de red en autorización para destruir metadata. Presentarlo como «error
 * transitorio, reintentá» lleva al operador a reintentar hasta que la fila desaparezca, y a leer
 * esa desaparición como permiso.
 *
 * `in_use` y `still_applied` **divergen a propósito** y no son sinónimos con distinto nombre:
 *
 * - `in_use` es el motivo del **borrado** (v18 §5): la BD está parada EXACTAMENTE en esa versión
 *   (`==`). Borrarla dejaría a esa base apuntando a una versión que ya no existe.
 * - `still_applied` es el motivo de la **edición** (v14 §2): la BD está en esa versión **o en una
 *   posterior** (`>=`), es decir, ya ejecutó ese SQL. Cambiarlo la volvería divergente.
 *
 * Colapsarlos en uno haría que una BD adelantada bloqueara un borrado que v18 permite, o que una
 * BD parada justo ahí pasara por editable. Son la misma lista con dos preguntas distintas.
 */
export const migrationBlockingReasonSchema = z.enum([
  'in_use',
  'still_applied',
  'unreadable',
  'unknown_database',
  'unknown_blueprint',
])
export type MigrationBlockingReason = z.infer<typeof migrationBlockingReasonSchema>

/**
 * Una BD que bloquea la operación (v14 §2).
 *
 * El backend **nunca manda el nombre**, solo el id: el mensaje nativo del motor puede arrastrar
 * host, usuario o fragmentos de sentencia. El nombre lo resuelve la UI por su cuenta y, si no
 * puede, muestra «BD #7» y sigue — un nombre que falta no es un fallo de la operación.
 *
 * `current_version` es `.optional()` y NO `.nullable()`: el contrato dice «string | ausente», y
 * solo viene con `reason: "still_applied"`.
 */
export const blockingDatabaseSchema = z.object({
  managed_database_id: z.number().int(),
  reason: migrationBlockingReasonSchema,
  current_version: z.string().optional(),
})
export type BlockingDatabase = z.infer<typeof blockingDatabaseSchema>

/**
 * `MigrationEditPreviewIn` (v15 §3) — cuerpo del preview de edición.
 *
 * ⚠️ Tiene que construirse desde **el mismo objeto** que después va al PATCH, con exactamente las
 * mismas claves y los mismos valores: el checksum resultante se calcula por **presencia de clave**
 * (única excepción: `up_sql: null`, que se ignora). Mandar `up_sql_postgresql: null` en uno y
 * omitirlo en el otro cambia el checksum y el token deja de validar (422).
 */
export const migrationEditPreviewInSchema = z.object({
  up_sql: z.string().min(1).max(SQL_MAX).nullable().optional(),
  down_sql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_mysql: z.string().max(SQL_MAX).nullable().optional(),
  up_sql_postgresql: z.string().max(SQL_MAX).nullable().optional(),
})
export type MigrationEditPreviewIn = z.infer<typeof migrationEditPreviewInSchema>

/**
 * `MigrationEditPreviewOut` (v15 §3).
 *
 * `confirm_token` y `expires_at` son `.nullable()` y **no** `.optional()`: la omisión de claves
 * nulas del backend solo ocurre en el nivel superior del envelope, así que dentro de `data` un
 * nulo viaja como `null` explícito. Vienen en `null` cuando `requires_confirmation` es `false`
 * — y en ese caso el PATCH va **sin** los dos factores: mandar un token que no hace falta entrena
 * al cliente a mandarlo siempre, y ese hábito vacía la confirmación de sentido.
 *
 * El token es opaco (`"{epoch}.{hmac}"`): no se parsea. La cuenta atrás sale de `expires_at`,
 * nunca de una constante local — el TTL no viaja en la respuesta.
 */
export const migrationEditPreviewOutSchema = z.object({
  model_id: z.number().int(),
  version: z.string(),
  requires_confirmation: z.boolean(),
  blocking_databases: z.array(blockingDatabaseSchema).default([]),
  resulting_checksum: z.string(),
  confirm_version: z.string(),
  confirm_token: z.string().nullable(),
  expires_at: z.string().nullable(),
})
export type MigrationEditPreviewOut = z.infer<typeof migrationEditPreviewOutSchema>

// ── Borrar una versión intermedia (api-reference-v18) ───────────────────────────

/**
 * Un paso del **renumerado del blueprint** (v18 §2): la versión `from_version` pasa a llamarse
 * `to_version` para tapar el hueco que deja la borrada.
 *
 * Es un cambio de metadata del blueprint, no del motor: ninguna BD se toca por esto. Lo que sí
 * toca el motor es `migrationStampStepSchema`, y la diferencia importa al redactar la
 * confirmación — mezclarlos haría que un renumerado inocuo se lea como una escritura remota.
 */
export const migrationRenumberStepSchema = z.object({
  from_version: z.string(),
  to_version: z.string(),
})
export type MigrationRenumberStep = z.infer<typeof migrationRenumberStepSchema>

/**
 * Un puntero de versión que hay que **mover en una BD real** (v18 §2/§4): esa base quedó parada en
 * `from_version` y, tras el renumerado, esa misma migración se llama `to_version`. Sin el stamp, la
 * base apuntaría a una versión inexistente.
 *
 * `database_name` y `server_id` son **opcionales a propósito**, y no por prudencia genérica: el
 * contrato los muestra en `stamp_plan`, pero **no los garantiza en `left_moved`** (el 409
 * `renumber_stamp_failed`). Exigirlos invalidaría justamente la lista que dice qué bases quedaron
 * mal marcadas, que es el peor momento posible para quedarse sin datos. Una fila sin nombre tiene
 * que degradar a «BD #3» y seguir mostrándose.
 */
export const migrationStampStepSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string().optional(),
  server_id: z.number().int().optional(),
  from_version: z.string(),
  to_version: z.string(),
})
export type MigrationStampStep = z.infer<typeof migrationStampStepSchema>

/**
 * BD a la que **no se le puede mover el puntero** porque la versión destino no existe en su
 * historial (409 `model_migration.renumber_target_missing`, v18 §4).
 *
 * `current_version` es dónde está parada y `missing_target` es a dónde habría que moverla. Los dos
 * son requeridos porque sin el par el mensaje no dice nada accionable: «no se pudo re-marcar la BD
 * 3» no permite decidir si falta aplicar migraciones ahí o si su historial está corrupto.
 */
export const migrationUnstampableDatabaseSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string().optional(),
  server_id: z.number().int().optional(),
  current_version: z.string(),
  missing_target: z.string(),
})
export type MigrationUnstampableDatabase = z.infer<typeof migrationUnstampableDatabaseSchema>

/**
 * BD con una aplicación **a medias** que el borrado afectaría (v18 §2, `partial_applications[]`).
 *
 * ⚠️ **Esta forma está DEDUCIDA del contrato, no observada en un payload real.** v18 no fija los
 * campos de `partial_applications[]` más allá de que cada entrada enlaza a `reconcile-partial` de
 * esa BD — o sea, lo único que el contrato compromete es el `managed_database_id`. Por eso todo lo
 * demás va `.optional()`: si el backend manda otro juego de claves, la fila degrada a «BD #3, con
 * aplicación parcial» en vez de tumbar el plan entero y dejar al operador sin ver por qué el
 * borrado está bloqueado. Cuando se vea un payload real, esto se ajusta con datos, no con
 * suposiciones.
 */
export const migrationAffectedPartialApplicationSchema = z.object({
  managed_database_id: z.number().int(),
  database_name: z.string().optional(),
  version: z.string().optional(),
  last_statement_index: z.number().int().optional(),
  total_statements: z.number().int().optional(),
})
export type MigrationAffectedPartialApplication = z.infer<
  typeof migrationAffectedPartialApplicationSchema
>

/**
 * `MigrationDeletePlanOut` (v18 §2) — previsualización de borrar una versión **intermedia**.
 *
 * Es un GET que no modifica nada, pero **abre conexión a cada BD del blueprint**: por eso su
 * veredicto es autoritativo en vivo, a diferencia de `deletable` / `delete_requires_stamps` del
 * listado, que salen de la caché del inventario. Ante discrepancia manda el plan, siempre.
 *
 * `deletable: false` va acompañado de `blockers` (BDs paradas exactamente ahí o ilegibles),
 * `unstampable` (BDs a las que no se les puede mover el puntero) o `partial_applications`; los
 * tres son las tres formas distintas de «no» y cada una tiene su propia salida.
 *
 * `confirm_token` y `expires_at` son `.nullable()` y **no** `.optional()` por el mismo motivo que
 * en el preview de edición: dentro de `data` un nulo viaja como `null` explícito. Vienen en `null`
 * cuando no hace falta confirmar **y también cuando el plan está bloqueado** — un plan bloqueado
 * no emite autorización. El TTL es de 2 minutos y no viaja en la respuesta: la cuenta atrás sale
 * de `expires_at`, nunca de una constante local.
 *
 * `warnings` no es decorado: ahí viaja el hecho de que las BDs ya stampeadas **conservan
 * FÍSICAMENTE** los objetos que creó la versión borrada. El blueprint deja de describirlos, el
 * motor los sigue teniendo. Ocultar eso convierte un borrado de metadata en una divergencia
 * silenciosa entre lo que el gateway dice y lo que la base es.
 */
export const migrationDeletePlanOutSchema = z.object({
  model_id: z.number().int(),
  version: z.string(),
  deletable: z.boolean(),
  renumber: z.array(migrationRenumberStepSchema).default([]),
  stamp_plan: z.array(migrationStampStepSchema).default([]),
  blockers: z.array(blockingDatabaseSchema).default([]),
  unstampable: z.array(migrationUnstampableDatabaseSchema).default([]),
  partial_applications: z.array(migrationAffectedPartialApplicationSchema).default([]),
  requires_confirmation: z.boolean(),
  confirm_token: z.string().nullable(),
  expires_at: z.string().nullable(),
  warnings: z.array(z.string()).default([]),
})
export type MigrationDeletePlanOut = z.infer<typeof migrationDeletePlanOutSchema>

/**
 * Resultado del `DELETE .../migrations/{version}` en v18 §3, que **dejó de ser vacío**.
 *
 * Dice qué se hizo de verdad, no qué se había planeado: `renumbered` son las versiones del
 * blueprint que cambiaron de número y `stamped` los punteros que se movieron en BDs reales. La UI
 * tiene que pintar lo ejecutado y no el plan previo, porque entre el `delete-plan` y el DELETE
 * pasaron hasta 2 minutos y el resultado puede diferir.
 */
export const migrationDeleteResultSchema = z.object({
  model_id: z.number().int(),
  version: z.string(),
  renumbered: z.array(migrationRenumberStepSchema).default([]),
  stamped: z.array(migrationStampStepSchema).default([]),
})
export type MigrationDeleteResult = z.infer<typeof migrationDeleteResultSchema>

/**
 * Códigos estables de `detail.public_context.code` de las versiones de blueprint (v14 §2,
 * v15 §4 y v18 §4).
 *
 * `sqlFrozen` es el único con **override**: trae `override_available: true` y habilita la vía de
 * excepción. Los otros dos 409 **no lo tienen**, y ofrecérsela por analogía sería inventar una
 * salida que el backend no da:
 *
 * - `partialApplication`: su CTA es reintentar el apply, nunca «editar igual» — un `resume`
 *   posterior interpretaría los índices del checkpoint contra un SQL que no es el que corrió.
 * - `stillApplied` (el DELETE): borrar la descripción de cambios que están físicamente en una BD
 *   dejaría esa base con objetos que ninguna versión del blueprint describe.
 *
 * Los seis códigos de v18 §4 son del borrado de una versión **intermedia** y **ninguno tiene
 * override**: cada uno tiene una salida distinta y confundirlas es lo caro.
 *
 * - `versionInUse` y `unreadableDatabases` traen `blocking_databases[]`. El segundo es
 *   **fail-closed**: no significa «esa BD no la tiene», significa «no se pudo comprobar». Tratarlo
 *   como reintentable lleva al operador a insistir hasta que la fila desaparezca y a leer esa
 *   desaparición como permiso.
 * - `renumberConfirmationRequired` trae `stamp_plan[]`: es el «falta el `confirm_token`», y su
 *   salida es pedir el `delete-plan` otra vez, no reintentar el DELETE tal cual.
 * - `renumberStampFailed` trae `compensated` y `left_moved[]`. En este 409 **el blueprint no se
 *   modificó**; lo que puede haber quedado mal son punteros de BDs.
 * - `renumberTargetMissing` trae `unstampable_databases[]`, y tampoco modificó el blueprint.
 * - `affectedPartialApplication` no trae contexto extra: su salida es resolver la aplicación
 *   parcial (`reconcile-partial`) antes de volver a intentar el borrado.
 *
 * `stillApplied` **sigue vigente**: es el `reason` de la EDICIÓN (`>=`), no del borrado (`==`).
 * Borrarlo de aquí rompería la clasificación del 409 de `edit-preview`/PATCH.
 */
export const MIGRATION_ERROR_CODES = {
  sqlFrozen: 'model_migration.sql_frozen',
  stillApplied: 'model_migration.still_applied',
  partialApplication: 'model_migration.partial_application',
  staleOverrides: 'model_migration.stale_overrides',
  editConfirmMismatch: 'model_migration.edit_confirm_mismatch',
  versionInUse: 'model_migration.version_in_use',
  unreadableDatabases: 'model_migration.unreadable_databases',
  renumberConfirmationRequired: 'model_migration.renumber_confirmation_required',
  renumberStampFailed: 'model_migration.renumber_stamp_failed',
  renumberTargetMissing: 'model_migration.renumber_target_missing',
  affectedPartialApplication: 'model_migration.affected_partial_application',
} as const
