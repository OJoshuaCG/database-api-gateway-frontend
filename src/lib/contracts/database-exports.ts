import { z } from 'zod'
import { engineTypeSchema } from './common'

/**
 * Exportación de bases de datos (feature `database-exports`): volcado configurable de la
 * estructura y/o los datos de una base a `sql` / `csv` / `json` / `ndjson`, con confirmación de
 * doble factor, TTL corto sobre el archivo y descarga de un solo uso.
 *
 * Igual que `database-clones` y `collation-conversions`, el flujo es asíncrono: `execute` valida y
 * ENCOLA un job, y la UI sigue el avance por polling de `GET /{id}`.
 *
 * **Lo que distingue a este módulo de todos los demás del gateway:** el formulario NO conoce
 * ninguna regla de negocio. Los controles, sus valores válidos, sus defaults, qué combinaciones
 * están prohibidas y los límites numéricos salen ENTEROS de `GET .../export-capabilities`. Por eso
 * varios campos que en otro contrato serían `z.enum` aquí son `z.string()` a propósito: si el
 * backend agrega un formato o un valor de opción, la pantalla lo muestra sin tocar este archivo.
 * Ver `features/database-exports/logic.ts` (el evaluador de la matriz) y `docs/database-export.md`.
 */

// ── Enums cerrados (la UI SÍ ramifica sobre estos) ──────────────────────────────
/**
 * Estado del job. Es un enumerado estricto porque la UI ramifica sobre él (polling, habilitar la
 * descarga, permitir cancelar): un valor nuevo tiene que fallar de forma ruidosa, no colarse.
 */
export const exportJobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'interrupted',
])
export type ExportJobStatus = z.infer<typeof exportJobStatusSchema>

/** Fase del job, en el orden en que el worker las recorre. Alimenta el texto de la barra. */
export const exportJobPhaseSchema = z.enum([
  'preamble',
  'scope',
  'prerequisites',
  'structure',
  'data',
  'constraints',
  'bodies',
  'epilogue',
  'done',
])
export type ExportJobPhase = z.infer<typeof exportJobPhaseSchema>

/** Desenlace de un objeto en el reporte por objeto (`GET .../items`, `manifest.objects`). */
export const exportItemStatusSchema = z.enum(['ok', 'error', 'skipped'])
export type ExportItemStatus = z.infer<typeof exportItemStatusSchema>

// ── Enums del `ExportSpec` (entrada; los controlamos nosotros) ───────────────────
/**
 * `scope_ddl` / `entity_ddl`. Es UN enumerado de cuatro valores y no dos casillas ("borrar" +
 * "crear") precisamente para que el estado *"eliminar sin crear"* no sea representable.
 * `DROP_CREATE` y `CREATE_IF_NOT_EXISTS` no son opuestos: la primera dice «que quede exactamente
 * esto, destruyendo lo que haya», la segunda «que exista, sin tocar lo que ya está».
 */
export const exportDdlModeSchema = z.enum(['NONE', 'CREATE', 'DROP_CREATE', 'CREATE_IF_NOT_EXISTS'])
export type ExportDdlMode = z.infer<typeof exportDdlModeSchema>

/** Modo del conjunto ESTRUCTURA. El orden de aplicación es `mode` → include → exclude. */
export const exportSelectionModeSchema = z.enum(['all', 'include', 'all_except'])
export type ExportSelectionMode = z.infer<typeof exportSelectionModeSchema>

/** Modo del conjunto DATOS: el mismo que la estructura, más `none` (no exportar ninguna fila). */
export const exportDataModeSchema = z.enum(['none', 'all', 'include', 'all_except'])
export type ExportDataMode = z.infer<typeof exportDataModeSchema>

export const exportInsertVariantSchema = z.enum([
  'none',
  'insert',
  'insert_ignore',
  'replace',
  'upsert',
])
export type ExportInsertVariant = z.infer<typeof exportInsertVariantSchema>

export const exportDefinerModeSchema = z.enum(['keep', 'omit', 'replace', 'auto'])
export type ExportDefinerMode = z.infer<typeof exportDefinerModeSchema>

export const exportAutoincrementModeSchema = z.enum(['keep', 'omit', 'auto'])
export type ExportAutoincrementMode = z.infer<typeof exportAutoincrementModeSchema>

