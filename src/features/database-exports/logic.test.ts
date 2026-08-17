import { describe, expect, it } from 'vitest'
import type {
  ExportCapabilities,
  ExportCompatibilityRule,
  ExportCsvDialect,
  ExportOption,
  ExportSpec,
} from '@/lib/contracts'
import {
  buildDefaultExportSpec,
  buildExportControls,
  buildExportSpecPayload,
  coerceOptionValue,
  evaluateExportMatrix,
  expandForbidEntry,
  findDataWithoutStructure,
  hasImplicitContainer,
  isBooleanOption,
  isDataOnlyMode,
  isNeutralValue,
  isPartialArtifact,
  isPresentValue,
  neutralValueFor,
  normalizeSpecForConstraints,
  omitSpecPath,
  readSpecValue,
  ruleApplies,
  toggleSelectionEntry,
  validateFilenameTemplate,
  validateRowFilter,
  validateSingleCharOptions,
  visibleControlGroups,
  willBeMultifile,
  writeSpecValue,
} from './logic'

// ── Fixtures ────────────────────────────────────────────────────────────────────
function makeOption(overrides: Partial<ExportOption> = {}): ExportOption {
  return { values: [], default: null, applicable: true, destructive: [], ...overrides }
}

function makeCsvDialect(overrides: Partial<ExportCsvDialect> = {}): ExportCsvDialect {
  return {
    delimiter: ',',
    quote_char: '"',
    escape_char: null,
    null_representation: '',
    single_char_options: ['delimiter', 'quote_char', 'escape_char'],
    null_vs_empty: 'El NULL se escribe sin comillas…',
    ...overrides,
  }
}

function makeCapabilities(overrides: Partial<ExportCapabilities> = {}): ExportCapabilities {
  return {
    engine: 'mysql',
    engine_version: '8.0.36',
    scope: { kind: 'database', name: 'tienda', scope_note: null },
    object_types: ['event', 'routine', 'table', 'trigger', 'view'],
    formats: [
      { name: 'sql', supports_structure: true, supports_data: true, one_file_per_table: false },
      { name: 'csv', supports_structure: false, supports_data: true, one_file_per_table: true },
      {
        name: 'json',
        supports_structure: 'manifest_only',
        supports_data: true,
        one_file_per_table: false,
      },
    ],
    options: {
      'structure.scope_ddl': makeOption({
        values: ['NONE', 'CREATE', 'DROP_CREATE', 'CREATE_IF_NOT_EXISTS'],
        default: 'NONE',
        destructive: ['DROP_CREATE'],
      }),
      'structure.entity_ddl': makeOption({
        values: ['NONE', 'CREATE', 'DROP_CREATE', 'CREATE_IF_NOT_EXISTS'],
        default: 'CREATE',
      }),
      'sanitize.definer': makeOption({
        values: ['keep', 'omit', 'replace', 'auto'],
        default: 'omit',
      }),
      'sanitize.session_preamble': makeOption({ values: ['true', 'false'], default: true }),
      'data.insert_variant': makeOption({
        values: ['none', 'insert', 'insert_ignore', 'replace', 'upsert'],
        default: 'insert',
      }),
      'output.organization': makeOption({ values: ['single', 'per_object'], default: 'single' }),
      'output.compression': makeOption({ values: ['none', 'gzip', 'zip'], default: 'none' }),
      'output.delivery': makeOption({ values: ['file', 'inline'], default: 'file' }),
      'output.schema_manifest': makeOption({ values: ['true', 'false'], default: false }),
      'csv.header': makeOption({ values: ['true', 'false'], default: true }),
    },
    compatibility: [],
    csv_dialect: makeCsvDialect(),
    packaging: {
      multifile_when: ['output.organization=per_object', 'output.split_max_bytes'],
      container: 'zip',
      container_is_implicit: true,
      part_naming: '{base}.part{NN}{ext}',
      index_entry: '000-INDICE.txt',
      entry_extension: { sql: '.sql', csv: '.csv', json: '.json', ndjson: '.ndjson' },
    },
    limits: {
      inline_max_bytes: 1_048_576,
      max_statement_bytes: 1_048_576,
      rows_per_statement: 200,
      plan_ttl_hours: 24,
      artifact_ttl_minutes: 30,
      max_duration_seconds: 14_400,
      max_parts: 500,
    },
    error_codes: ['export.incompatible_option'],
    charset_collation_catalog_url: '/api/v1/charset-collation-options?family=mysql',
    ...overrides,
  }
}

