import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  CodeBlock,
  DataTable,
  EmptyState,
  ErrorState,
  EyeIcon,
  IconButton,
  Input,
  Modal,
  Pagination,
  RefreshIcon,
  XIcon,
  type BadgeTone,
} from '@/components/ui'
import {
  engineLabel,
  formatDateTime,
  formatDuration,
  formatInteger,
  formatRelative,
} from '@/lib/utils'
import { type ConnectionMode, type QueryHistoryOut } from '@/lib/contracts'
import { dangerCopy, historyStatusCopy, MODE_OPTIONS } from '../logic'
import { useQueryHistory } from '../hooks/use-query-history'

export interface QueryHistoryPanelProps {
  serverId: number
  /** Carga esa consulta en el editor y vuelve a la pestaña de consola. */
  onLoadInEditor: (entry: QueryHistoryOut) => void
  /** Filtro inicial por base de datos (el de la consola). Opcional. */
  initialDatabase?: string
}

/** Etiqueta corta del modo, para que quepa en la celda; la larga va en el `title`. */
const MODE_SHORT_LABEL: Record<ConnectionMode, string> = {
  provided: 'contraseña',
  stored: 'inventario',
  impersonate: 'rol',
  admin: 'pseudo-root',
}

/**
 * Mismo criterio de color que la franja de identidad de la consola (`identityTone`): el rojo
 * queda para `admin` porque una ejecución con la credencial pseudo-root no prueba permisos, los
 * evita — y a la semana siguiente, leyendo la bitácora, esa distinción es justo la que se pierde.
 */
const MODE_TONE: Record<ConnectionMode, BadgeTone> = {
  provided: 'primary',
  stored: 'primary',
  impersonate: 'info',
  admin: 'error',
}

const MODE_HINT: Record<ConnectionMode, string> = Object.fromEntries(
  MODE_OPTIONS.map((option) => [option.mode, `${option.label} — ${option.hint}`]),
) as Record<ConnectionMode, string>

/** Devuelve `value` retrasado `delayMs` para no gastar el rate limit (60/min) en cada pulsación. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/**
 * Pestaña «Historial» de la Consola SQL: bitácora paginada de lo que se ejecutó en un servidor.
 *
 * El historial guarda METADATOS, nunca datos (§2.4), así que esta pantalla no puede ser «volvé a
 * ver el resultado del martes» por mucho que sea lo que uno espera de un historial. Se diseñó
 * como bitácora + atajo de re-ejecución, y el aviso del pie está fijo —no descartable— porque la
 * expectativa equivocada vuelve cada vez que alguien entra por primera vez.
 *
 * La columna que manda es «Ejecutado como»: la pregunta que trae al admin acá es «¿con qué
 * usuario probamos esto?», no «¿qué se corrió?».
 */