export const exportConstraintsPlacementSchema = z.enum(['inline', 'deferred'])
export type ExportConstraintsPlacement = z.infer<typeof exportConstraintsPlacementSchema>

export const exportCharsetOverrideModeSchema = z.enum(['keep', 'override'])
export type ExportCharsetOverrideMode = z.infer<typeof exportCharsetOverrideModeSchema>

export const exportLineTerminatorSchema = z.enum(['lf', 'crlf'])
export type ExportLineTerminator = z.infer<typeof exportLineTerminatorSchema>

export const exportOrganizationSchema = z.enum(['single', 'per_object'])
export type ExportOrganization = z.infer<typeof exportOrganizationSchema>

export const exportCompressionSchema = z.enum(['none', 'gzip', 'zip'])
export type ExportCompression = z.infer<typeof exportCompressionSchema>

export const exportDeliverySchema = z.enum(['file', 'inline'])
export type ExportDelivery = z.infer<typeof exportDeliverySchema>

export const exportBinaryEncodingSchema = z.enum(['hex', 'base64'])
export type ExportBinaryEncoding = z.infer<typeof exportBinaryEncodingSchema>

/** ⚠️ El valor es `continue`, sin guion bajo (§8 del contrato lo señala expresamente). */
export const exportOnErrorSchema = z.enum(['stop', 'continue'])
export type ExportOnError = z.infer<typeof exportOnErrorSchema>

/**
 * Formatos que el contrato documenta hoy. Es una AYUDA para presets y etiquetas, **no** una
 * validación: `format` viaja como `z.string()` en todos los schemas para que un formato nuevo del
 * backend aparezca solo en el selector (§2.3).
 */
export const KNOWN_EXPORT_FORMATS = ['sql', 'csv', 'json', 'ndjson'] as const
export type KnownExportFormat = (typeof KNOWN_EXPORT_FORMATS)[number]

// ── Capacidades (`GET /servers/{sid}/databases/{db}/export-capabilities`) ────────
/**
 * Un control del formulario. La clave del `Record` que lo contiene es la **ruta con puntos del
 * campo en el `ExportSpec`** (`sanitize.definer`, `output.compression`, …).
 *
 * - `values` son las opciones del select — nunca se escriben a mano.
 * - `default` es un **string** en las opciones enumeradas y un **boolean** de verdad en las
 *   booleanas (donde `values` son los strings `"true"`/`"false"`). Esa asimetría existe en el
 *   backend; `logic.ts` la normaliza en un solo sitio.
 * - `applicable: false` significa que el concepto NO existe en este motor (caso testigo:
 *   `sanitize.definer` en PostgreSQL): el control se oculta.
 * - `destructive` son los valores que se pintan en rojo, sin hardcodear cuáles son.
 */
export const exportOptionSchema = z.object({
  values: z.array(z.string()),
  default: z.union([z.string(), z.boolean(), z.number(), z.null()]),
  applicable: z.boolean(),
  destructive: z.array(z.string()),
})
export type ExportOption = z.infer<typeof exportOptionSchema>

/**
 * Una regla de la matriz de compatibilidad — **la misma estructura de datos que el servidor hace
 * cumplir**, no una copia. Si el formulario deshabilita lo que la matriz prohíbe, el 422
 * `export.incompatible_option` no puede aparecer; si aparece, es un bug del evaluador del cliente.
 *
 * - `when`: la regla aplica si TODAS sus claves coinciden con el valor actual del spec. La clave
 *   especial `engine` se compara contra `capabilities.engine`, no contra el spec — la matriz viaja
 *   entera, incluidas las reglas de otros motores, y filtrarlas es trabajo del cliente.
 * - `forbids`: `"ruta.opcion"` (debe estar en su valor neutro), `"ruta.opcion=valor"` (ese valor
 *   concreto está prohibido) o `"structure.*"` (comodín).
 * - `requires`: esa opción tiene que estar presente y no vacía.
 * - `blocking: false` es un AVISO: se muestra, no deshabilita nada.
 * - `reason` es el texto listo para mostrar; no se reescribe.
 *
 * Los valores de `when` se aceptan como string, boolean o number aunque el contrato los documente
 * como string: una regla booleana no documentada no puede dejar la pantalla en blanco, y el
 * comparador de `logic.ts` los normaliza a texto antes de decidir.
 */