/** La regla real del contrato para `csv`, que es la que más cosas apaga a la vez. */
const CSV_RULE: ExportCompatibilityRule = {
  when: { format: 'csv' },
  forbids: [
    'structure.*',
    'data.insert_variant',
    'sanitize.session_preamble',
    'output.organization=single',
    'output.schema_manifest',
    'output.delivery=inline',
  ],
  requires: [],
  reason: 'El formato delimitado solo transporta datos, un archivo por tabla.',
  blocking: true,
  code: 'export.incompatible_option',
}

const DROP_RULE: ExportCompatibilityRule = {
  when: { 'structure.scope_ddl': 'DROP_CREATE' },
  forbids: [],
  requires: ['structure.confirm_scope_drop'],
  reason: 'El artefacto va a contener un DROP DATABASE.',
  blocking: true,
  code: 'export.incompatible_option',
}

const PG_ADVISORY: ExportCompatibilityRule = {
  when: { engine: 'postgresql', 'structure.scope_ddl': 'DROP_CREATE' },
  forbids: [],
  requires: [],
  reason: 'El DROP DATABASE no es ejecutable desde una conexión a esa misma base…',
  blocking: false,
  code: 'export.incompatible_option',
}

function makeSpec(overrides: Partial<ExportSpec> = {}): ExportSpec {
  return { ...buildDefaultExportSpec(makeCapabilities()), ...overrides }
}

// ── Rutas con puntos ────────────────────────────────────────────────────────────
describe('readSpecValue', () => {
  it('recorre rutas de tres tramos', () => {
    expect(readSpecValue(makeSpec(), 'sanitize.charset_override.mode')).toBe('keep')
  })

  it('devuelve undefined en una ruta que no existe, sin lanzar', () => {
    expect(readSpecValue(makeSpec(), 'output.no_existe.nada')).toBeUndefined()
  })
})

describe('writeSpecValue', () => {
  it('no muta el spec original', () => {
    const spec = makeSpec()
    const next = writeSpecValue(spec, 'structure.entity_ddl', 'NONE')
    expect(next.structure.entity_ddl).toBe('NONE')
    expect(spec.structure.entity_ddl).toBe('CREATE')
  })

  it('escribe en un tramo profundo conservando los hermanos', () => {
    const next = writeSpecValue(makeSpec(), 'sanitize.charset_override.charset', 'utf8mb4')
    expect(next.sanitize.charset_override).toEqual({
      mode: 'keep',
      charset: 'utf8mb4',
      collation: null,
    })
  })
})

describe('omitSpecPath', () => {
  it('quita la clave sin tocar el resto del bloque', () => {
    const next = omitSpecPath(makeSpec(), 'sanitize.definer')
    expect('definer' in next.sanitize).toBe(false)
    expect(next.sanitize.autoincrement).toBe('auto')
  })

  it('es inocuo si la ruta no existe', () => {
    const spec = makeSpec()
    expect(omitSpecPath(spec, 'output.no_existe')).toEqual(spec)
  })
})

