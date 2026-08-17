import { useId } from 'react'
import { Button, ErrorState, Input, Spinner, Switch } from '@/components/ui'
import { cn, formatBytes, formatInteger } from '@/lib/utils'
import type { ExportCapabilities, ExportSpec } from '@/lib/contracts'
import { Callout, WarningList } from '../../components/Callout'
import {
  EXPORT_FILENAME_TOKENS,
  readSpecValue,
  validateFilenameTemplate,
  validateRowFilter,
  validateSingleCharOptions,
  visibleControlGroups,
  type ExportControl,
  type ExportOptionConstraint,
} from '../../logic'
import { rowFilterReasonLabel } from '../../messages'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { DatabaseExportWizard } from '../use-database-export-wizard'

/**
 * Paso 3 — Opciones.
 *
 * **Esta pantalla no conoce ni una regla del módulo.** Cada control, sus valores válidos, cuáles
 * están prohibidos y cuál es destructivo salen de `capabilities` a través de `wizard.controls` y
 * `wizard.evaluation`. No hay ni un `if (format === 'csv')` ni un valor escrito a mano: ramificar por
 * formato ya lo resuelve `visibleControlGroups`, que oculta los grupos propios de otro formato.
 *
 * La consecuencia práctica es que una opción nueva del backend aparece sola —con encabezado legible
 * si lo conocemos, y con su nombre crudo si no— en vez de quedar invisible hasta que alguien toque
 * este archivo.
 */

/**
 * Encabezados legibles de los grupos. El fallback es **el propio nombre del grupo**: un grupo nuevo
 * se muestra igual, en el peor caso con su nombre crudo, pero nunca desaparece de la pantalla.
 */
const GROUP_LABELS: Record<string, string> = {
  structure: 'Estructura',
  selection: 'Selección',
  data: 'Datos',
  sanitize: 'Saneado del script',
  csv: 'Dialecto CSV',
  output: 'Salida y entrega',
  on_error: 'Ante un error',
}

/**
 * Etiquetas de los controles por ruta. Igual que con los grupos, lo que no esté acá se muestra con
 * su ruta (sin el grupo y con los guiones bajos abiertos), nunca en blanco.
 */
const CONTROL_LABELS: Record<string, string> = {
  'structure.scope_ddl': 'DDL de la base de datos',
  'structure.entity_ddl': 'DDL de los objetos',
  'structure.drop_if_exists': 'Añadir IF EXISTS a los DROP',
  'structure.drop_cascade': 'DROP en cascada',
  'data.insert_variant': 'Variante de INSERT',
  'data.rows_per_statement': 'Filas por sentencia',
  'data.max_statement_bytes': 'Tamaño máximo de sentencia',
  'data.include_column_list': 'Incluir la lista de columnas',
  'sanitize.script_comments': 'Comentarios DEL SCRIPT (encabezado y separadores)',
  'sanitize.object_comments': 'Comentarios DEL ESQUEMA (COMMENT de los objetos)',
  'sanitize.definer': 'DEFINER de rutinas, vistas y disparadores',
  'sanitize.definer_value': 'DEFINER de reemplazo',
  'sanitize.autoincrement': 'AUTO_INCREMENT',
  'sanitize.engine_specific_options': 'Opciones propias del motor',
  'sanitize.partitions': 'Particiones',
  'sanitize.constraints_placement': 'Colocación de las restricciones',
  'sanitize.session_preamble': 'Preámbulo de sesión',
  'sanitize.transaction_wrap': 'Envolver el volcado en una transacción',
  'sanitize.charset_override.mode': 'Juego de caracteres y collation',
  'csv.line_terminator': 'Fin de línea',
  'csv.header': 'Fila de encabezado',
  'csv.bom': 'Marca de orden de bytes (BOM)',
  'output.organization': 'Organización del artefacto',
  'output.compression': 'Compresión',
  'output.file_encoding': 'Codificación del archivo',
  'output.delivery': 'Entrega',
  'output.binary_encoding': 'Codificación de los binarios',
  'output.schema_manifest': 'Incluir el manifiesto del esquema',
  on_error: 'Ante un error en un objeto',
}

