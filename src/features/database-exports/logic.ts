import type {
  EngineType,
  ExportCapabilities,
  ExportCompatibilityRule,
  ExportCsvDialect,
  ExportOption,
  ExportSpec,
} from '@/lib/contracts'

/**
 * Lógica pura del módulo de exportación. **Aquí vive la única copia de las reglas del formulario**,
 * y ninguna de esas reglas está escrita a mano: todas se derivan de `capabilities`.
 *
 * El objetivo del módulo entero es que el cliente no duplique lógica de negocio. Si en algún
 * componente aparece un `if (format === 'csv')`, algo se hizo mal: la matriz de compatibilidad ya
 * dice qué apaga `csv`, y el evaluador de este archivo la aplica sin conocer ni un formato.
 *
 * Sin React, sin efectos, sin fetch. Todo testeado en `logic.test.ts`.
 */

// ── Lectura y escritura por ruta con puntos ─────────────────────────────────────
/**
 * Las claves de `capabilities.options` y las entradas de `forbids`/`requires` son **rutas con
 * puntos del campo en el `ExportSpec`** (`sanitize.definer`, `sanitize.charset_override.mode`).
 * Recorrerlas de forma genérica es lo que permite que el formulario no conozca ningún campo.
 */
export function readSpecValue(spec: ExportSpec, path: string): unknown {
  let current: unknown = spec
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Copia inmutable del spec con `path` puesto a `value`. Crea los tramos intermedios que falten. */
export function writeSpecValue(spec: ExportSpec, path: string, value: unknown): ExportSpec {
  const segments = path.split('.')

  const assign = (node: unknown, depth: number): unknown => {
    const key = segments[depth]!
    const base: Record<string, unknown> =
      node !== null && typeof node === 'object' ? { ...(node as Record<string, unknown>) } : {}
    base[key] = depth === segments.length - 1 ? value : assign(base[key], depth + 1)
    return base
  }

  return assign(spec, 0) as ExportSpec
}

/** Copia inmutable del spec SIN `path`. Se usa para no enviar opciones que el motor no tiene. */
export function omitSpecPath(spec: ExportSpec, path: string): ExportSpec {
  const segments = path.split('.')

  const strip = (node: unknown, depth: number): unknown => {
    if (node === null || typeof node !== 'object') return node
    const key = segments[depth]!
    const base = { ...(node as Record<string, unknown>) }
    if (!(key in base)) return node
    if (depth === segments.length - 1) delete base[key]
    else base[key] = strip(base[key], depth + 1)
    return base
  }

  return strip(spec, 0) as ExportSpec
}

// ── Valores neutros y presencia ─────────────────────────────────────────────────
/**
 * Un `forbids` con la forma `"ruta.opcion"` (sin `=valor`) exige que esa opción esté en su **valor
 * neutro**: `NONE` para los enumerados de DDL, `"none"` para `insert_variant` y `compression`,
 * `false` para los booleanos, `null` para `split_max_bytes`, y vacío para las listas.
 */
export function isNeutralValue(value: unknown): boolean {
  if (value == null) return true
  if (value === false) return true
  if (typeof value === 'string') return value.length === 0 || value === 'NONE' || value === 'none'
  if (Array.isArray(value)) return value.length === 0
  // Un 0 NO es neutro: `rows_per_statement: 0` es un valor configurado, no la ausencia de valor.
  return false
}

/**
 * Texto con el que comparar un valor del spec contra un valor de la matriz, o `null` si el valor no
 * es comparable.
 *
 * La matriz apunta siempre a un campo escalar, pero su `when`/`forbids` es texto libre venido del
 * backend: si una ruta apuntara por error a un bloque entero, un `String(...)` a secas daría
 * `"[object Object]"` y la regla parecería «evaluada y no aplicable» en lugar de lo que es —
 * inaplicable por construcción. Devolver `null` deja esa diferencia visible en el código.
 */
function comparableString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** Un `requires` exige que la opción esté presente y no vacía. */
export function isPresentValue(value: unknown): boolean {
  if (value == null || value === false) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

/**
 * Cuál es el valor neutro de una opción concreta. Se deriva de sus `values` en vez de mapearlo a
 * mano: si el backend renombra el valor apagado, el formulario lo sigue apagando bien.
 */
export function neutralValueFor(option: ExportOption | undefined, current: unknown): unknown {
  if (option) {
    if (isBooleanOption(option)) return false
    if (option.values.includes('NONE')) return 'NONE'
    if (option.values.includes('none')) return 'none'
  }
  if (typeof current === 'boolean') return false
  if (typeof current === 'string') return ''
  if (Array.isArray(current)) return []
  return null
}

// ── Controles derivados de `capabilities.options` ───────────────────────────────
/**
 * Una opción es booleana cuando su `default` es un boolean de verdad y sus `values` son los strings
 * `"true"`/`"false"`. Esa asimetría existe en el backend y se normaliza **solo aquí**.
 */
export function isBooleanOption(option: ExportOption): boolean {
  if (typeof option.default === 'boolean') return true
  return (
    option.values.length === 2 && option.values.includes('true') && option.values.includes('false')
  )
}

/** Un control del formulario, listo para renderizar sin decidir nada más. */
export interface ExportControl {
  /** Ruta con puntos del campo en el `ExportSpec`. Es la clave en `capabilities.options`. */
  path: string
  option: ExportOption
  /** Primer tramo de la ruta (`structure`, `data`, `sanitize`, `csv`, `output`) — agrupa la UI. */
  group: string
  /** El resto de la ruta, para la etiqueta del control. */
  leaf: string
  kind: 'boolean' | 'enum'
}

/** Convierte `capabilities.options` en la lista de controles, en orden estable por ruta. */
export function buildExportControls(capabilities: ExportCapabilities): ExportControl[] {
  return Object.entries(capabilities.options)
    .map(([path, option]) => {
      const dot = path.indexOf('.')
      const group = dot === -1 ? path : path.slice(0, dot)
      return {
        path,
        option,
        group,
        leaf: dot === -1 ? path : path.slice(dot + 1),
        kind: isBooleanOption(option) ? ('boolean' as const) : ('enum' as const),
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Un grupo de opciones es **propio de un formato** cuando su nombre coincide con el de un formato
 * declarado en `capabilities.formats` (hoy: `csv`). Solo se muestra si ese es el formato elegido.
 *
 * Es una regla, no un hardcode: si mañana el backend expone opciones `parquet.*`, aparecen solas
 * al elegir ese formato y desaparecen con cualquier otro, sin tocar este archivo.
 */
export function isFormatScopedGroup(group: string, capabilities: ExportCapabilities): boolean {
  return capabilities.formats.some((format) => format.name === group)
}

/** Los grupos de opciones visibles para el formato elegido, en el orden en que se presentan. */
export function visibleControlGroups(
  controls: readonly ExportControl[],
  capabilities: ExportCapabilities,
  format: string,
): string[] {
  const groups: string[] = []
  for (const control of controls) {
    if (groups.includes(control.group)) continue
    if (isFormatScopedGroup(control.group, capabilities) && control.group !== format) continue
    groups.push(control.group)
  }
  return groups
}

/**
 * Convierte el valor crudo de un `<select>`/`<input>` al tipo que el spec espera, resolviendo la
 * asimetría boolean/string de `capabilities.options` en un solo sitio.
 */
export function coerceOptionValue(option: ExportOption, raw: string): unknown {
  if (isBooleanOption(option)) return raw === 'true'
  if (typeof option.default === 'number') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : option.default
  }
  return raw.length === 0 && option.default === null ? null : raw
}

// ── Evaluador de la matriz de compatibilidad ────────────────────────────────────
/** Lo que la matriz restringe sobre UNA opción, ya resuelto para el estado actual del formulario. */
export interface ExportOptionConstraint {
  /** La opción debe estar en su valor neutro: el control se deshabilita. */
  forcedNeutral: boolean
  /** Valores concretos prohibidos: esas entradas del select se deshabilitan. */
  forbiddenValues: Set<string>
  /** La opción es obligatoria y no puede quedar vacía. */
  required: boolean
  /** Los `reason` de las reglas que la restringen, listos para mostrar como ayuda contextual. */
  reasons: string[]
}

/** Una regla activa que el spec actual está violando. Impide el envío. */
export interface ExportRuleViolation {
  rule: ExportCompatibilityRule
  /** Rutas del spec culpables, con el comodín ya expandido. */
  fields: string[]
  kind: 'forbids' | 'requires'
}

export interface ExportMatrixEvaluation {
  /** Reglas activas y bloqueantes que el spec viola ahora mismo. Si no está vacío, no se envía. */
  violations: ExportRuleViolation[]
  /** Reglas activas con `blocking: false`: se muestran como avisos y NO deshabilitan nada. */
  advisories: ExportCompatibilityRule[]
  /** Restricciones por ruta de opción, para deshabilitar controles y valores. */
  constraints: Map<string, ExportOptionConstraint>
}

/**
 * ¿Aplica esta regla al estado actual? Aplica si **todas** las claves de `when` coinciden.
 *
 * La clave especial `engine` se compara contra `capabilities.engine`, **no** contra el spec: la
 * matriz viaja entera, incluidas las reglas de otros motores, y filtrarlas es trabajo del cliente.
 * La comparación se hace en texto porque `when` puede traer strings, booleanos o números para el
 * mismo campo según cómo lo declare el backend.
 */
export function ruleApplies(
  rule: ExportCompatibilityRule,
  spec: ExportSpec,
  engine: EngineType,
): boolean {
  return Object.entries(rule.when).every(([key, expected]) => {
    const actual = comparableString(key === 'engine' ? engine : readSpecValue(spec, key))
    return actual !== null && actual === comparableString(expected)
  })
}

/**
 * Expande una entrada de `forbids`. `"structure.*"` se resuelve contra las claves reales de
 * `capabilities.options` con ese prefijo, en vez de contra una lista escrita a mano: así el comodín
 * sigue cubriendo todo el grupo si el backend agrega una opción nueva.
 */
export function expandForbidEntry(entry: string, capabilities: ExportCapabilities): string[] {
  if (!entry.endsWith('.*')) return [entry]
  const prefix = entry.slice(0, -1) // conserva el punto: `structure.`
  return Object.keys(capabilities.options).filter((path) => path.startsWith(prefix))
}

function ensureConstraint(
  constraints: Map<string, ExportOptionConstraint>,
  path: string,
): ExportOptionConstraint {
  const existing = constraints.get(path)
  if (existing) return existing
  const created: ExportOptionConstraint = {
    forcedNeutral: false,
    forbiddenValues: new Set<string>(),
    required: false,
    reasons: [],
  }
  constraints.set(path, created)
  return created
}

/**
 * Evalúa la matriz completa contra el spec actual. Se recalcula en cada cambio del formulario y su
 * resultado se usa para (a) deshabilitar controles, (b) mostrar el `reason` como ayuda contextual y
 * (c) impedir el envío.
 *
 * Como el servidor evalúa exactamente lo mismo, un 422 `export.incompatible_option` que llegue
 * igual es un **bug de este evaluador**, no del usuario — y por eso `messages.ts` lo loguea.
 */
export function evaluateExportMatrix(
  spec: ExportSpec,
  capabilities: ExportCapabilities,
): ExportMatrixEvaluation {
  const violations: ExportRuleViolation[] = []
  const advisories: ExportCompatibilityRule[] = []
  const constraints = new Map<string, ExportOptionConstraint>()

  for (const rule of capabilities.compatibility) {
    if (!ruleApplies(rule, spec, capabilities.engine)) continue

    // Un aviso se muestra y punto: no deshabilita controles ni impide enviar.
    if (!rule.blocking) {
      advisories.push(rule)
      continue
    }

    const forbiddenFields: string[] = []
    for (const entry of rule.forbids) {
      const [rawPath, forbiddenValue] = entry.split('=', 2)
      for (const path of expandForbidEntry(rawPath!, capabilities)) {
        const constraint = ensureConstraint(constraints, path)
        if (!constraint.reasons.includes(rule.reason)) constraint.reasons.push(rule.reason)
        const current = readSpecValue(spec, path)

        if (forbiddenValue === undefined) {
          constraint.forcedNeutral = true
          if (!isNeutralValue(current)) forbiddenFields.push(path)
        } else {
          constraint.forbiddenValues.add(forbiddenValue)
          if (comparableString(current) === forbiddenValue) forbiddenFields.push(path)
        }
      }
    }
    if (forbiddenFields.length > 0) {
      violations.push({ rule, fields: forbiddenFields, kind: 'forbids' })
    }

    const missingFields: string[] = []
    for (const path of rule.requires) {
      const constraint = ensureConstraint(constraints, path)
      constraint.required = true
      if (!constraint.reasons.includes(rule.reason)) constraint.reasons.push(rule.reason)
      if (!isPresentValue(readSpecValue(spec, path))) missingFields.push(path)
    }
    if (missingFields.length > 0) {
      violations.push({ rule, fields: missingFields, kind: 'requires' })
    }
  }

  return { violations, advisories, constraints }
}

/**
 * Aplica las restricciones al spec: apaga lo que quedó prohibido y sustituye los valores concretos
 * vetados por el primer valor admitido.
 *
 * Es lo que hace que «elegir csv» apague de verdad toda la sección de estructura en vez de dejarla
 * encendida pero deshabilitada — que es la trampa: un control deshabilitado con un valor vivo
 * detrás se sigue enviando, y el 422 llega igual.
 */
export function normalizeSpecForConstraints(
  spec: ExportSpec,
  capabilities: ExportCapabilities,
  evaluation: ExportMatrixEvaluation,
): ExportSpec {
  let next = spec
  for (const [path, constraint] of evaluation.constraints) {
    const option = capabilities.options[path]
    const current = readSpecValue(next, path)

    if (constraint.forcedNeutral) {
      if (!isNeutralValue(current))
        next = writeSpecValue(next, path, neutralValueFor(option, current))
      continue
    }
    const currentText = comparableString(current)
    if (currentText !== null && constraint.forbiddenValues.has(currentText)) {
      // Se descartan los valores destructivos: sustituir automáticamente lo que el usuario eligió
      // por un `DROP_CREATE` que nunca pidió —solo porque es el primero de la lista que la matriz
      // admite— sería escalar la operación en silencio. Si no queda ningún valor inocuo, se apaga.
      const allowed = option?.values.find(
        (value) => !constraint.forbiddenValues.has(value) && !option.destructive.includes(value),
      )
      next = writeSpecValue(
        next,
        path,
        option && allowed !== undefined
          ? coerceOptionValue(option, allowed)
          : neutralValueFor(option, current),
      )
    }
  }
  return next
}

// ── Spec inicial ────────────────────────────────────────────────────────────────
/**
 * Los defaults documentados de los campos que **no** son opciones de `capabilities.options`
 * (listas, patrones, filtros por tabla): esos no viajan en la matriz porque no son controles con
 * valores enumerados. Todo lo que sí es una opción se sobrescribe con su `default` real.
 *
 * `data.mode: 'none'` es deliberado: el modo "solo estructura" es el caso seguro y el default
 * visual del formulario. Quien necesita datos sabe que los necesita.
 */
const SPEC_SKELETON: ExportSpec = {
  format: 'sql',
  structure: {
    scope_ddl: 'NONE',
    entity_ddl: 'CREATE',
    drop_if_exists: true,
    drop_cascade: false,
    confirm_scope_drop: null,
  },
  selection: { mode: 'all', types: [], names: [], include_patterns: [], exclude_patterns: [] },
  data: {
    mode: 'none',
    names: [],
    include_patterns: [],
    exclude_patterns: [],
    insert_variant: 'insert',
    rows_per_statement: 200,
    max_statement_bytes: 1_048_576,
    include_column_list: true,
    per_object: {},
  },
  sanitize: {
    script_comments: true,
    object_comments: true,
    definer: 'auto',
    definer_value: null,
    autoincrement: 'auto',
    engine_specific_options: false,
    partitions: true,
    constraints_placement: 'deferred',
    session_preamble: true,
    transaction_wrap: false,
    charset_override: { mode: 'keep', charset: null, collation: null },
  },
  csv: {
    delimiter: ',',
    quote_char: '"',
    escape_char: null,
    line_terminator: 'lf',
    header: true,
    null_representation: '',
    bom: false,
  },
  output: {
    organization: 'single',
    split_max_bytes: null,
    compression: 'none',
    filename_template: '{database}-{date}-{job_id}',
    file_encoding: 'utf-8',
    delivery: 'file',
    binary_encoding: 'hex',
    schema_manifest: false,
  },
  on_error: 'continue',
  idempotency_key: null,
}

/**
 * El spec inicial del formulario: el esqueleto de defaults documentados con **todos** los valores de
 * `capabilities.options` ya resueltos para este motor. Es lo que hace que en PostgreSQL
 * `sanitize.definer` arranque en `keep` y en MySQL en `omit` sin que la UI sepa por qué.
 *
 * Los límites numéricos también salen de capabilities: enviar los del esqueleto cuando el gateway
 * tiene otros configurados es pedir un 422 por un valor que nunca elegimos.
 */
export function buildDefaultExportSpec(capabilities: ExportCapabilities): ExportSpec {
  let spec: ExportSpec = {
    ...SPEC_SKELETON,
    format: capabilities.formats[0]?.name ?? SPEC_SKELETON.format,
    data: {
      ...SPEC_SKELETON.data,
      rows_per_statement: capabilities.limits.rows_per_statement,
      max_statement_bytes: capabilities.limits.max_statement_bytes,
    },
    csv: {
      ...SPEC_SKELETON.csv,
      delimiter: capabilities.csv_dialect.delimiter,
      quote_char: capabilities.csv_dialect.quote_char,
      escape_char: capabilities.csv_dialect.escape_char,
      null_representation: capabilities.csv_dialect.null_representation,
    },
  }

  for (const [path, option] of Object.entries(capabilities.options)) {
    // Una opción no aplicable a este motor conserva el valor del esqueleto y no se envía nunca.
    if (!option.applicable) continue
    spec = writeSpecValue(spec, path, option.default)
  }

  return spec
}

// ── Los dos conjuntos: estructura y datos ───────────────────────────────────────
/**
 * Modo "solo datos": con `scope_ddl` y `entity_ddl` ambos en `NONE` la restricción `data ⊆
 * selection` **no aplica**. Es un caso de uso frecuente (recargar una tabla que ya existe en el
 * destino) y la única forma en que `csv`/`json`/`ndjson` pueden existir.
 */
export function isDataOnlyMode(spec: ExportSpec): boolean {
  return spec.structure.scope_ddl === 'NONE' && spec.structure.entity_ddl === 'NONE'
}

/** Clave estable de un objeto del catálogo (`tipo:nombre`), para mapas y query keys. */
export function exportObjectKey(objectType: string, name: string): string {
  return `${objectType}:${name}`
}

/**
 * Tablas marcadas para datos cuya estructura quedó fuera. Violar `data ⊆ selection` es un 422
 * `export.data_without_structure`, así que se detecta en el cliente para ofrecer las dos salidas
 * que el contrato sugiere: agregar esas tablas a la estructura, o pasar a modo "solo datos".
 *
 * En modo "solo datos" siempre devuelve vacío: ahí la restricción no existe.
 */
export function findDataWithoutStructure(
  structureNames: ReadonlySet<string>,
  dataTables: Iterable<string>,
  dataOnly: boolean,
): string[] {
  if (dataOnly) return []
  const orphans: string[] = []
  for (const table of dataTables) {
    if (!structureNames.has(table) && !orphans.includes(table)) orphans.push(table)
  }
  return orphans
}

/** Alterna una entrada de un mapa de selección devolviendo una copia (nunca muta). */
export function toggleSelectionEntry<T>(
  selection: ReadonlyMap<string, T>,
  key: string,
  value: T,
): Map<string, T> {
  const next = new Map(selection)
  if (next.has(key)) next.delete(key)
  else next.set(key, value)
  return next
}

// ── Validaciones de cortesía en el cliente ──────────────────────────────────────
/**
 * Un problema detectado en el cliente. **No bloquea el envío**: el backend es la autoridad y estas
 * comprobaciones son aproximadas (un `--` dentro de una cadena literal puede dar un falso
 * positivo). Se muestran al escribir para que el usuario no descubra el error tras pagar el
 * viaje al servidor, y usan el MISMO vocabulario cerrado de `reason` que el backend para que el
 * texto mostrado sea idéntico venga de donde venga.
 */
export interface RowFilterIssue {
  reason: string
  /** Fragmento que disparó la detección, para señalarlo en el mensaje. */
  danger?: string
}

/** Quita las cadenas literales antes de buscar palabras peligrosas, para evitar falsos positivos. */
function stripStringLiterals(where: string): string {
  return where.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""')
}

const WRITE_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|call|do|merge|replace)\b/i
const SUBQUERY_KEYWORDS = /\b(select|with|union|intersect|except)\b/i

/**
 * Valida el filtro `where` de una tabla contra las reglas que el backend hace cumplir (§6.3): tiene
 * que ser una condición de lectura simple sobre esa misma tabla, sin comentarios, sin `;`, sin
 * subconsultas ni CTEs.
 *
 * `#` solo es comentario en MySQL/MariaDB; en PostgreSQL es un operador válido, así que comprobarlo
 * ahí rechazaría filtros correctos.
 */
export function validateRowFilter(
  where: string,
  engine: EngineType,
  maxLength: number,
): RowFilterIssue | null {
  const trimmed = where.trim()
  if (trimmed.length === 0) return { reason: 'empty_filter' }
  if (Number.isFinite(maxLength) && maxLength > 0 && trimmed.length > maxLength) {
    return { reason: 'too_long' }
  }

  const bare = stripStringLiterals(trimmed)
  if (bare.includes(';')) return { reason: 'multiple_statements', danger: ';' }

  const commentTokens = engine === 'postgresql' ? ['--', '/*', '*/'] : ['--', '/*', '*/', '#']
  const comment = commentTokens.find((token) => bare.includes(token))
  if (comment) return { reason: 'comment_not_allowed', danger: comment }

  const write = WRITE_KEYWORDS.exec(bare)
  if (write) return { reason: 'not_read_only', danger: write[0] }

  const subquery = SUBQUERY_KEYWORDS.exec(bare)
  if (subquery) return { reason: 'subquery_not_allowed', danger: subquery[0] }

  return null
}

/**
 * Tokens admitidos en `output.filename_template`. Es la única lista de este archivo escrita a mano,
 * y no por comodidad: `capabilities` no la transporta (solo llega en el `allowed` del 422). Cuando
 * el backend la exponga, esta constante se borra y se lee de ahí.
 */
export const EXPORT_FILENAME_TOKENS = ['database', 'object', 'date', 'time', 'job_id'] as const

export interface FilenameTemplateIssue {
  /** Tokens no reconocidos, sin las llaves. */
  unknownTokens: string[]
  /** Hay una llave suelta sin cerrar (o un `}` sin abrir). */
  unbalanced: boolean
}

/** Valida la plantilla del nombre de archivo. Devuelve `null` si está bien. */
export function validateFilenameTemplate(template: string): FilenameTemplateIssue | null {
  const unknownTokens: string[] = []
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const token = match[1] ?? ''
    const known = (EXPORT_FILENAME_TOKENS as readonly string[]).includes(token)
    if (!known && !unknownTokens.includes(token)) unknownTokens.push(token)
  }

  // Una llave suelta se detecta comparando cuántas hay con cuántas consumieron los tokens válidos.
  const braces = (template.match(/[{}]/g) ?? []).length
  const paired = (template.match(/\{[^{}]*\}/g) ?? []).length * 2
  const unbalanced = braces !== paired

  if (unknownTokens.length === 0 && !unbalanced) return null
  return { unknownTokens, unbalanced }
}

/**
 * Campos del dialecto csv que deben ser **exactamente un carácter**. Qué campos son sale de
 * `csv_dialect.single_char_options`, no de una lista escrita aquí. `escape_char` admite además
 * quedar vacío (`null` = sin carácter de escape), y por eso una cadena vacía no es un error.
 */
export function validateSingleCharOptions(
  csv: Record<string, unknown>,
  dialect: ExportCsvDialect,
): Record<string, string> {
  const issues: Record<string, string> = {}
  for (const field of dialect.single_char_options) {
    const value = csv[field]
    if (value == null || value === '') continue
    if (typeof value !== 'string' || Array.from(value).length !== 1) {
      issues[field] = 'Tiene que ser exactamente un carácter.'
    }
  }
  return issues
}

// ── Empaquetado ─────────────────────────────────────────────────────────────────
/**
 * ¿Va a salir multiarchivo? Las condiciones vienen en `packaging.multifile_when` con la misma
 * sintaxis que `forbids`, así que se evalúan con las mismas piezas.
 *
 * Importa porque `container_is_implicit` significa que **multiarchivo ⇒ zip aunque se pida
 * `compression: "none"`**: el backend no lo rechaza, lo resuelve, y el usuario tiene derecho a
 * saber antes de darle a exportar que va a bajar un `.zip`.
 */
export function willBeMultifile(spec: ExportSpec, capabilities: ExportCapabilities): boolean {
  return capabilities.packaging.multifile_when.some((entry) => {
    const [path, expected] = entry.split('=', 2)
    const current = readSpecValue(spec, path!)
    return expected === undefined
      ? !isNeutralValue(current)
      : comparableString(current) === expected
  })
}

/** ¿La entrega va a acabar dentro de un contenedor implícito (`.zip`) que el usuario no pidió? */
export function hasImplicitContainer(spec: ExportSpec, capabilities: ExportCapabilities): boolean {
  if (!capabilities.packaging.container_is_implicit) return false
  return willBeMultifile(spec, capabilities) && isNeutralValue(spec.output.compression)
}

// ── Cuerpos de petición ─────────────────────────────────────────────────────────
/**
 * Construye el cuerpo de `POST .../database-exports` y de `preview`. Dos omisiones deliberadas:
 *
 * - **Los bloques propios de otro formato.** Se decide con `isFormatScopedGroup`, no con un
 *   `if (format === 'csv')`: el bloque `csv` solo viaja cuando el formato elegido es `csv`.
 * - **Las opciones no aplicables a este motor.** `sanitize.definer` en PostgreSQL no es un valor
 *   por defecto que mandar, es un concepto que no existe: mandarlo es afirmar algo sobre un campo
 *   que ese motor no tiene.
 *
 * Además se limpian los filtros por tabla vacíos, que si no viajarían como `{}` inútiles, y se
 * omite `idempotency_key` cuando no hay ninguna.
 */
export function buildExportSpecPayload(
  spec: ExportSpec,
  capabilities: ExportCapabilities,
): Partial<ExportSpec> {
  let working = spec

  // Los candidatos salen de `capabilities.formats`, NO de las claves de `options`: si un formato
  // deja de declarar opciones propias (hoy `csv.*` son tres), su bloque seguiría viajando en una
  // exportación de otro formato — exactamente el ruido que esta omisión existe para evitar.
  for (const format of capabilities.formats) {
    if (format.name !== spec.format) working = omitSpecPath(working, format.name)
  }

  for (const [path, option] of Object.entries(capabilities.options)) {
    if (!option.applicable) working = omitSpecPath(working, path)
  }

  const perObject = Object.fromEntries(
    Object.entries(working.data?.per_object ?? {}).filter(
      ([, filter]) =>
        (filter.where != null && filter.where.trim().length > 0) || filter.limit != null,
    ),
  )

  const payload: Partial<ExportSpec> = {
    ...working,
    data: working.data ? { ...working.data, per_object: perObject } : working.data,
  }
  if (payload.idempotency_key == null) delete payload.idempotency_key

  return payload
}

// ── Estado del artefacto y de los plazos ────────────────────────────────────────
/**
 * **"Artefacto parcial" ⇔ el `status` es terminal Y `complete === false`.** La comprobación existe
 * como función porque la trampa es real: `GET /manifest` responde también sobre un job en curso, y
 * ahí `complete` es `false` simplemente porque todavía no hay nada completo. Leerlo a secas pinta
 * una banda roja de "artefacto parcial" sobre una exportación que va perfectamente.
 */
export function isPartialArtifact(input: {
  statusIsTerminal: boolean
  complete: boolean | null | undefined
}): boolean {
  return input.statusIsTerminal && input.complete === false
}

/**
 * Huella de lo que un preview le mostró al usuario: avisos, objetos en orden con su bandera de
 * datos y de determinismo, tablas con datos y viabilidad de la entrega en línea.
 *
 * Sirve para una cosa concreta: el asistente encadena el preview autoritativo con la ejecución para
 * que el `confirm_token` viaje recién emitido (y el 409 por huella cambiada sea raro). Pero si ese
 * preview devuelve algo distinto de lo que el usuario acababa de leer —el catálogo cambió entre
 * medias—, ejecutar sin más sería hacerle confirmar una exportación que nunca vio. Comparando las
 * dos huellas se detecta ese caso y se le vuelve a pedir el visto bueno.
 *
 * No entra `estimated_bytes`: es una estimación gruesa que puede moverse sola entre dos lecturas del
 * catálogo, y hacer que eso pare la exportación sería ruido, no seguridad.
 */
export function previewSignature(preview: {
  warnings: readonly string[]
  objects: readonly {
    seq: number
    object_type: string
    name: string
    with_data: boolean
    deterministic: boolean
  }[]
  data_tables: readonly string[]
  inline_delivery_viable: boolean
}): string {
  return JSON.stringify({
    warnings: preview.warnings,
    objects: preview.objects.map(
      (object) =>
        `${object.seq}:${object.object_type}:${object.name}:${object.with_data ? 'd' : '-'}:${
          object.deterministic ? 'o' : 'x'
        }`,
    ),
    dataTables: preview.data_tables,
    inlineViable: preview.inline_delivery_viable,
  })
}