// ── Valores neutros ─────────────────────────────────────────────────────────────
describe('isNeutralValue', () => {
  it('reconoce los cuatro neutros del contrato', () => {
    expect(isNeutralValue('NONE')).toBe(true)
    expect(isNeutralValue('none')).toBe(true)
    expect(isNeutralValue(false)).toBe(true)
    expect(isNeutralValue(null)).toBe(true)
    expect(isNeutralValue([])).toBe(true)
  })

  it('un 0 NO es neutro: es un valor configurado, no la ausencia de valor', () => {
    expect(isNeutralValue(0)).toBe(false)
  })

  it('no confunde otros valores del enumerado con el apagado', () => {
    expect(isNeutralValue('CREATE')).toBe(false)
    expect(isNeutralValue('insert')).toBe(false)
    expect(isNeutralValue(true)).toBe(false)
  })
})

describe('isPresentValue', () => {
  it('una cadena de espacios no está presente', () => {
    expect(isPresentValue('   ')).toBe(false)
    expect(isPresentValue('tienda')).toBe(true)
  })
})

describe('neutralValueFor', () => {
  it('una opción booleana se apaga con false, no con la cadena "false"', () => {
    const option = makeOption({ values: ['true', 'false'], default: true })
    expect(neutralValueFor(option, true)).toBe(false)
  })

  it('prefiere NONE sobre none cuando el enumerado tiene ambos conceptos', () => {
    const option = makeOption({ values: ['NONE', 'CREATE'], default: 'CREATE' })
    expect(neutralValueFor(option, 'CREATE')).toBe('NONE')
  })

  it('sin opción conocida cae al neutro del tipo actual', () => {
    expect(neutralValueFor(undefined, 'algo')).toBe('')
    expect(neutralValueFor(undefined, 42)).toBeNull()
  })
})

// ── Controles ───────────────────────────────────────────────────────────────────
describe('isBooleanOption', () => {
  it('detecta la asimetría default boolean / values string del backend', () => {
    expect(isBooleanOption(makeOption({ values: ['true', 'false'], default: true }))).toBe(true)
  })

  it('un enumerado de cuatro valores no es booleano', () => {
    expect(isBooleanOption(makeOption({ values: ['NONE', 'CREATE'], default: 'NONE' }))).toBe(false)
  })
})

describe('buildExportControls', () => {
  it('deriva grupo y hoja de la ruta con puntos', () => {
    const controls = buildExportControls(makeCapabilities())
    const definer = controls.find((control) => control.path === 'sanitize.definer')
    expect(definer?.group).toBe('sanitize')
    expect(definer?.leaf).toBe('definer')
    expect(definer?.kind).toBe('enum')
  })

  it('marca las booleanas como boolean', () => {
    const controls = buildExportControls(makeCapabilities())
    expect(controls.find((c) => c.path === 'csv.header')?.kind).toBe('boolean')
  })
})

describe('visibleControlGroups', () => {
  const capabilities = makeCapabilities()
  const controls = buildExportControls(capabilities)

  it('oculta el grupo csv cuando el formato elegido no es csv', () => {
    expect(visibleControlGroups(controls, capabilities, 'sql')).not.toContain('csv')
  })

  it('lo muestra cuando sí lo es, sin conocer el formato de antemano', () => {
    expect(visibleControlGroups(controls, capabilities, 'csv')).toContain('csv')
  })

  it('los grupos que no son de ningún formato se muestran siempre', () => {
    const groups = visibleControlGroups(controls, capabilities, 'csv')
    expect(groups).toContain('output')
    expect(groups).toContain('sanitize')
  })
})

describe('coerceOptionValue', () => {
  it('convierte el string del select en el boolean que el spec espera', () => {
    const option = makeOption({ values: ['true', 'false'], default: false })
    expect(coerceOptionValue(option, 'true')).toBe(true)
    expect(coerceOptionValue(option, 'false')).toBe(false)
  })

  it('mantiene los enumerados como texto', () => {
    const option = makeOption({ values: ['keep', 'omit'], default: 'omit' })
    expect(coerceOptionValue(option, 'keep')).toBe('keep')
  })
})