/**
 * Traducciones de valores conocidos. Se busca primero por `ruta=valor` y después por el valor
 * suelto, porque el mismo texto significa cosas distintas según el campo (`inline` es una colocación
 * de restricciones y también una forma de entrega). Lo que no esté se muestra **crudo**: un valor
 * nuevo del backend aparece tal cual en el selector en lugar de quedarse fuera.
 */
const VALUE_LABELS: Record<string, string> = {
  NONE: 'No incluir',
  CREATE: 'CREATE',
  DROP_CREATE: 'DROP + CREATE (destruye lo que haya)',
  CREATE_IF_NOT_EXISTS: 'CREATE IF NOT EXISTS (no toca lo que ya existe)',
  none: 'Ninguno',
  insert: 'INSERT',
  insert_ignore: 'INSERT IGNORE',
  replace: 'REPLACE',
  upsert: 'UPSERT',
  keep: 'Conservar',
  omit: 'Omitir',
  auto: 'Automático',
  override: 'Reemplazar',
  lf: 'LF (Unix)',
  crlf: 'CRLF (Windows)',
  single: 'Un solo archivo',
  per_object: 'Un archivo por objeto',
  hex: 'Hexadecimal',
  base64: 'Base64',
  stop: 'Detener la exportación',
  continue: 'Continuar y reportarlo',
  'sanitize.definer=replace': 'Reemplazar por otro',
  'sanitize.constraints_placement=inline': 'En la propia definición',
  'sanitize.constraints_placement=deferred': 'Al final del script',
  'output.compression=none': 'Sin comprimir',
  'output.delivery=file': 'Descargar como archivo',
  'output.delivery=inline': 'Mostrar en línea',
  'data.insert_variant=none': 'No generar INSERT',
}

/** Campo obligatorio pero **no** enumerado: solo aparece cuando la matriz lo exige. */
const CONFIRM_SCOPE_DROP_PATH = 'structure.confirm_scope_drop'
const FILENAME_TEMPLATE_PATH = 'output.filename_template'
const SPLIT_MAX_BYTES_PATH = 'output.split_max_bytes'
const NULL_REPRESENTATION_PATH = 'csv.null_representation'

/**
 * Longitud máxima del filtro `where` que se usa para la validación de cortesía. `capabilities` no la
 * transporta (solo llega en el `allowed` del 422), así que se asume la documentada; cuando el
 * backend la exponga, este número sale de ahí.
 */
const ROW_FILTER_MAX_LENGTH = 4000

/** Clases del `<select>` nativo. No hay componente de select plano en el inventario compartido. */
const SELECT_CLASSES =
  'h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50'

function groupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group
}

function controlLabel(control: ExportControl): string {
  return CONTROL_LABELS[control.path] ?? control.leaf.replaceAll('_', ' ').replaceAll('.', ' · ')
}

function valueLabel(path: string, value: string): string {
  return VALUE_LABELS[`${path}=${value}`] ?? VALUE_LABELS[value] ?? value
}

/**
 * Texto del valor de una opción para el `<select>`. Se acota a los tipos que `capabilities` declara
 * (string, number, boolean, null) en vez de un `String(value)` a secas: si un día llegara un objeto
 * por esa ruta, `[object Object]` quedaría escrito en el control como si fuera un valor válido.
 */
function optionValueToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Los `reason` de las reglas que restringen un control. Se muestran **tal cual llegan**: son el
 * texto que el backend escribió para explicar la incompatibilidad y reescribirlo acá haría que la
 * misma regla se leyera distinta según de dónde venga.
 */