export const exportCompatibilityRuleSchema = z.object({
  when: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])),
  forbids: z.array(z.string()),
  requires: z.array(z.string()),
  reason: z.string(),
  blocking: z.boolean(),
  code: z.string(),
})
export type ExportCompatibilityRule = z.infer<typeof exportCompatibilityRuleSchema>

/**
 * Qué transporta cada formato. `supports_structure` puede ser `"manifest_only"`: el objeto no
 * lleva su DDL pero figura en el manifiesto (de ahí el `reason: "manifest_only"` de `/items`).
 */
export const exportFormatCapabilitySchema = z.object({
  name: z.string(),
  supports_structure: z.union([z.boolean(), z.literal('manifest_only')]),
  supports_data: z.boolean(),
  one_file_per_table: z.boolean(),
})
export type ExportFormatCapability = z.infer<typeof exportFormatCapabilitySchema>

/**
 * Alcance del volcado. `scope_note` explica una limitación del motor (en PostgreSQL, que solo se
 * cubre el schema `public`) y hay que mostrarlo cuando no es `null`.
 */
export const exportScopeSchema = z.object({
  kind: z.string(),
  name: z.string(),
  scope_note: z.string().nullable(),
})
export type ExportScope = z.infer<typeof exportScopeSchema>

/**
 * Dialecto csv. `single_char_options` dice qué campos deben validarse como **exactamente un
 * carácter**, sin hardcodear la lista. `null_vs_empty` es la explicación lista para mostrar de
 * cómo se distingue un `NULL` de una cadena vacía.
 */
export const exportCsvDialectSchema = z.object({
  delimiter: z.string(),
  quote_char: z.string(),
  escape_char: z.string().nullable(),
  null_representation: z.string(),
  single_char_options: z.array(z.string()),
  null_vs_empty: z.string(),
})
export type ExportCsvDialect = z.infer<typeof exportCsvDialectSchema>

/**
 * Empaquetado. `container_is_implicit: true` significa que **multiarchivo ⇒ zip aunque se pida
 * `compression: "none"`**: el backend no lo rechaza, lo resuelve — así que hay que avisar al
 * usuario de que va a bajar un `.zip`. `multifile_when` trae las condiciones que lo disparan, con
 * la misma sintaxis que `forbids` (`"output.organization=per_object"`, `"output.split_max_bytes"`).
 */
export const exportPackagingSchema = z.object({
  multifile_when: z.array(z.string()),
  container: z.string(),
  container_is_implicit: z.boolean(),
  part_naming: z.string(),
  index_entry: z.string(),
  entry_extension: z.record(z.string(), z.string()),
})
export type ExportPackaging = z.infer<typeof exportPackagingSchema>

/**
 * Los números duros del módulo. Hay **dos vencimientos distintos** y no se mezclan:
 * `plan_ttl_hours` afecta a `preview`/`execute`, y `artifact_ttl_minutes` (desde que el job
 * termina) afecta a `download`/`content`.
 */
export const exportLimitsSchema = z.object({
  inline_max_bytes: z.number().int(),
  max_statement_bytes: z.number().int(),
  rows_per_statement: z.number().int(),
  plan_ttl_hours: z.number().int(),
  artifact_ttl_minutes: z.number().int(),
  max_duration_seconds: z.number().int(),
  max_parts: z.number().int(),
})
export type ExportLimits = z.infer<typeof exportLimitsSchema>

/**
 * `data` de `GET .../export-capabilities` — la única fuente del formulario. Se llama PRIMERO y
 * todo lo demás se deriva de acá: tipos de objeto, formatos, controles, matriz de combinaciones
 * prohibidas, dialecto csv, empaquetado, límites y la lista de códigos de error estables.
 */
export const exportCapabilitiesSchema = z.object({
  engine: engineTypeSchema,
  engine_version: z.string(),
  scope: exportScopeSchema,
  object_types: z.array(z.string()),
  formats: z.array(exportFormatCapabilitySchema),
  options: z.record(z.string(), exportOptionSchema),
  compatibility: z.array(exportCompatibilityRuleSchema),
  csv_dialect: exportCsvDialectSchema,
  packaging: exportPackagingSchema,
  limits: exportLimitsSchema,
  /** Códigos estables. Alimenta el `console.error` cuando el backend agrega uno que no manejamos. */
  error_codes: z.array(z.string()),
  charset_collation_catalog_url: z.string(),
})
export type ExportCapabilities = z.infer<typeof exportCapabilitiesSchema>