// ── Matriz de compatibilidad ────────────────────────────────────────────────────
describe('ruleApplies', () => {
  it('la clave especial engine se compara contra el motor, no contra el spec', () => {
    const spec = writeSpecValue(makeSpec(), 'structure.scope_ddl', 'DROP_CREATE')
    expect(ruleApplies(PG_ADVISORY, spec, 'postgresql')).toBe(true)
    expect(ruleApplies(PG_ADVISORY, spec, 'mysql')).toBe(false)
  })

  it('exige que TODAS las claves de when coincidan', () => {
    expect(ruleApplies(PG_ADVISORY, makeSpec(), 'postgresql')).toBe(false)
  })

  it('compara en texto, así que un when booleano funciona igual', () => {
    const rule: ExportCompatibilityRule = {
      when: { 'output.schema_manifest': true },
      forbids: [],
      requires: [],
      reason: '…',
      blocking: true,
      code: 'export.incompatible_option',
    }
    const spec = writeSpecValue(makeSpec(), 'output.schema_manifest', true)
    expect(ruleApplies(rule, spec, 'mysql')).toBe(true)
    expect(ruleApplies(rule, makeSpec(), 'mysql')).toBe(false)
  })
})

describe('expandForbidEntry', () => {
  it('expande el comodín contra las claves reales de options', () => {
    expect(expandForbidEntry('structure.*', makeCapabilities()).sort()).toEqual([
      'structure.entity_ddl',
      'structure.scope_ddl',
    ])
  })

  it('deja intacta una entrada sin comodín', () => {
    expect(expandForbidEntry('output.delivery=inline', makeCapabilities())).toEqual([
      'output.delivery=inline',
    ])
  })
})

describe('evaluateExportMatrix', () => {
  const capabilities = makeCapabilities({ compatibility: [CSV_RULE, DROP_RULE, PG_ADVISORY] })

  it('con sql y los defaults no hay ninguna violación', () => {
    const result = evaluateExportMatrix(makeSpec(), capabilities)
    expect(result.violations).toHaveLength(0)
  })

  it('con csv y los defaults de sql detecta las combinaciones prohibidas', () => {
    const spec = writeSpecValue(makeSpec(), 'format', 'csv')
    const result = evaluateExportMatrix(spec, capabilities)

    const fields = result.violations.flatMap((violation) => violation.fields)
    // entity_ddl viene en CREATE, insert_variant en insert, organization en single: los tres violan.
    expect(fields).toContain('structure.entity_ddl')
    expect(fields).toContain('data.insert_variant')
    expect(fields).toContain('output.organization')
    // scope_ddl ya venía en NONE, que es su valor neutro: no es una violación.
    expect(fields).not.toContain('structure.scope_ddl')
  })

  it('registra la restricción incluso cuando la opción ya está en su valor neutro', () => {
    const spec = writeSpecValue(makeSpec(), 'format', 'csv')
    const result = evaluateExportMatrix(spec, capabilities)
    expect(result.constraints.get('structure.scope_ddl')?.forcedNeutral).toBe(true)
  })

  it('distingue un valor concreto prohibido de la opción entera', () => {
    const spec = writeSpecValue(makeSpec(), 'format', 'csv')
    const result = evaluateExportMatrix(spec, capabilities)
    expect(result.constraints.get('output.delivery')?.forbiddenValues.has('inline')).toBe(true)
    expect(result.constraints.get('output.delivery')?.forcedNeutral).toBe(false)
  })

  it('un requires sin cumplir es una violación de tipo requires', () => {
    const spec = writeSpecValue(makeSpec(), 'structure.scope_ddl', 'DROP_CREATE')
    const result = evaluateExportMatrix(spec, capabilities)
    const violation = result.violations.find((entry) => entry.kind === 'requires')
    expect(violation?.fields).toEqual(['structure.confirm_scope_drop'])
  })

  it('el requires se satisface al re-teclear el nombre de la base', () => {
    let spec = writeSpecValue(makeSpec(), 'structure.scope_ddl', 'DROP_CREATE')
    spec = writeSpecValue(spec, 'structure.confirm_scope_drop', 'tienda')
    expect(evaluateExportMatrix(spec, capabilities).violations).toHaveLength(0)
  })

  it('una regla no bloqueante es un aviso y no genera restricciones ni violaciones', () => {
    const spec = writeSpecValue(makeSpec(), 'structure.scope_ddl', 'DROP_CREATE')
    const pgCapabilities = makeCapabilities({
      engine: 'postgresql',
      compatibility: [PG_ADVISORY],
    })
    const result = evaluateExportMatrix(spec, pgCapabilities)
    expect(result.advisories).toEqual([PG_ADVISORY])
    expect(result.violations).toHaveLength(0)
    expect(result.constraints.size).toBe(0)
  })

  it('las reglas de otro motor no se aplican aunque viajen en la matriz', () => {
    const spec = writeSpecValue(makeSpec(), 'structure.scope_ddl', 'DROP_CREATE')
    const result = evaluateExportMatrix(spec, capabilities)
    expect(result.advisories).toHaveLength(0)
  })
})