function ConstraintReasons({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 pl-1 text-xs text-muted-foreground">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  )
}

function ControlField({
  control,
  constraint,
  value,
  onChange,
}: {
  control: ExportControl
  constraint: ExportOptionConstraint | undefined
  value: unknown
  onChange: (raw: string) => void
}) {
  const fieldId = useId()
  const label = controlLabel(control)
  // `forcedNeutral` no es "está apagado": es "la matriz lo obliga a estar apagado". El hook ya
  // normalizó el valor, así que deshabilitar el control no deja nada vivo detrás.
  const disabled = constraint?.forcedNeutral === true
  const reasons = constraint?.reasons ?? []
  const required = constraint?.required === true

  if (control.kind === 'boolean') {
    return (
      <div className="flex flex-col gap-1">
        <Switch
          id={fieldId}
          checked={value === true || value === 'true'}
          onCheckedChange={(next) => onChange(String(next))}
          label={required ? `${label} *` : label}
          disabled={disabled}
        />
        <ConstraintReasons reasons={reasons} />
      </div>
    )
  }

  const current = optionValueToText(value)
  // Cuál es el valor destructivo NO se decide acá: sale de `option.destructive`.
  const destructiveSelected = control.option.destructive.includes(current)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      <select
        id={fieldId}
        value={current}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(SELECT_CLASSES, destructiveSelected && 'border-error/60 text-error')}
      >
        {control.option.values.map((option) => (
          <option
            key={option}
            value={option}
            disabled={constraint?.forbiddenValues.has(option)}
            className={control.option.destructive.includes(option) ? 'text-error' : undefined}
          >
            {valueLabel(control.path, option)}
            {control.option.destructive.includes(option) ? ' ⚠' : ''}
          </option>
        ))}
      </select>
      <ConstraintReasons reasons={reasons} />
      {destructiveSelected && (
        <Callout tone="danger" title="Este valor es destructivo">
          <p>
            El artefacto va a llevar sentencias que destruyen lo que exista en el destino antes de
            volver a crearlo. Quien ejecute el script no va a poder deshacerlo.
          </p>
        </Callout>
      )}
    </div>
  )
}

/**
 * El campo de doble confirmación del `DROP DATABASE`. Aparece **solo** cuando alguna restricción de
 * la matriz lo marca como obligatorio (lo hace cuando `structure.scope_ddl` es `DROP_CREATE`), y
 * nunca viene preseleccionado: el nombre hay que teclearlo.
 */
function ScopeDropConfirmField({
  wizard,
  spec,
}: {
  wizard: DatabaseExportWizard
  spec: ExportSpec
}) {
  const constraint = wizard.evaluation?.constraints.get(CONFIRM_SCOPE_DROP_PATH)
  if (constraint?.required !== true) return null

  const raw = readSpecValue(spec, CONFIRM_SCOPE_DROP_PATH)
  const typed = typeof raw === 'string' ? raw : ''
  const matches = typed === wizard.database

  return (
    <div className="flex flex-col gap-2">
      <Callout tone="danger" title="El artefacto va a contener un DROP DATABASE">
        <p>
          Con el DDL de la base en «DROP + CREATE», el script empieza destruyendo la base entera en
          el destino donde se ejecute. Escribí el nombre real para confirmarlo.
        </p>
      </Callout>
      <Input
        label="Confirmá el nombre de la base"
        value={typed}
        onChange={(event) => wizard.setSpecValue(CONFIRM_SCOPE_DROP_PATH, event.target.value)}
        placeholder={wizard.database}
        autoComplete="off"
        required
        error={typed.length > 0 && !matches ? 'No coincide con el nombre de la base.' : undefined}
        hint={matches ? 'Coincide.' : `Tiene que ser exactamente «${wizard.database}».`}
      />
      <ConstraintReasons reasons={constraint.reasons} />
    </div>
  )
}

