import { useCallback, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Switch,
} from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { CharsetCollationOptionOut, EngineFamily } from '@/lib/contracts'
import {
  useCharsetCollationOptions,
  useUpdateCharsetCollationOption,
} from '../hooks/use-charset-collation-options'
import { formatOptionLabel, groupOptionsByFamily } from '../logic'
import { AddCharsetCollationOptionModal } from '../components/AddCharsetCollationOptionModal'
import { DisableDefaultOptionDialog } from '../components/DisableDefaultOptionDialog'

interface FamilyFilterOption {
  value: EngineFamily
  label: string
}

const FAMILY_FILTERS: FamilyFilterOption[] = [
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
]

const FAMILY_LABELS: Record<EngineFamily, string> = {
  mysql: 'MySQL / MariaDB',
  postgresql: 'PostgreSQL',
}

/**
 * Administración del catálogo global de charset/collation (`/charset-collation-options`). A
 * diferencia del selector de creación de bases, esta pantalla necesita TODAS las combinaciones
 * —incluidas las deshabilitadas, atenuadas pero nunca ocultas— así que pide sin `only_enabled` y
 * filtra en cliente sobre los datos ya traídos.
 */
export function CharsetCollationOptionsPage() {
  const [familyFilter, setFamilyFilter] = useState<FamilyFilterOption | null>(null)
  const [onlyEnabled, setOnlyEnabled] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [pendingDisable, setPendingDisable] = useState<CharsetCollationOptionOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useCharsetCollationOptions()
  const update = useUpdateCharsetCollationOption()

  const filtered = useMemo(() => {
    let list = data ?? []
    if (familyFilter) list = list.filter((option) => option.engine_family === familyFilter.value)
    if (onlyEnabled) list = list.filter((option) => option.enabled)
    return list
  }, [data, familyFilter, onlyEnabled])

  const groups = useMemo(() => groupOptionsByFamily(filtered), [filtered])
  const rows = useMemo(() => groups.flatMap((group) => group.options), [groups])

  const alternativesFor = (option: CharsetCollationOptionOut) =>
    (data ?? []).filter(
      (candidate) =>
        candidate.engine_family === option.engine_family &&
        candidate.enabled &&
        candidate.id !== option.id,
    )

  const handleToggleEnabled = useCallback(
    (option: CharsetCollationOptionOut, next: boolean) => {
      // Anticipación en cliente del invariante del backend ("la sugerida debe estar
      // habilitada"): si esta fila es la sugerida y se está apagando, no se manda el PATCH — se
      // resuelve primero en el diálogo. El 422 real queda como red de seguridad (`onError`).
      if (!next && option.is_default) {
        setPendingDisable(option)
        return
      }
      update.mutate(
        { id: option.id, body: { enabled: next } },
        {
          onError: (err) => {
            if (toApiError(err).status === 422) setPendingDisable(option)
          },
        },
      )
    },
    [update],
  )

  const columns = useMemo<ColumnDef<CharsetCollationOptionOut>[]>(
    () => [
      {
        accessorKey: 'engine_family',
        header: 'Familia',
        // Sin orden propio: las filas ya vienen agrupadas por familia (§9.2), y los avisos que
        // se muestran arriba de la tabla están calculados sobre ESE orden — permitir ordenar acá
        // los desincroniza de las filas que tienen debajo.
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone="info" className={row.original.enabled ? undefined : 'opacity-60'}>
            {FAMILY_LABELS[row.original.engine_family]}
          </Badge>
        ),
      },
      {
        id: 'combination',
        header: 'Combinación',
        enableSorting: false,
        accessorFn: (row) => formatOptionLabel(row),
        cell: ({ row }) => (
          <span
            className={
              row.original.enabled ? 'font-medium text-foreground' : 'font-medium opacity-60'
            }
          >
            {formatOptionLabel(row.original)}
          </span>
        ),
      },
      {
        accessorKey: 'enabled',
        header: 'Habilitada',
        enableSorting: false,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={update.isPending}
            onCheckedChange={(checked) => handleToggleEnabled(row.original, checked)}
            label=""
          />
        ),
      },
      {
        id: 'default',
        header: 'Sugerida',
        enableSorting: false,
        cell: ({ row }) => {
          if (row.original.is_default) {
            return (
              <span role="img" aria-label="Combinación sugerida" title="Combinación sugerida">
                ⭐
              </span>
            )
          }
          if (!row.original.enabled) {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ id: row.original.id, body: { is_default: true } })
              }
            >
              Marcar sugerida
            </Button>
          )
        },
      },
    ],
    [update, handleToggleEnabled],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Charsets y collations"
        description="Define qué combinaciones de charset/collation se pueden elegir al crear una base de datos nueva. No afecta a las bases ya creadas."
        actions={<Button onClick={() => setAddOpen(true)}>Agregar combinación</Button>}
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          {groups.length > 0 && (
            <div className="flex flex-col gap-2">
              {groups.map((group) => (
                <div
                  key={group.engineFamily}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <Badge tone="info">{FAMILY_LABELS[group.engineFamily]}</Badge>
                  {!group.hasDefault && (
                    <span className="text-muted-foreground">
                      Esta familia no tiene combinación sugerida: el selector de creación no
                      preseleccionará ninguna.
                    </span>
                  )}
                  {!group.hasEnabled && (
                    <span className="font-medium text-warning">
                      No hay combinaciones habilitadas: las bases de este motor se crearán con el
                      valor por defecto del servidor.
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <DataTable
            data={rows}
            columns={columns}
            isLoading={isLoading}
            isFetching={isFetching}
            searchPlaceholder="Buscar combinación…"
            clientPageSize={20}
            getRowId={(row) => String(row.id)}
            toolbar={
              <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
                <div className="w-full sm:max-w-xs">
                  <Combobox<FamilyFilterOption>
                    items={FAMILY_FILTERS}
                    value={familyFilter}
                    onChange={setFamilyFilter}
                    itemToString={(option) => option.label}
                    itemToKey={(option) => option.value}
                    label="Filtrar por familia"
                    placeholder="Todas las familias"
                    clearable
                  />
                </div>
                <div className="pb-1">
                  <Switch
                    checked={onlyEnabled}
                    onCheckedChange={setOnlyEnabled}
                    label="Ver solo habilitadas"
                  />
                </div>
              </div>
            }
            emptyState={
              <EmptyState
                title="No hay combinaciones en el catálogo"
                description="Agregá una combinación para que esté disponible al crear bases de datos."
              />
            }
          />
        </>
      )}

      <AddCharsetCollationOptionModal open={addOpen} onClose={() => setAddOpen(false)} />

      <DisableDefaultOptionDialog
        option={pendingDisable}
        alternatives={pendingDisable ? alternativesFor(pendingDisable) : []}
        onClose={() => setPendingDisable(null)}
      />
    </div>
  )
}