describe('normalizeSpecForConstraints', () => {
  const capabilities = makeCapabilities({ compatibility: [CSV_RULE, DROP_RULE] })

  it('apaga de verdad lo que csv prohíbe, no lo deja vivo detrás de un control deshabilitado', () => {
    const spec = writeSpecValue(makeSpec(), 'format', 'csv')
    const normalized = normalizeSpecForConstraints(
      spec,
      capabilities,
      evaluateExportMatrix(spec, capabilities),
    )
    expect(normalized.structure.entity_ddl).toBe('NONE')
    expect(normalized.data.insert_variant).toBe('none')
    expect(normalized.sanitize.session_preamble).toBe(false)
    expect(normalized.output.schema_manifest).toBe(false)
  })

  it('sustituye un valor concreto vetado por el primero admitido', () => {
    const spec = writeSpecValue(makeSpec(), 'format', 'csv')
    const normalized = normalizeSpecForConstraints(
      spec,
      capabilities,
      evaluateExportMatrix(spec, capabilities),
    )
    expect(normalized.output.organization).toBe('per_object')
  })

  it('deja el spec sin violaciones, que es su razón de existir', () => {
    const spec = writeSpecValue(makeSpec(), 'format', 'csv')
    const normalized = normalizeSpecForConstraints(
      spec,
      capabilities,
      evaluateExportMatrix(spec, capabilities),
    )
    expect(evaluateExportMatrix(normalized, capabilities).violations).toHaveLength(0)
  })

  it('NUNCA escala a un valor destructivo al sustituir', () => {
    // `values` pone `DROP_CREATE` antes que cualquier otro admitido a propósito: tomar «el primero
    // que la matriz admite» convertiría un `CREATE` prohibido en un DROP DATABASE que nadie pidió.
    const trap = makeCapabilities({
      options: {
        'structure.entity_ddl': makeOption({
          values: ['DROP_CREATE', 'CREATE_IF_NOT_EXISTS', 'CREATE', 'NONE'],
          default: 'CREATE',
          destructive: ['DROP_CREATE'],
        }),
      },
      compatibility: [
        {
          when: { format: 'csv' },
          forbids: ['structure.entity_ddl=CREATE'],
          requires: [],
          reason: '…',
          blocking: true,
          code: 'export.incompatible_option',
        },
      ],
    })
    const spec = writeSpecValue(makeSpec({ format: 'csv' }), 'structure.entity_ddl', 'CREATE')
    const normalized = normalizeSpecForConstraints(spec, trap, evaluateExportMatrix(spec, trap))
    expect(normalized.structure.entity_ddl).not.toBe('DROP_CREATE')
    expect(normalized.structure.entity_ddl).toBe('CREATE_IF_NOT_EXISTS')
  })

  it('si todos los valores admitidos son destructivos, apaga en vez de escalar', () => {
    const trap = makeCapabilities({
      options: {
        'structure.entity_ddl': makeOption({
          values: ['DROP_CREATE', 'CREATE'],
          default: 'CREATE',
          destructive: ['DROP_CREATE'],
        }),
      },
      compatibility: [
        {
          when: { format: 'csv' },
          forbids: ['structure.entity_ddl=CREATE'],
          requires: [],
          reason: '…',
          blocking: true,
          code: 'export.incompatible_option',
        },
      ],
    })
    const spec = writeSpecValue(makeSpec({ format: 'csv' }), 'structure.entity_ddl', 'CREATE')
    const normalized = normalizeSpecForConstraints(spec, trap, evaluateExportMatrix(spec, trap))
    expect(normalized.structure.entity_ddl).toBe('NONE')
  })

  it('no toca un valor concreto que no está vetado', () => {
    const spec = makeSpec()
    const normalized = normalizeSpecForConstraints(
      spec,
      capabilities,
      evaluateExportMatrix(spec, capabilities),
    )
    expect(normalized.output.delivery).toBe('file')
    expect(normalized.structure.entity_ddl).toBe('CREATE')
  })
})