/** Los campos del grupo `output` que no son opciones enumeradas y necesitan control propio. */
function OutputExtraFields({
  wizard,
  spec,
  capabilities,
}: {
  wizard: DatabaseExportWizard
  spec: ExportSpec
  capabilities: ExportCapabilities
}) {
  const template = spec.output.filename_template
  const templateIssue = validateFilenameTemplate(template)
  const templateError =
    templateIssue === null
      ? undefined
      : [
          templateIssue.unknownTokens.length > 0
            ? `Tokens no reconocidos: ${templateIssue.unknownTokens.map((token) => `{${token}}`).join(', ')}.`
            : null,
          templateIssue.unbalanced ? 'Hay una llave sin cerrar.' : null,
        ]
          .filter(Boolean)
          .join(' ')

  const split = spec.output.split_max_bytes
  const inlineChosen = readSpecValue(spec, 'output.delivery') === 'inline'
  const inlineNotViable = wizard.dryRun.data?.inline_delivery_viable === false

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Plantilla del nombre de archivo"
        value={template}
        onChange={(event) => wizard.setSpecValue(FILENAME_TEMPLATE_PATH, event.target.value)}
        list="export-filename-tokens"
        autoComplete="off"
        error={templateError || undefined}
        hint={`Tokens admitidos: ${EXPORT_FILENAME_TOKENS.map((token) => `{${token}}`).join(' · ')}`}
      />
      {/* Lista de sugerencias nativa: los tokens salen de la constante, no de un texto duplicado. */}
      <datalist id="export-filename-tokens">
        {EXPORT_FILENAME_TOKENS.map((token) => (
          <option key={token} value={`{${token}}`} />
        ))}
      </datalist>

      <Input
        label="Cortar el artefacto en partes de (bytes)"
        type="number"
        min={1}
        value={split == null ? '' : String(split)}
        onChange={(event) => {
          const raw = event.target.value
          const parsed = Number(raw)
          wizard.setSpecValue(
            SPLIT_MAX_BYTES_PATH,
            raw.trim().length === 0 || !Number.isFinite(parsed) ? null : Math.trunc(parsed),
          )
        }}
        hint={`Vacío = un único archivo. Cortar en partes hace el artefacto multiarchivo (máximo ${formatInteger(capabilities.limits.max_parts)} partes).`}
      />

      {wizard.implicitZip && (
        <Callout
          tone="warning"
          title="El artefacto va a salir en .zip aunque pidas «sin comprimir»"
        >
          <p>
            Multiarchivo implica contenedor: el backend no lo rechaza, lo resuelve envolviendo las
            partes en un <code>{capabilities.packaging.container}</code>. Lo vas a descargar como un
            solo <code>.zip</code>.
          </p>
        </Callout>
      )}

      {inlineChosen && inlineNotViable && (
        <Callout
          tone="warning"
          title="La entrega en línea no va a caber"
          action={
            <Button variant="outline" onClick={wizard.switchToFileDelivery}>
              Cambiar a descarga como archivo
            </Button>
          }
        >
          <p>
            Estimado ≈ {formatBytes(wizard.dryRun.data?.estimated_bytes)} frente a un máximo de{' '}
            {formatBytes(
              wizard.dryRun.data?.inline_max_bytes ?? capabilities.limits.inline_max_bytes,
            )}
            .
          </p>
          <p>
            Hay que resolverlo ahora: al descargar sería un 409 y a esa altura ya se habría pagado
            la lectura completa del origen. El artefacto no se trunca nunca.
          </p>
        </Callout>
      )}
    </div>
  )
}

/**
 * Los campos del dialecto csv que no son enumerados. **Qué campos deben ser de un solo carácter sale
 * de `csv_dialect.single_char_options`**, no de una lista escrita acá.
 */