// ── `ExportSpec` (cuerpo de crear plan y de `preview`) ───────────────────────────
/**
 * Un conjunto de objetos. Los patrones son **glob contra los nombres del catálogo** (nunca llegan a
 * una consulta) y el orden de aplicación es `mode` → `include_patterns` → `exclude_patterns`, donde
 * **la exclusión gana**.
 */
export const exportSelectionSchema = z.object({
  mode: exportSelectionModeSchema,
  types: z.array(z.string()),
  names: z.array(z.string()),
  include_patterns: z.array(z.string()),
  exclude_patterns: z.array(z.string()),
})
export type ExportSelection = z.infer<typeof exportSelectionSchema>

/**
 * Filtro de filas de UNA tabla. El `where` se inserta **entre paréntesis** y la consulta lleva
 * `ORDER BY` y `LIMIT` detrás, así que el `limit` confirmado es el que se aplica. No puede
 * contener NINGÚN comentario —ni de línea, ni de bloque, ni `#` en MySQL/MariaDB— ni referirse a
 * otra tabla.
 */
export const exportRowFilterSchema = z.object({
  where: z.string().nullable(),
  limit: z.number().int().nullable(),
})
export type ExportRowFilter = z.infer<typeof exportRowFilterSchema>

/**
 * El conjunto DATOS: de qué tablas salen las filas. Con una restricción, `data ⊆ selection`, cuya
 * ÚNICA excepción es el modo "solo datos" (`scope_ddl` y `entity_ddl` ambos en `NONE`) — que es
 * además la única forma en que `csv`/`json`/`ndjson` pueden existir.
 */
export const exportDataSelectionSchema = z.object({
  mode: exportDataModeSchema,
  names: z.array(z.string()),
  include_patterns: z.array(z.string()),
  exclude_patterns: z.array(z.string()),
  insert_variant: exportInsertVariantSchema,
  rows_per_statement: z.number().int(),
  max_statement_bytes: z.number().int(),
  include_column_list: z.boolean(),
  per_object: z.record(z.string(), exportRowFilterSchema),
})
export type ExportDataSelection = z.infer<typeof exportDataSelectionSchema>

/**
 * Bloque `structure`. `drop_if_exists` es **ortogonal** a los enumerados y aplica al `DROP` de
 * `DROP_CREATE`. `confirm_scope_drop` es obligatorio —el nombre real de la base, re-tecleado—
 * cuando `scope_ddl` es `DROP_CREATE`, porque el artefacto va a contener un `DROP DATABASE`.
 */
export const exportStructureSpecSchema = z.object({
  scope_ddl: exportDdlModeSchema,
  entity_ddl: exportDdlModeSchema,
  drop_if_exists: z.boolean(),
  drop_cascade: z.boolean(),
  confirm_scope_drop: z.string().nullable(),
})
export type ExportStructureSpec = z.infer<typeof exportStructureSpecSchema>

export const exportCharsetOverrideSchema = z.object({
  mode: exportCharsetOverrideModeSchema,
  charset: z.string().nullable(),
  collation: z.string().nullable(),
})
export type ExportCharsetOverride = z.infer<typeof exportCharsetOverrideSchema>

/**
 * Bloque `sanitize`. Ojo con dos pares que se confunden: `script_comments` es el encabezado y los
 * separadores DEL SCRIPT (apagarlo saca la fecha y hace el volcado byte a byte reproducible, apto
 * para versionar), mientras `object_comments` son los `COMMENT` DEL ESQUEMA — son opciones
 * SEPARADAS. `definer_value` es obligatorio si `definer` es `replace`.
 */
export const exportSanitizeSpecSchema = z.object({
  script_comments: z.boolean(),
  object_comments: z.boolean(),
  definer: exportDefinerModeSchema,
  definer_value: z.string().nullable(),
  autoincrement: exportAutoincrementModeSchema,
  engine_specific_options: z.boolean(),
  partitions: z.boolean(),
  constraints_placement: exportConstraintsPlacementSchema,
  session_preamble: z.boolean(),
  transaction_wrap: z.boolean(),
  charset_override: exportCharsetOverrideSchema,
})
export type ExportSanitizeSpec = z.infer<typeof exportSanitizeSpecSchema>