// ── Spec inicial ────────────────────────────────────────────────────────────────
describe('buildDefaultExportSpec', () => {
  it('resuelve cada default desde capabilities, no desde el esqueleto', () => {
    const spec = buildDefaultExportSpec(makeCapabilities())
    expect(spec.sanitize.definer).toBe('omit')
  })

  it('en PostgreSQL una opción no aplicable conserva el valor del esqueleto', () => {
    const capabilities = makeCapabilities({
      engine: 'postgresql',
      options: {
        ...makeCapabilities().options,
        'sanitize.definer': makeOption({
          values: ['keep', 'omit', 'replace', 'auto'],
          default: 'keep',
          applicable: false,
        }),
      },
    })
    // No se adopta `keep`: la opción no aplica y no se va a enviar, así que su valor es irrelevante.
    expect(buildDefaultExportSpec(capabilities).sanitize.definer).toBe('auto')
  })

  it('toma los límites numéricos de capabilities y no los del esqueleto', () => {
    const capabilities = makeCapabilities()
    capabilities.limits.rows_per_statement = 50
    expect(buildDefaultExportSpec(capabilities).data.rows_per_statement).toBe(50)
  })

  it('arranca en modo solo estructura, que es el caso seguro', () => {
    expect(buildDefaultExportSpec(makeCapabilities()).data.mode).toBe('none')
  })
})

// ── Los dos conjuntos ───────────────────────────────────────────────────────────
describe('isDataOnlyMode', () => {
  it('exige que AMBOS enumerados estén en NONE', () => {
    let spec = writeSpecValue(makeSpec(), 'structure.entity_ddl', 'NONE')
    expect(isDataOnlyMode(spec)).toBe(true)
    spec = writeSpecValue(spec, 'structure.scope_ddl', 'CREATE')
    expect(isDataOnlyMode(spec)).toBe(false)
  })
})

describe('findDataWithoutStructure', () => {
  it('detecta las tablas con datos cuya estructura quedó fuera', () => {
    const structure = new Set(['clientes'])
    expect(findDataWithoutStructure(structure, ['clientes', 'pedidos'], false)).toEqual(['pedidos'])
  })

  it('en modo solo datos la restricción no existe', () => {
    expect(findDataWithoutStructure(new Set(), ['pedidos'], true)).toEqual([])
  })

  it('no repite un nombre duplicado en la entrada', () => {
    expect(findDataWithoutStructure(new Set(), ['pedidos', 'pedidos'], false)).toEqual(['pedidos'])
  })
})

describe('toggleSelectionEntry', () => {
  it('agrega, quita y nunca muta el mapa original', () => {
    const initial = new Map<string, number>()
    const added = toggleSelectionEntry(initial, 'table:pedidos', 1)
    expect(added.has('table:pedidos')).toBe(true)
    expect(initial.size).toBe(0)
    expect(toggleSelectionEntry(added, 'table:pedidos', 1).size).toBe(0)
  })
})