export function QueryHistoryPanel({
  serverId,
  onLoadInEditor,
  initialDatabase,
}: QueryHistoryPanelProps) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [databaseDraft, setDatabaseDraft] = useState(initialDatabase ?? '')
  const [detail, setDetail] = useState<QueryHistoryOut | null>(null)

  const debouncedDatabase = useDebouncedValue(databaseDraft.trim(), 400)

  // Ajuste de estado en render (no en efecto): al cambiar el filtro hay que volver a la página 1,
  // o se pide una página que el resultado filtrado ya no tiene y la tabla aparece vacía.
  const [appliedDatabase, setAppliedDatabase] = useState(debouncedDatabase)
  if (appliedDatabase !== debouncedDatabase) {
    setAppliedDatabase(debouncedDatabase)
    setPage(1)
  }

  const hasFilter = debouncedDatabase.length > 0

  const { data, isLoading, isFetching, isError, error, refetch } = useQueryHistory(serverId, {
    page,
    size,
    database: debouncedDatabase || null,
  })

  const columns = useMemo<ColumnDef<QueryHistoryOut>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Fecha',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="whitespace-nowrap text-foreground">
              {formatDateTime(row.original.created_at)}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatRelative(row.original.created_at)}
            </span>
          </div>
        ),
      },
      {
        id: 'admin',
        header: 'Admin',
        accessorFn: (row) => row.admin_username ?? '—',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        id: 'run_as',
        header: 'Ejecutado como',
        accessorFn: (row) => row.run_as_username,
        cell: ({ row }) => {
          const entry = row.original
          return (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{entry.run_as_username}</span>
              <div className="flex flex-wrap items-center gap-1">
                <span title={MODE_HINT[entry.connection_mode]}>
                  <Badge tone={MODE_TONE[entry.connection_mode]}>
                    {MODE_SHORT_LABEL[entry.connection_mode]}
                  </Badge>
                </span>
                {entry.impersonated_role && (
                  <span
                    className="text-xs text-muted-foreground"
                    title="Rol adoptado con SET ROLE sobre esa conexión."
                  >
                    rol {entry.impersonated_role}
                  </span>
                )}
              </div>
            </div>
          )
        },
      },
      {
        id: 'database',
        header: 'Base',
        accessorFn: (row) => row.database_name,
        cell: ({ row }) => (
          <span className="text-foreground" title={engineLabel(row.original.engine)}>
            {row.original.database_name}
          </span>
        ),
      },
      {
        id: 'danger',
        header: 'Nivel',
        accessorFn: (row) => row.danger_level,
        cell: ({ row }) => {
          const copy = dangerCopy(row.original.danger_level)
          return (
            <span title={copy.description}>
              <Badge tone={copy.tone}>{copy.label}</Badge>
            </span>
          )
        },
      },
      {
        id: 'status',
        header: 'Estado',
        accessorFn: (row) => row.status,
        cell: ({ row }) => {
          const entry = row.original
          const copy = historyStatusCopy(entry.status)
          return (
            <div className="flex flex-wrap items-center gap-1">
              <span title={copy.hint}>
                <Badge tone={copy.tone}>{copy.label}</Badge>
              </span>
              {entry.dry_run && (
                <span title="Modo de prueba: se ejecutó y se revirtió. Las cifras son reales, los cambios no.">
                  <Badge tone="neutral">prueba</Badge>
                </span>
              )}
              {entry.read_only && !entry.dry_run && (
                <span
                  className="text-xs text-muted-foreground"
                  title="Corrió dentro de una transacción de solo lectura del motor."
                >
                  solo lectura
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'statements',
        header: 'Sentencias',
        accessorFn: (row) => row.statement_count,
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{formatInteger(getValue<number>())}</span>
        ),
      },
      {
        id: 'rows',
        header: 'Filas dev./afect.',
        accessorFn: (row) => row.rows_returned,
        cell: ({ row }) => (
          <span
            className="whitespace-nowrap text-muted-foreground"
            title="Filas devueltas por las lecturas / filas afectadas por las escrituras. El historial guarda las cifras, no las filas."
          >
            {formatInteger(row.original.rows_returned)} /{' '}
            {formatInteger(row.original.rows_affected)}
          </span>
        ),
      },
      {
        id: 'duration',
        header: 'Duración',
        accessorFn: (row) => row.duration_ms,
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatDuration(getValue<number>())}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5">
            <IconButton
              label="Ver SQL"
              icon={<EyeIcon />}
              size="icon-sm"
              onClick={() => setDetail(row.original)}
            />
            <Button
              variant="ghost"
              size="sm"
              // Con `provided` la contraseña no existe en ninguna parte (tampoco en el backend):
              // se avisa en el tooltip y el hook orquestador lo repite al cargar la consulta.
              title={
                row.original.connection_mode === 'provided'
                  ? 'Restaura el SQL, la base y el usuario. La contraseña no se guarda: vas a tener que escribirla otra vez.'
                  : 'Restaura el SQL, la base y la identidad de esta ejecución en el editor.'
              }
              onClick={() => onLoadInEditor(row.original)}
            >
              Cargar en el editor
            </Button>
          </div>
        ),
      },
    ],
    [onLoadInEditor],
  )

  const clearFilter = () => setDatabaseDraft('')

  return (
    <div className="flex flex-col gap-4">
      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable<QueryHistoryOut>
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            isFetching={isFetching}
            getRowId={(row) => String(row.id)}
            // Sin búsqueda global: solo filtraría la página cargada y se leería como si buscara
            // en todo el historial. El único filtro que abarca la bitácora entera es el de abajo,
            // que sí viaja al backend.
            enableGlobalFilter={false}
            enableColumnVisibility
            toolbar={
              <div className="flex w-full items-end gap-2 sm:w-auto">
                <div className="w-full sm:w-64">
                  <Input
                    label="Base de datos"
                    value={databaseDraft}
                    onChange={(event) => setDatabaseDraft(event.target.value)}
                    placeholder="app_prod"
                    hint="Nombre exacto, sensible a mayúsculas."
                    type="search"
                  />
                </div>
                {databaseDraft.length > 0 && (
                  <IconButton
                    label="Limpiar filtro"
                    icon={<XIcon />}
                    size="icon-sm"
                    className="mb-6"
                    onClick={clearFilter}
                  />
                )}
                <IconButton
                  label="Actualizar"
                  icon={<RefreshIcon />}
                  size="icon-sm"
                  className="mb-6"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                />
              </div>
            }
            emptyState={
              hasFilter ? (
                <EmptyState
                  title={`Sin ejecuciones sobre «${debouncedDatabase}»`}
                  description="El filtro busca el nombre exacto de la base. Revisá cómo está escrito o mirá el historial completo del servidor."
                  action={
                    <Button variant="outline" size="sm" onClick={clearFilter}>
                      Limpiar filtro
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="Todavía no se ejecutó ninguna consulta en este servidor."
                  description="Lo que ejecutes desde la consola va a quedar registrado acá: qué SQL fue, con qué usuario del motor y cómo terminó."
                />
              )
            }
          />

          {data && data.items.length > 0 && (
            <Pagination
              page={data.pagination.page}
              pages={data.pagination.pages}
              total={data.pagination.total}
              size={data.pagination.size}
              hasNext={data.pagination.has_next}
              hasPrev={data.pagination.has_prev}
              onPageChange={setPage}
              onSizeChange={(next) => {
                setSize(next)
                setPage(1)
              }}
              isFetching={isFetching}
            />
          )}
        </>
      )}

      {/* Fijo y no descartable: es la única forma de que «historial» no se lea como «resultados
          guardados». Ese malentendido reaparece con cada admin nuevo, no una sola vez. */}
      <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
        El historial guarda <strong className="font-medium text-foreground">qué se ejecutó</strong>,
        no los resultados. Para volver a ver los datos hay que ejecutar la consulta de nuevo.
      </p>

      {detail && (
        <QueryHistoryDetailModal
          entry={detail}
          onClose={() => setDetail(null)}
          onLoadInEditor={(entry) => {
            setDetail(null)
            onLoadInEditor(entry)
          }}
        />
      )}
    </div>
  )
}

