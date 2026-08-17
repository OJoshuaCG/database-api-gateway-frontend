import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  RadioCardGroup,
  Spinner,
} from '@/components/ui'
import { formatInteger } from '@/lib/utils'
import type { ExportCatalogObject } from '@/lib/contracts'
import { Callout, WarningList } from '../../components/Callout'
import { exportObjectKey } from '../../logic'
import { ErrorRecoveryPanel } from '../ErrorRecoveryPanel'
import type { DatabaseExportWizard, DataScope, SelectionScope } from '../use-database-export-wizard'

/**
 * Los dos conjuntos del paso, cada uno con su propio alcance. Son **conjuntos separados**, no «una
 * lista con una casilla de incluir datos»: `selection` dice qué objetos llevan su DDL y `data` de
 * qué tablas salen las filas, con la restricción `data ⊆ selection`.
 */
const STRUCTURE_SCOPE_OPTIONS: { value: SelectionScope; label: string; hint: string }[] = [
  {
    value: 'all',
    label: 'Todo el catálogo',
    hint: 'Todos los objetos de la base llevan su definición al artefacto.',
  },
  {
    value: 'custom',
    label: 'Elegir objetos',
    hint: 'Marcá abajo, uno a uno, qué objetos llevan su DDL.',
  },
]

const DATA_SCOPE_OPTIONS: { value: DataScope; label: string; hint: string }[] = [
  {
    value: 'none',
    label: 'Sin datos',
    hint: 'El caso seguro y el valor por defecto: solo estructura, ninguna fila sale de la base.',
  },
  { value: 'all', label: 'Todas las tablas', hint: 'Se exportan las filas de todas las tablas.' },
  { value: 'custom', label: 'Elegir tablas', hint: 'Marcá abajo de qué tablas salen las filas.' },
]

/**
 * Casilla de una fila del catálogo. El texto del `label` se oculta visualmente porque la cabecera de
 * la columna ya lo dice y repetirlo en cada fila vuelve la tabla ilegible — pero **sigue en el árbol
 * de accesibilidad**, que es lo que hace que un lector de pantalla anuncie qué marca cada casilla en
 * vez de leer veinte «casilla, sin marcar» indistinguibles.
 */
function RowCheckbox({
  label,
  checked,
  disabled,
  reason,
  onToggle,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  /** Por qué está deshabilitada. Va como `title` porque un control deshabilitado no da pistas. */
  reason?: string
  onToggle: () => void
}) {
  return (
    <div className="[&_label]:sr-only" title={disabled ? reason : undefined}>
      <Checkbox label={label} checked={checked} disabled={disabled} onChange={onToggle} />
    </div>
  )
}

/**
 * Paso 2 — **Qué exportar**. Presenta el catálogo en vivo del motor con una casilla por conjunto:
 * estructura (DDL) y datos (filas). La casilla de datos solo existe en las tablas —una vista o una
 * rutina no tienen filas— y se apaga cuando la estructura de esa fila quedó fuera: así la
 * restricción `data ⊆ selection` se ve en la pantalla en vez de llegar como un 422.
 *
 * La excepción es el modo **solo datos** (`scope_ddl` y `entity_ddl` ambos en `NONE`): ahí la
 * restricción no existe, la columna de estructura no tiene sentido y desaparece entera.
 */