// ── Validaciones de cortesía ────────────────────────────────────────────────────
describe('validateRowFilter', () => {
  it('acepta una condición de lectura simple', () => {
    expect(validateRowFilter("created_at >= '2026-01-01'", 'mysql', 500)).toBeNull()
  })

  it('rechaza los comentarios', () => {
    expect(validateRowFilter('id > 1 -- todo', 'mysql', 500)?.reason).toBe('comment_not_allowed')
    expect(validateRowFilter('id > 1 /* x */', 'postgresql', 500)?.reason).toBe(
      'comment_not_allowed',
    )
  })

  it('el # solo es comentario en MySQL/MariaDB', () => {
    expect(validateRowFilter('id > 1 # nota', 'mysql', 500)?.reason).toBe('comment_not_allowed')
    expect(validateRowFilter('id > 1 # nota', 'postgresql', 500)).toBeNull()
  })

  it('no da falso positivo por un guion doble dentro de una cadena literal', () => {
    expect(validateRowFilter("nombre LIKE '%--%'", 'mysql', 500)).toBeNull()
  })

  it('rechaza el punto y coma', () => {
    expect(validateRowFilter('id > 1; DROP TABLE x', 'mysql', 500)?.reason).toBe(
      'multiple_statements',
    )
  })

  it('rechaza subconsultas y CTEs', () => {
    expect(validateRowFilter('id IN (SELECT id FROM otra)', 'mysql', 500)?.reason).toBe(
      'subquery_not_allowed',
    )
  })

  it('rechaza lo que no es de solo lectura', () => {
    expect(validateRowFilter('DELETE FROM x', 'mysql', 500)?.reason).toBe('not_read_only')
  })

  it('no confunde una palabra que empieza igual con una palabra clave', () => {
    expect(validateRowFilter("estado = 'updated'", 'mysql', 500)).toBeNull()
  })

  it('rechaza el filtro vacío y el demasiado largo', () => {
    expect(validateRowFilter('   ', 'mysql', 500)?.reason).toBe('empty_filter')
    expect(validateRowFilter('a'.repeat(20), 'mysql', 10)?.reason).toBe('too_long')
  })
})

describe('validateFilenameTemplate', () => {
  it('acepta la plantilla por defecto', () => {
    expect(validateFilenameTemplate('{database}-{date}-{job_id}')).toBeNull()
  })

  it('señala los tokens desconocidos', () => {
    expect(validateFilenameTemplate('{database}-{usuario}')?.unknownTokens).toEqual(['usuario'])
  })

  it('detecta una llave suelta', () => {
    expect(validateFilenameTemplate('{database')?.unbalanced).toBe(true)
  })
})

describe('validateSingleCharOptions', () => {
  const dialect = makeCsvDialect()

  it('acepta un carácter y rechaza dos', () => {
    expect(validateSingleCharOptions({ delimiter: ',', quote_char: '"' }, dialect)).toEqual({})
    expect(validateSingleCharOptions({ delimiter: ';;' }, dialect)).toHaveProperty('delimiter')
  })

  it('un escape_char vacío es válido: significa sin carácter de escape', () => {
    expect(validateSingleCharOptions({ escape_char: null }, dialect)).toEqual({})
    expect(validateSingleCharOptions({ escape_char: '' }, dialect)).toEqual({})
  })

  it('solo valida los campos que el dialecto declara', () => {
    const custom = makeCsvDialect({ single_char_options: ['delimiter'] })
    expect(validateSingleCharOptions({ quote_char: '««' }, custom)).toEqual({})
  })
})