interface QueryHistoryDetailModalProps {
  entry: QueryHistoryOut
  onClose: () => void
  onLoadInEditor: (entry: QueryHistoryOut) => void
}

/** Detalle de una fila: el SQL tal como quedó registrado, más el error nativo si lo hubo. */
function QueryHistoryDetailModal({ entry, onClose, onLoadInEditor }: QueryHistoryDetailModalProps) {
  const status = historyStatusCopy(entry.status)
  const danger = dangerCopy(entry.danger_level)
  const hasError = Boolean(entry.error_code) || Boolean(entry.error_message)

  return (
    <Modal
      open
      onClose={onClose}
      title="SQL de la ejecución"
      description={`${formatDateTime(entry.created_at)} · ${entry.database_name} · ejecutado como ${entry.run_as_username}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={() => onLoadInEditor(entry)}>Cargar en el editor</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span title={MODE_HINT[entry.connection_mode]}>
            <Badge tone={MODE_TONE[entry.connection_mode]}>
              {MODE_SHORT_LABEL[entry.connection_mode]}
            </Badge>
          </span>
          <span title={danger.description}>
            <Badge tone={danger.tone}>{danger.label}</Badge>
          </span>
          <span title={status.hint}>
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
          {entry.dry_run && <Badge tone="neutral">prueba</Badge>}
          {entry.read_only && <Badge tone="neutral">solo lectura</Badge>}
          {entry.committed && <Badge tone="neutral">confirmada</Badge>}
          <span className="text-xs text-muted-foreground">
            {formatInteger(entry.statement_count)} sentencia(s) ·{' '}
            {formatDuration(entry.duration_ms)} · {engineLabel(entry.engine)}
          </span>
        </div>

        {/* Se dice acá y no en la tabla: es al leer el SQL cuando importa saber que lo que se ve
            puede no ser byte a byte lo que se envió. */}
        <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
          Este es el texto tal como quedó registrado: las contraseñas literales se guardan como{' '}
          <code className="font-mono">&apos;***&apos;</code> y el lote está recortado a 16 KB, así
          que puede no ser exactamente lo que se envió.
        </p>

        <CodeBlock code={entry.sql_text} title="SQL registrado" maxHeightClass="max-h-96" />

        {hasError && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Respuesta del motor</p>
            {/* Sin rojo a propósito: acá caen los rechazos por permisos, que muchas veces son
                justamente el resultado que se fue a buscar. */}
            <div className="rounded-lg border border-border bg-surface-muted p-3">
              {entry.error_code && (
                <p className="font-mono text-xs text-muted-foreground">{entry.error_code}</p>
              )}
              {entry.error_message && (
                <p className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                  {entry.error_message}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