function CsvExtraFields({
  wizard,
  spec,
  capabilities,
}: {
  wizard: DatabaseExportWizard
  spec: ExportSpec
  capabilities: ExportCapabilities
}) {
  const csvRecord: Record<string, unknown> = { ...spec.csv }
  const issues = validateSingleCharOptions(csvRecord, capabilities.csv_dialect)
  const derivedPaths = new Set(wizard.controls.map((control) => control.path))
  const nullRepresentation = spec.csv.null_representation

  return (
    <div className="flex flex-col gap-4">
      {capabilities.csv_dialect.single_char_options
        // Si el backend convierte uno de estos campos en una opción enumerada, el control derivado
        // manda y este no se duplica.
        .filter((field) => !derivedPaths.has(`csv.${field}`))
        .map((field) => {
          const raw = csvRecord[field]
          return (
            <Input
              key={field}
              label={field.replaceAll('_', ' ')}
              value={typeof raw === 'string' ? raw : ''}
              maxLength={2}
              autoComplete="off"
              onChange={(event) => {
                const value = event.target.value
                // Vacío = sin carácter. El backend es la autoridad sobre qué campos admiten la
                // ausencia (`escape_char` sí; un delimitador vacío lo rechaza).
                wizard.setSpecValue(`csv.${field}`, value.length === 0 ? null : value)
              }}
              error={issues[field]}
            />
          )
        })}

      {!derivedPaths.has(NULL_REPRESENTATION_PATH) && (
        <Input
          label="Representación de NULL"
          value={nullRepresentation}
          autoComplete="off"
          onChange={(event) => wizard.setSpecValue(NULL_REPRESENTATION_PATH, event.target.value)}
          hint={capabilities.csv_dialect.null_vs_empty}
        />
      )}
    </div>
  )
}

/**
 * Filtros por tabla (`data.per_object`). La validación del `where` es **de cortesía**: avisa al
 * escribir para que el error no se descubra tras pagar el viaje al servidor, pero **no impide
 * enviar**. El backend es la autoridad y esta comprobación es aproximada (un `--` dentro de una
 * cadena literal puede dar un falso positivo).
 */
function RowFilterFields({
  wizard,
  spec,
  capabilities,
}: {
  wizard: DatabaseExportWizard
  spec: ExportSpec
  capabilities: ExportCapabilities
}) {
  // Solo en modo «Elegir tablas»: las filas de este bloque salen de `dataChecked`, que está vacío con
  // «Todas las tablas», así que el consejo «volvé al paso de objetos y marcá las tablas» sería
  // imposible de cumplir en ese modo.
  if (wizard.dataScope !== 'custom') return null

  const tables = [...wizard.dataChecked.values()]
  const perObject = spec.data.per_object

  /**
   * Se escribe el mapa entero y no `data.per_object.<tabla>.where`: las rutas se recorren partiendo
   * por puntos, y un nombre de tabla con un punto crearía un tramo intermedio inventado.
   */
  const writeFilter = (table: string, patch: { where?: string | null; limit?: number | null }) => {
    const current = perObject[table] ?? { where: null, limit: null }
    wizard.setSpecValue('data.per_object', { ...perObject, [table]: { ...current, ...patch } })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Filtros por tabla
      </p>
      {tables.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Los filtros se definen por tabla marcada. Volvé al paso de objetos y marcá las tablas
          cuyas filas querés recortar.
        </p>
      ) : (
        tables.map((table) => {
          const filter = perObject[table] ?? { where: null, limit: null }
          const where = filter.where ?? ''
          const issue =
            where.trim().length > 0
              ? validateRowFilter(where, capabilities.engine, ROW_FILTER_MAX_LENGTH)
              : null

          return (
            <div key={table} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">{table}</p>
              <Input
                label="Condición WHERE"
                value={where}
                autoComplete="off"
                onChange={(event) =>
                  writeFilter(table, {
                    where: event.target.value.length === 0 ? null : event.target.value,
                  })
                }
                placeholder="p. ej. created_at >= '2024-01-01'"
                hint={
                  issue
                    ? undefined
                    : 'Una sola condición de lectura sobre esta tabla: sin «;», sin comentarios y sin subconsultas.'
                }
              />
              {issue && (
                <p className="text-xs text-warning">
                  {rowFilterReasonLabel(issue.reason, ROW_FILTER_MAX_LENGTH)}{' '}
                  {issue.danger ? `(«${issue.danger}»)` : null} Es un aviso: el backend es la
                  autoridad y esta comprobación es aproximada.
                </p>
              )}
              <Input
                label="Límite de filas"
                type="number"
                min={1}
                value={filter.limit == null ? '' : String(filter.limit)}
                onChange={(event) => {
                  const raw = event.target.value
                  const parsed = Number(raw)
                  writeFilter(table, {
                    limit:
                      raw.trim().length === 0 || !Number.isFinite(parsed)
                        ? null
                        : Math.trunc(parsed),
                  })
                }}
                hint="Vacío = todas las filas que cumplan la condición."
              />
            </div>
          )
        })
      )}
    </div>
  )
}