/** Bloque `csv`. Solo se envía cuando el formato elegido es `csv`. */
export const exportCsvSpecSchema = z.object({
  delimiter: z.string(),
  quote_char: z.string(),
  escape_char: z.string().nullable(),
  line_terminator: exportLineTerminatorSchema,
  header: z.boolean(),
  null_representation: z.string(),
  bom: z.boolean(),
})
export type ExportCsvSpec = z.infer<typeof exportCsvSpecSchema>

/**
 * Bloque `output`. Dos campos con trampa:
 *
 * - `file_encoding` es una **whitelist** (`utf-8`, `utf-8-sig`, `latin-1`, `cp1252` y sus alias).
 *   El motivo no es purismo: el artefacto se codifica por trozo, así que un códec con estado
 *   (`utf-16`, `utf-32`) incrusta su marca de orden de bytes en CADA escritura y el archivo sale
 *   corrupto — con un sha256 que igual lo declara íntegro. Se ofrece un selector cerrado.
 * - `filename_template` admite SOLO `{database}`, `{object}`, `{date}`, `{time}` y `{job_id}`.
 */
export const exportOutputSpecSchema = z.object({
  organization: exportOrganizationSchema,
  split_max_bytes: z.number().int().nullable(),
  compression: exportCompressionSchema,
  filename_template: z.string(),
  file_encoding: z.string(),
  delivery: exportDeliverySchema,
  binary_encoding: exportBinaryEncodingSchema,
  schema_manifest: z.boolean(),
})
export type ExportOutputSpec = z.infer<typeof exportOutputSpecSchema>

/**
 * El `ExportSpec` completo: **el cuerpo de `POST .../database-exports` ES este objeto** (el
 * servidor y la base salen de la ruta). Todos los bloques son opcionales del lado del backend y
 * tienen defaults, así que `{}` es un cuerpo válido — pero el wizard mantiene siempre un spec
 * completo en memoria, poblado desde `capabilities.options`, y `logic.ts` decide qué bloques
 * omitir al construir el cuerpo real.
 */
export const exportSpecSchema = z.object({
  format: z.string(),
  structure: exportStructureSpecSchema,
  selection: exportSelectionSchema,
  data: exportDataSelectionSchema,
  sanitize: exportSanitizeSpecSchema,
  csv: exportCsvSpecSchema,
  output: exportOutputSpecSchema,
  on_error: exportOnErrorSchema,
  idempotency_key: z.string().nullable(),
})
export type ExportSpec = z.infer<typeof exportSpecSchema>

// ── Catálogo en vivo (`GET /database-exports/{id}/objects`) ──────────────────────
/**
 * Un objeto del catálogo del motor.
 *
 * - `estimated_rows` es una **estimación del catálogo** (`TABLE_ROWS` / `reltuples`), no un conteo
 *   exacto: se etiqueta como aproximada (`~15 K`).
 * - `size_bytes` es **hoy siempre `null`**; no se construye nada que dependa de él.
 * - `has_primary_key: false` ⇒ esa tabla, si lleva datos, sale sin orden garantizado.
 * - `has_primary_key` y `has_triggers` son `null` cuando el concepto **no aplica** al tipo de
 *   objeto: una rutina, una vista o un trigger no tienen clave primaria. `null` no es lo mismo
 *   que `false` — «no aplica» y «le falta» se muestran distinto, así que compáralos en estricto.
 */
export const exportCatalogObjectSchema = z.object({
  object_type: z.string(),
  name: z.string(),
  estimated_rows: z.number().int().nullable(),
  size_bytes: z.number().int().nullable(),
  charset: z.string().nullable(),
  collation: z.string().nullable(),
  has_primary_key: z.boolean().nullable(),
  has_triggers: z.boolean().nullable(),
  is_materialized: z.boolean().nullable(),
  row_filter: z.boolean(),
})
export type ExportCatalogObject = z.infer<typeof exportCatalogObjectSchema>

/**
 * `data` de `GET .../objects`. **No usa el envelope paginado estándar**: la paginación viaja DENTRO
 * del objeto (`total`/`page`/`size`) porque la respuesta lleva metadatos de catálogo que una lista
 * plana no transporta. `excluded_internal` son las tablas de contabilidad del gateway (`_gw_v_`,
 * `_gw_stg_`) que se descartan siempre — se muestran en un pie de lista para que nadie las busque
 * en el artefacto y crea que se perdieron.
 */