export function ObjectsStep({ wizard }: { wizard: DatabaseExportWizard }) {
  // Se desestructura lo que entra en las columnas para que el memo dependa de esos valores y no del
  // objeto entero del asistente, que cambia de identidad en cada render.
  const {
    objects,
    closure,
    dataOnly,
    dataScope,
    structureChecked,
    dataChecked,
    toggleStructureObject,
    toggleDataTable,
  } = wizard
  const catalog = objects.data ?? null
  const customStructure = wizard.selectionScope === 'custom'

  const columns = useMemo<ColumnDef<ExportCatalogObject>[]>(() => {
    const definitions: ColumnDef<ExportCatalogObject>[] = []

    // En modo "solo datos" la columna entera desaparece: no hay ningún DDL que marcar.
    if (!dataOnly) {
      definitions.push({
        id: 'structure',
        header: 'Estructura',
        enableSorting: false,
        cell: ({ row }) => {
          const object = row.original
          const key = exportObjectKey(object.object_type, object.name)
          return (
            <RowCheckbox
              label={`Exportar la definición de ${object.name}`}
              checked={structureChecked.has(key)}
              disabled={!customStructure}
              reason="Elegí «Elegir objetos» en el alcance de estructura para marcar objeto por objeto."
              onToggle={() =>
                toggleStructureObject({
                  object_type: object.object_type,
                  name: object.name,
                })
              }
            />
          )
        },
      })
    }

    definitions.push({
      id: 'data',
      header: 'Datos',
      enableSorting: false,
      cell: ({ row }) => {
        const object = row.original
        // Solo las tablas tienen filas: una vista o una rutina no pueden aportar datos, y ofrecer
        // la casilla ahí sugeriría que sí.
        if (object.object_type !== 'table') {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        const structureIsOn = structureChecked.has(exportObjectKey('table', object.name))
        /**
         * `data ⊆ selection` hecha visible. Con el alcance de estructura en «todo el catálogo» la
         * tabla ya está incluida (el spec efectivo viaja con `selection.mode: 'all'`), así que la
         * restricción se cumple sola y la casilla queda libre; solo cuando la estructura se elige a
         * mano hace falta que la de esa fila esté marcada.
         */
        const blockedBySubset = customStructure && !structureIsOn && !dataOnly
        return (
          <RowCheckbox
            label={`Exportar las filas de ${object.name}`}
            checked={dataChecked.has(object.name)}
            disabled={dataScope !== 'custom' || blockedBySubset}
            reason={
              blockedBySubset
                ? 'Marcá primero su estructura: los datos no pueden salir sin el objeto que los contiene.'
                : 'Elegí «Elegir tablas» en el alcance de datos para marcar tabla por tabla.'
            }
            onToggle={() => toggleDataTable(object.name)}
          />
        )
      },
    })

    definitions.push({
      id: 'object_type',
      header: 'Tipo',
      enableSorting: false,
      cell: ({ row }) => <Badge tone="neutral">{row.original.object_type}</Badge>,
    })

    definitions.push({
      id: 'name',
      header: 'Nombre',
      enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.name}</span>,
    })

    definitions.push({
      id: 'estimated_rows',
      // El conteo sale del catálogo del motor (`TABLE_ROWS` / `reltuples`): es una estimación, no un
      // conteo exacto, y presentarla sin el `~` haría que alguien la cuadre contra el artefacto.
      header: 'Filas (aprox.)',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.estimated_rows == null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="text-sm" title="Estimación del catálogo del motor, no un conteo exacto">
            ~{formatInteger(row.original.estimated_rows)}
          </span>
        ),
    })

    definitions.push({
      id: 'metadata',
      header: 'Metadatos',
      enableSorting: false,
      cell: ({ row }) => {
        const object = row.original
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Sin clave primaria, si esa tabla lleva datos, sus filas salen sin orden garantizado. */}
            {!object.has_primary_key && <Badge tone="warning">sin clave primaria</Badge>}
            {object.has_triggers && <Badge tone="neutral">con triggers</Badge>}
            {object.is_materialized === true && <Badge tone="neutral">materializada</Badge>}
            {object.row_filter && <Badge tone="primary">con filtro de filas</Badge>}
            {object.collation && (
              <span className="text-xs text-muted-foreground">{object.collation}</span>
            )}
          </div>
        )
      },
    })

    return definitions
  }, [
    customStructure,
    dataOnly,
    dataScope,
    structureChecked,
    dataChecked,
    toggleStructureObject,
    toggleDataTable,
  ])

  // `&& !catalog` en los dos triajes: un refetch (cambiar de página, filtrar) no debe dejar la
  // pantalla en blanco ni tirar un error sobre datos que siguen siendo válidos.
  if (objects.isLoading && !catalog) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Leyendo el catálogo de la base…
      </div>
    )
  }
  if (objects.isError && !catalog) {
    return <ErrorState error={objects.error} title="No se pudo cargar el catálogo de objetos" />
  }
  if (!catalog) return null

  /**
   * ⚠️ Este endpoint **no usa el envelope paginado estándar**: `total`, `page` y `size` viajan DENTRO
   * del objeto porque la respuesta lleva metadatos de catálogo que una lista plana no transporta. Las
   * tres señales que `Pagination` espera (`pages`, `hasNext`, `hasPrev`) se derivan acá.
   */
  const pages = Math.max(1, Math.ceil(catalog.total / Math.max(catalog.size, 1)))
  const hasPrev = catalog.page > 1
  const hasNext = catalog.page < pages

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Qué exportar</h2>
        <p className="text-sm text-muted-foreground">
          Son dos conjuntos independientes: qué objetos llevan su definición y de qué tablas salen
          las filas. Los datos solo pueden salir de objetos que estén en la estructura.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <RadioCardGroup<SelectionScope>
          title="Estructura (DDL)"
          description="Qué objetos llevan su definición al artefacto."
          options={STRUCTURE_SCOPE_OPTIONS}
          value={wizard.selectionScope}
          onChange={wizard.setSelectionScope}
          columns={1}
        />
        <RadioCardGroup<DataScope>
          title="Datos (filas)"
          description="De qué tablas se extraen las filas."
          // «Todas las tablas» se deshabilita con la estructura elegida a mano porque es la única
          // combinación cuyo `data ⊆ selection` el cliente no puede comprobar: no hay lista de tablas
          // marcadas contra la que comparar, así que la pantalla prometería «se exportan las filas de
          // todas las tablas» y el 422 llegaría al final. En modo solo datos sí es legítima.
          options={DATA_SCOPE_OPTIONS.map((option) =>
            option.value === 'all' && wizard.dataAllBlocked
              ? {
                  ...option,
                  disabled: true,
                  hint: 'No disponible con la estructura elegida a mano: los datos tienen que ser un subconjunto de la estructura. Elegí las tablas, o exportá solo datos.',
                }
              : option,
          )}
          value={wizard.dataScope}
          onChange={wizard.setDataScope}
          columns={1}
        />
      </div>

      {dataOnly && (
        <Callout tone="info" title="Modo solo datos">
          <p>
            Con el DDL de la base y el de los objetos en <code className="font-mono">NONE</code> el
            artefacto lleva únicamente filas, así que la restricción de subconjunto no aplica y no
            hay estructura que marcar.
          </p>
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(catalog.counts_by_type).map(([type, count]) => (
          <Badge key={type} tone="neutral">
            {type}: {formatInteger(count)}
          </Badge>
        ))}
      </div>

      <DataTable<ExportCatalogObject>
        data={catalog.objects}
        columns={columns}
        isFetching={objects.isFetching}
        // El buscador propio de `DataTable` filtra solo la página cargada; el del catálogo va al
        // backend (`name_like`), que es el único que ve la base entera.
        enableGlobalFilter={false}
        toolbar={
          <>
            <div className="w-full sm:max-w-xs">
              <Input
                label="Buscar por nombre"
                type="search"
                value={wizard.nameLike}
                onChange={(event) => wizard.setNameLike(event.target.value)}
                placeholder="p. ej. pedidos"
              />
            </div>
            <div className="w-full sm:max-w-xs">
              <Combobox<string>
                items={catalog.object_types}
                value={wizard.objectTypeFilter}
                onChange={(type) => wizard.setObjectTypeFilter(type)}
                itemToString={(type) => type}
                itemToKey={(type) => type}
                label="Tipo de objeto"
                placeholder="Todos"
                clearable
              />
            </div>
          </>
        }
        // Va como estado vacío de la tabla y no como retorno temprano del paso: con un filtro puesto,
        // sustituir la pantalla entera esconde el propio filtro que hay que quitar para salir de ahí.
        emptyState={
          <EmptyState
            title="Sin objetos"
            description="Ningún objeto del catálogo coincide con el nombre o el tipo filtrados."
          />
        }
      />

      <Pagination
        page={catalog.page}
        pages={pages}
        total={catalog.total}
        size={catalog.size}
        hasNext={hasNext}
        hasPrev={hasPrev}
        onPageChange={wizard.setObjectsPage}
        isFetching={objects.isFetching}
      />

      {/* Las tablas de contabilidad del gateway (`_gw_v_`, `_gw_stg_`) se descartan SIEMPRE. Se
          listan para que nadie las busque en el artefacto y crea que se perdieron. */}
      {catalog.excluded_internal.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Excluidas siempre (tablas internas del gateway): {catalog.excluded_internal.join(', ')}
        </p>
      )}

      {customStructure && (
        <div className="flex flex-col gap-3">
          {(closure.isStale || closure.isFetching) && (
            // La barra de navegación ya bloquea el avance mientras esto pasa; acá solo se explica
            // por qué el botón está apagado.
            <p className="text-xs text-muted-foreground">
              ⏳ Recalculando el cierre de dependencias…
            </p>
          )}

          {closure.isError && (
            <ErrorRecoveryPanel
              error={closure.error}
              title="No se pudo resolver el cierre de dependencias"
              onResolveDependencies={wizard.resolveMissingDependencies}
            />
          )}

          {closure.data && closure.data.added.length > 0 && (
            <Callout
              tone="info"
              title={`Se agregaron ${closure.data.added.length} objeto(s) por dependencia`}
            >
              <ul className="flex flex-col gap-1">
                {closure.data.added.map((object) => (
                  <li
                    key={exportObjectKey(object.object_type, object.name)}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Badge tone="primary">no lo elegiste</Badge>
                    <span className="font-mono text-xs">{object.name}</span>
                    <span className="text-xs">({object.object_type})</span>
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          {closure.data && closure.data.excluded_by_dependency.length > 0 && (
            <Callout
              tone="warning"
              title={`Se excluyeron ${closure.data.excluded_by_dependency.length} objeto(s) porque una dependencia suya quedó fuera`}
            >
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {closure.data.excluded_by_dependency.map((object) => (
                  <li key={exportObjectKey(object.object_type, object.name)}>
                    <span className="font-mono text-xs">{object.name}</span> ({object.object_type})
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          {closure.data && closure.data.unknown_names.length > 0 && (
            <Callout tone="warning" title="Hay nombres que el catálogo no reconoce">
              <p>
                Estos no existen en la base y no se van a exportar:{' '}
                {closure.data.unknown_names.join(', ')}
              </p>
            </Callout>
          )}

          {closure.data && (
            <WarningList
              warnings={closure.data.warnings}
              title="Avisos del cierre de dependencias"
            />
          )}
        </div>
      )}

      {/* Las dos salidas que el contrato pide para `export.data_without_structure`, ofrecidas antes
          de que el 422 llegue: o esas tablas entran en la estructura, o el volcado pasa a solo datos. */}
      {wizard.dataWithoutStructure.length > 0 && (
        <Callout
          tone="danger"
          title={`${wizard.dataWithoutStructure.length} tabla(s) con datos cuya estructura quedó fuera`}
          action={
            <>
              <Button variant="outline" onClick={wizard.adoptDataTablesIntoStructure}>
                Agregar esas tablas a la estructura
              </Button>
              <Button variant="outline" onClick={wizard.switchToDataOnly}>
                Exportar solo datos
              </Button>
            </>
          }
        >
          <p>
            Los datos no pueden salir sin el objeto que los contiene:{' '}
            {wizard.dataWithoutStructure.join(', ')}.
          </p>
        </Callout>
      )}
    </div>
  )
}