/** Los campos propios de cada grupo, después de los controles derivados de `capabilities`. */
function GroupExtras({
  group,
  wizard,
  spec,
  capabilities,
}: {
  group: string
  wizard: DatabaseExportWizard
  spec: ExportSpec
  capabilities: ExportCapabilities
}) {
  if (group === 'structure') return <ScopeDropConfirmField wizard={wizard} spec={spec} />
  if (group === 'output') {
    return <OutputExtraFields wizard={wizard} spec={spec} capabilities={capabilities} />
  }
  if (group === 'csv') {
    return <CsvExtraFields wizard={wizard} spec={spec} capabilities={capabilities} />
  }
  if (group === 'data') {
    return <RowFilterFields wizard={wizard} spec={spec} capabilities={capabilities} />
  }
  return null
}

function GroupSection({
  group,
  wizard,
  spec,
  capabilities,
}: {
  group: string
  wizard: DatabaseExportWizard
  spec: ExportSpec
  capabilities: ExportCapabilities
}) {
  const groupControls = wizard.controls.filter((control) => control.group === group)
  // Una opción `applicable: false` no es un default que mostrar apagado: es un concepto que este
  // motor NO tiene (`sanitize.definer` en PostgreSQL). Se oculta y se cuenta, para que la ausencia
  // no se lea como un bug de la pantalla.
  const hiddenByEngine = groupControls.filter((control) => !control.option.applicable).length
  const visible = groupControls.filter((control) => control.option.applicable)

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-card border border-border p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {groupLabel(group)}
      </h3>

      {/*
        `structure.scope_ddl` y `structure.entity_ddl` son UN control de cuatro valores cada uno, no
        dos casillas «borrar» + «crear». El enfoque genérico ya lo garantiza (son opciones `enum`),
        pero importa saber por qué el backend lo modeló así: con dos casillas el estado «eliminar sin
        crear» vuelve a ser representable, y eso es un script que destruye y no reconstruye.
        Ojo también con que `DROP_CREATE` y `CREATE_IF_NOT_EXISTS` NO son opuestos: la primera dice
        «que quede exactamente esto, destruyendo lo que haya», la segunda «que exista, sin tocar lo
        que ya está».
      */}
      {visible.map((control) => (
        <ControlField
          key={control.path}
          control={control}
          constraint={wizard.evaluation?.constraints.get(control.path)}
          value={readSpecValue(spec, control.path)}
          onChange={(raw) => wizard.setOptionValue(control.path, raw)}
        />
      ))}

      <GroupExtras group={group} wizard={wizard} spec={spec} capabilities={capabilities} />

      {hiddenByEngine > 0 && (
        <p className="text-xs text-muted-foreground">
          {hiddenByEngine === 1
            ? 'Se ocultó 1 opción que no aplica a este motor.'
            : `Se ocultaron ${formatInteger(hiddenByEngine)} opciones que no aplican a este motor.`}
        </p>
      )}
    </section>
  )
}