export const exportObjectCatalogSchema = z.object({
  engine: engineTypeSchema,
  database: z.string(),
  scope_note: z.string().nullable(),
  object_types: z.array(z.string()),
  counts_by_type: z.record(z.string(), z.number().int()),
  objects: z.array(exportCatalogObjectSchema),
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
  excluded_internal: z.array(z.string()),
})
export type ExportObjectCatalog = z.infer<typeof exportObjectCatalogSchema>

// ── Resolución de selección (`POST /database-exports/{id}/resolve-selection`) ─────
export const exportObjectRefSchema = z.object({
  object_type: z.string(),
  name: z.string(),
})
export type ExportObjectRef = z.infer<typeof exportObjectRefSchema>

/**
 * Una arista del grafo de dependencias. Con `authoritative: true` es firme (una FK, p. ej.) y sirve
 * para dibujar el árbol; las de `advisory` son referencias detectadas dentro de cuerpos
 * (best-effort) y se presentan como sugerencias, no como obligaciones.
 */
export const exportDependencyEdgeSchema = z.object({
  from_type: z.string(),
  from_name: z.string(),
  to_type: z.string(),
  to_name: z.string(),
  reason: z.string(),
  authoritative: z.boolean(),
})
export type ExportDependencyEdge = z.infer<typeof exportDependencyEdgeSchema>

/**
 * `data` de `POST .../resolve-selection`: resuelve las dos selecciones y el cierre de dependencias
 * **sin congelar nada**.
 *
 * La política depende de quién eligió, y la UI lo refleja: una selección **explícita**
 * (`mode: "include"`) a la que le falta una dependencia da 422 `export.missing_dependencies` —no se
 * recorta en silencio— y hay que reintentar con `auto_resolve_dependencies: true`, tras lo cual lo
 * agregado vuelve en `added` y se muestra con un distintivo (el usuario no lo eligió). Una
 * selección **automática** (`all`, `all_except`, patrones) se poda y vuelve en
 * `excluded_by_dependency`.
 */