// ── Empaquetado ─────────────────────────────────────────────────────────────────
describe('willBeMultifile', () => {
  it('lo dispara un archivo por objeto', () => {
    const spec = writeSpecValue(makeSpec(), 'output.organization', 'per_object')
    expect(willBeMultifile(spec, makeCapabilities())).toBe(true)
  })

  it('lo dispara la fragmentación por tamaño', () => {
    const spec = writeSpecValue(makeSpec(), 'output.split_max_bytes', 1024)
    expect(willBeMultifile(spec, makeCapabilities())).toBe(true)
  })

  it('con un solo archivo y sin fragmentar, no', () => {
    expect(willBeMultifile(makeSpec(), makeCapabilities())).toBe(false)
  })
})

describe('hasImplicitContainer', () => {
  it('avisa del .zip que el usuario no pidió', () => {
    const spec = writeSpecValue(makeSpec(), 'output.organization', 'per_object')
    expect(hasImplicitContainer(spec, makeCapabilities())).toBe(true)
  })

  it('si el usuario ya pidió comprimir, no hay nada implícito que avisar', () => {
    let spec = writeSpecValue(makeSpec(), 'output.organization', 'per_object')
    spec = writeSpecValue(spec, 'output.compression', 'gzip')
    expect(hasImplicitContainer(spec, makeCapabilities())).toBe(false)
  })
})

// ── Cuerpo de la petición ───────────────────────────────────────────────────────
describe('buildExportSpecPayload', () => {
  it('omite el bloque csv cuando el formato no es csv', () => {
    const payload = buildExportSpecPayload(makeSpec(), makeCapabilities())
    expect(payload.csv).toBeUndefined()
  })

  it('lo incluye cuando sí lo es', () => {
    const spec = writeSpecValue(makeSpec(), 'format', 'csv')
    expect(buildExportSpecPayload(spec, makeCapabilities()).csv).toBeDefined()
  })

  it('omite el bloque de otro formato aunque ese formato no declare ninguna opción', () => {
    // Los candidatos salen de `capabilities.formats`, no de las claves de `options`: si `csv.*`
    // dejara de declararse, el bloque seguiría viajando en una exportación `sql`.
    const sinOpcionesCsv = makeCapabilities({
      options: { 'output.compression': makeOption({ values: ['none', 'zip'], default: 'none' }) },
    })
    expect(buildExportSpecPayload(makeSpec(), sinOpcionesCsv).csv).toBeUndefined()
  })

  it('omite las opciones no aplicables al motor en vez de mandar su default', () => {
    const capabilities = makeCapabilities({
      engine: 'postgresql',
      options: {
        ...makeCapabilities().options,
        'sanitize.definer': makeOption({ values: ['keep'], default: 'keep', applicable: false }),
      },
    })
    const payload = buildExportSpecPayload(makeSpec(), capabilities)
    expect(payload.sanitize && 'definer' in payload.sanitize).toBe(false)
  })

  it('limpia los filtros por tabla vacíos y conserva los reales', () => {
    let spec = makeSpec()
    spec = writeSpecValue(spec, 'data.per_object', {
      vacia: { where: '   ', limit: null },
      pedidos: { where: "created_at >= '2026-01-01'", limit: null },
      solo_limite: { where: null, limit: 100 },
    })
    const perObject = buildExportSpecPayload(spec, makeCapabilities()).data?.per_object ?? {}
    expect(Object.keys(perObject).sort()).toEqual(['pedidos', 'solo_limite'])
  })

  it('omite idempotency_key cuando no hay ninguna', () => {
    expect('idempotency_key' in buildExportSpecPayload(makeSpec(), makeCapabilities())).toBe(false)
  })
})

// ── Artefacto ───────────────────────────────────────────────────────────────────
describe('isPartialArtifact', () => {
  it('un job en curso con complete:false NO es un artefacto parcial', () => {
    expect(isPartialArtifact({ statusIsTerminal: false, complete: false })).toBe(false)
  })

  it('un job terminado con complete:false sí lo es', () => {
    expect(isPartialArtifact({ statusIsTerminal: true, complete: false })).toBe(true)
  })

  it('un complete ausente no se interpreta como parcial', () => {
    expect(isPartialArtifact({ statusIsTerminal: true, complete: null })).toBe(false)
  })
})