/**
 * Panel vivo de consecuencias. Mientras el `dry_run` esté obsoleto o en vuelo se marca como
 * recalculando: las cifras de la configuración anterior describen otra exportación y presentarlas
 * como definitivas es peor que no mostrarlas.
 */
function LivePanel({ wizard }: { wizard: DatabaseExportWizard }) {
  const { dryRun } = wizard
  const recalculating = dryRun.isStale || dryRun.isFetching
  const preview = dryRun.data

  return (
    <aside className="flex h-fit min-w-0 flex-col gap-3 rounded-card border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Consecuencias
        </h3>
        {recalculating && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="h-3.5 w-3.5" /> Recalculando…
          </span>
        )}
      </div>

      {preview == null ? (
        <p className="text-sm text-muted-foreground">
          {recalculating
            ? 'Calculando el plan…'
            : 'Todavía no hay un cálculo para esta configuración.'}
        </p>
      ) : (
        <dl
          aria-busy={recalculating || undefined}
          className={cn('flex flex-col gap-2 text-sm', recalculating && 'opacity-50')}
        >
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Objetos planificados</dt>
            <dd className="font-medium text-foreground">{formatInteger(preview.objects.length)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Tablas con datos</dt>
            <dd className="font-medium text-foreground">
              {formatInteger(preview.data_tables.length)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Filas estimadas</dt>
            <dd className="font-medium text-foreground">
              ~{formatInteger(preview.estimated_rows)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Tamaño estimado</dt>
            <dd className="font-medium text-foreground">
              ≈ {formatBytes(preview.estimated_bytes)}
            </dd>
          </div>
        </dl>
      )}

      {preview && <WarningList warnings={preview.warnings} title="Avisos de esta configuración" />}
    </aside>
  )
}

export function OptionsStep({ wizard }: { wizard: DatabaseExportWizard }) {
  const capabilities = wizard.capabilities.data
  const spec = wizard.spec

  if (wizard.capabilities.isLoading && !capabilities) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Cargando las opciones que admite este motor…
      </div>
    )
  }
  if (wizard.capabilities.isError && !capabilities) {
    return (
      <ErrorState
        error={wizard.capabilities.error}
        title="No se pudieron cargar las capacidades de exportación"
        onRetry={() => void wizard.capabilities.refetch()}
      />
    )
  }
  if (!capabilities || !spec) return null

  // Qué grupos se muestran y en qué orden. Un grupo cuyo nombre coincide con un formato (hoy `csv`)
  // solo aparece si es el formato elegido: la regla vive en `logic.ts`, no acá.
  const groups = visibleControlGroups(wizard.controls, capabilities, spec.format)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Opciones del volcado</h2>
        <p className="text-sm text-muted-foreground">
          Todos los controles y sus valores admitidos los declara este gateway para{' '}
          {capabilities.engine} {capabilities.engine_version}. Lo que aparezca deshabilitado lo
          prohíbe la matriz de compatibilidad, con su motivo al lado.
        </p>
      </div>

      {/* Reglas que se cumplen pero NO bloquean: son avisos, no errores. */}
      {wizard.evaluation?.advisories.map((advisory, index) => (
        <Callout key={`${index}:${advisory.code}`} tone="warning" title="Aviso de compatibilidad">
          <p>{advisory.reason}</p>
        </Callout>
      ))}

      {wizard.dryRun.isError && (
        <ErrorRecoveryPanel
          error={wizard.dryRun.error}
          title="El gateway rechazó esta configuración"
          onAddToStructure={wizard.adoptDataTablesIntoStructure}
          onResolveDependencies={wizard.resolveMissingDependencies}
          onSwitchToFileDelivery={wizard.switchToFileDelivery}
          onStartOver={wizard.reset}
        />
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {groups.map((group) => (
            <GroupSection
              key={group}
              group={group}
              wizard={wizard}
              spec={spec}
              capabilities={capabilities}
            />
          ))}
        </div>
        <LivePanel wizard={wizard} />
      </div>
    </div>
  )
}