export const exportResolvedSelectionSchema = z.object({
  structure: z.array(exportObjectRefSchema),
  data: z.array(z.string()),
  added: z.array(exportObjectRefSchema),
  excluded_by_dependency: z.array(exportObjectRefSchema),
  edges: z.array(exportDependencyEdgeSchema),
  advisory: z.array(exportDependencyEdgeSchema),
  excluded_internal: z.array(z.string()),
  unknown_names: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type ExportResolvedSelection = z.infer<typeof exportResolvedSelectionSchema>

// ── Preview (`POST /database-exports/{id}/preview`) ──────────────────────────────
/**
 * Un objeto planificado. **`seq` es 1..N y `step` es la fuente de verdad del orden** en que el
 * objeto va a salir en el artefacto (`phase` es solo una etiqueta legible): la lista se renderiza
 * en el orden en que llega y no se reordena alfabéticamente, porque el orden es una garantía del
 * backend, no un detalle de presentación. `deterministic: false` ⇒ esa tabla sale sin orden
 * garantizado (sin PK y sin una tupla de columnas ordenable): ícono de advertencia en la fila.
 */
export const exportPlannedObjectSchema = z.object({
  seq: z.number().int(),
  object_type: z.string(),
  name: z.string(),
  phase: z.string(),
  step: z.number().int(),
  with_data: z.boolean(),
  estimated_rows: z.number().int().nullable(),
  deterministic: z.boolean(),
})
export type ExportPlannedObject = z.infer<typeof exportPlannedObjectSchema>

/**
 * `data` de `POST .../preview` — el endpoint más importante de la pantalla: valida el spec entero,
 * **congela** la selección y emite el `confirm_token`.
 *
 * - `confirm_token` es `null` cuando se pidió `dry_run_only: true`, y ese es el punto: valida y
 *   reporta sin congelar nada, así que sirve para el panel vivo de consecuencias en cada cambio del
 *   formulario. El preview "de verdad" se llama solo cuando el usuario confirma, y **cada uno
 *   reemplaza el token anterior**.
 * - `warnings` es una lista y **se muestra entera**: ahí viven el aviso de consistencia asimétrica
 *   de MySQL/MariaDB, las tablas sin PK, el `.zip` implícito y los `where` definidos para tablas
 *   que no están en la selección de datos.
 * - `advisories` son reglas de la matriz que se cumplen pero NO bloquean.
 * - `estimated_bytes` es una estimación gruesa (filas × ancho nominal): se presenta como «≈».
 * - `sample` es hoy siempre `null`; se deja sin tipar porque no se construye una vista previa del
 *   contenido (leerlo sería una segunda divulgación de datos en claro).
 */
export const exportPreviewSchema = z.object({
  job_id: z.number().int(),
  engine: engineTypeSchema,
  database: z.string(),
  format: z.string(),
  scope_note: z.string().nullable(),
  objects: z.array(exportPlannedObjectSchema),
  data_tables: z.array(z.string()),
  estimated_rows: z.number().int(),
  estimated_bytes: z.number().int(),
  inline_delivery_viable: z.boolean(),
  inline_max_bytes: z.number().int(),
  warnings: z.array(z.string()),
  advisories: z.array(exportCompatibilityRuleSchema),
  excluded_by_dependency: z.array(exportObjectRefSchema),
  sample: z.unknown(),
  confirm_token: z.string().nullable(),
})
export type ExportPreview = z.infer<typeof exportPreviewSchema>

// ── Job (crear / leer / ejecutar / cancelar) ─────────────────────────────────────
/** Metadatos del artefacto, presentes en `progress` una vez que el job terminó. */
export const exportArtifactInfoSchema = z.object({
  byte_size: z.number().int().nullable(),
  sha256: z.string().nullable(),
  part_count: z.number().int().nullable(),
})
export type ExportArtifactInfo = z.infer<typeof exportArtifactInfoSchema>

/**
 * Avance del job. Se persiste **throttleado a ~3 s**: no hay que esperar un cambio en cada
 * llamada, y **no hay porcentaje** (el total real de bytes no se sabe de antemano), así que la
 * barra es indeterminada con el nombre de la fase y los contadores.
 *
 * `degradations` lista las garantías que NO se pudieron aplicar (p. ej. que el motor rechazó el
 * `SET idle_in_transaction_session_timeout`); si viene no vacía, se muestra.
 */
export const exportProgressSchema = z.object({
  phase: exportJobPhaseSchema,
  objects: z.number().int(),
  rows: z.number().int(),
  statements: z.number().int(),
  tables_with_data: z.number().int(),
  bytes: z.number().int(),
  warnings: z.array(z.string()),
  generator_version: z.string(),
  engine_version: z.string().nullish(),
  degradations: z.array(z.string()).nullish(),
  artifact: exportArtifactInfoSchema.nullish(),
  elapsed_ms: z.number().nullish(),
})
export type ExportProgress = z.infer<typeof exportProgressSchema>

/**
 * `data` de crear / leer / ejecutar / cancelar — la cabecera del job y la base del polling
 * (cada 2–3 s mientras `status` es `pending` o `running`; este endpoint no tiene rate limit
 * a propósito).
 *
 * - `expired` es el vencimiento del **PLAN** (24 h), que afecta a `preview`/`execute`. El del
 *   **ARTEFACTO** (30 min desde que el job termina) es otro y afecta a `download`/`content`.
 * - `has_resolved_selection: false` = todavía no se previsualizó.
 * - `structure_drift_detected: true` = el esquema cambió DURANTE la corrida. No invalida el
 *   artefacto (los datos siguen siendo consistentes) pero el operador tiene que enterarse: banda de
 *   advertencia junto a la descarga.
 */
export const exportSummarySchema = z.object({
  id: z.number().int(),
  server_id: z.number().int(),
  database_name: z.string(),
  database_id: z.number().int().nullable(),
  engine: engineTypeSchema,
  format: z.string(),
  status: exportJobStatusSchema,
  phase: exportJobPhaseSchema.nullable(),
  progress: exportProgressSchema.nullable(),
  error: z.string().nullable(),
  expired: z.boolean(),
  structure_drift_detected: z.boolean(),
  has_resolved_selection: z.boolean(),
  idempotency_key: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
})
export type ExportSummary = z.infer<typeof exportSummarySchema>

// ── Reporte por objeto (`GET /database-exports/{id}/items`) ──────────────────────
/**
 * Un objeto del reporte, en orden de emisión. Paginado estándar.
 *
 * ⚠️ Los ítems se escriben **de una sola vez, al TERMINAR el job**: durante `pending` y `running`
 * este endpoint devuelve lista vacía. Por eso el reporte pertenece a la pantalla de resultado y no
 * se arma una tabla de incidencias "en vivo" en el monitor (mostraría «0 incidencias» durante toda
 * la exportación, que es lo contrario de la verdad).
 *
 * `reason` es de **vocabulario cerrado** y nunca el mensaje del driver (podría incrustar valores de
 * filas); se traduce en `messages.ts`.
 */
export const exportItemSchema = z.object({
  id: z.number().int(),
  job_id: z.number().int(),
  seq: z.number().int(),
  object_type: z.string(),
  object_name: z.string(),
  phase: z.string(),
  status: exportItemStatusSchema,
  reason: z.string().nullable(),
  rows_exported: z.number().int().nullable(),
  bytes_written: z.number().int().nullable(),
  deterministic: z.boolean().nullable(),
  execution_ms: z.number().nullable(),
  executed_at: z.string().nullable(),
})
export type ExportItem = z.infer<typeof exportItemSchema>

// ── Manifiesto (`GET /database-exports/{id}/manifest`) ───────────────────────────
export const exportManifestObjectSchema = z.object({
  object_type: z.string(),
  name: z.string(),
  status: exportItemStatusSchema,
  rows_exported: z.number().int().nullable(),
  bytes_written: z.number().int().nullable(),
  deterministic: z.boolean().nullable(),
  reason: z.string().nullable(),
})
export type ExportManifestObject = z.infer<typeof exportManifestObjectSchema>

/**
 * `data` de `GET .../manifest` — inventario verificable **sin abrir el archivo** (mirar el
 * contenido para saber qué se llevó sería una segunda divulgación). Tiene una propiedad valiosa:
 * **sobrevive a `consumed` y a `purged`**, así que «¿qué me llevé?» se sigue pudiendo responder
 * después de descargar o de que el artefacto se purgue.
 *
 * ⚠️ **`complete: false` NO significa "parcial" por sí solo.** El endpoint responde también sobre
 * un job que todavía no terminó, y ahí `complete` es `false` simplemente porque aún no hay nada
 * completo. La regla correcta es: *artefacto parcial ⇔ `status` terminal **y** `complete === false`*.
 * Por eso los metadatos del artefacto son nullable: sobre un job en curso todavía no existen.
 *
 * `sha256` es el mismo valor que viaja en el `ETag` y en `X-Export-Sha256` de la descarga, para que
 * el operador verifique el archivo que bajó.
 *
 * `spec` se deja **opaco** a propósito: es el eco de lo que se ejecutó, no un contrato que la UI
 * dirija. Validarlo campo a campo dejaría que una adición inocua del backend rompiera justo la
 * pantalla que tiene que sobrevivir a `consumed`/`purged`.
 */
export const exportManifestSchema = z.object({
  job_id: z.number().int(),
  engine: engineTypeSchema,
  engine_version: z.string(),
  database: z.string(),
  format: z.string(),
  complete: z.boolean(),
  structure_drift_detected: z.boolean(),
  generator_version: z.string(),
  spec: z.record(z.string(), z.unknown()),
  objects: z.array(exportManifestObjectSchema),
  total_rows: z.number().int().nullable(),
  byte_size: z.number().int().nullable(),
  sha256: z.string().nullable(),
  part_count: z.number().int().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
})
export type ExportManifest = z.infer<typeof exportManifestSchema>

// ── Entregas sin `ApiResponse` (`download` / `content`) ──────────────────────────
/**
 * Metadatos de una entrega de artefacto, leídos de las **cabeceras** de `download`/`content`. No
 * tienen otra vía de llegada: `X-Export-Complete: false` es lo único que advierte —antes de que el
 * usuario ejecute el archivo— de que el artefacto es PARCIAL.
 */
export interface ExportArtifactDelivery {
  /** `X-Export-Sha256` (o el `ETag` sin comillas): checksum con el que verificar lo que bajó. */
  sha256: string | null
  /** `X-Export-Complete`. `false` ⇒ artefacto parcial: banda roja ANTES de descargar. */
  complete: boolean | null
  /** `Content-Length` real de la entrega. */
  byteSize: number | null
}
