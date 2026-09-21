import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Callout,
  CopyIcon,
  DataTable,
  EmptyState,
  ErrorState,
  EyeIcon,
  IconButton,
  Modal,
  Pagination,
  Spinner,
} from '@/components/ui'
import type { MigrationHistoryItem } from '@/lib/contracts'
import { formatDateTime, formatDuration, isClipboardAvailable } from '@/lib/utils'
import { useToast } from '@/lib/toast/use-toast'
import {
  hasUnknownDirection,
  historyActorLabel,
  historyDirectionSpec,
  historyStatusSpec,
  historyVersionSpec,
} from '../history-badges'
import { useMigrationHistory } from '../hooks/use-db-migrations'

/**
 * Historial de aplicaciones paginado (server-side): la página vive en estado local.
 *
 * Es la bitácora de lo que YA le pasó a esta base, y desde v25 lleva cuatro dimensiones que antes
 * no existían —dirección, actor, checksum aplicado y el `request_id`—, así que dejó de caber en
 * una lista de dos líneas por fila. La forma es una tabla con el vocabulario derivado de
 * `history-badges.ts`, y el detalle largo de cada evento se abre en un diálogo.
 *
 * **Toda fila antigua trae los campos nuevos en `null` y tiene que leerse igual de bien**: este
 * panel no oculta ni atenúa nada por estar incompleto. Un evento cuya versión se borró del
 * blueprint es justo el que hay que poder leer, porque la versión y el checksum aplicado son lo
 * único que queda de él.
 */
export function MigrationHistoryPanel({
  dbId,
  modelId,
}: {
  dbId: number
  /**
   * Blueprint al que pertenece esta BD, para poder enlazar cada fila con la versión que nombra.
   * Opcional porque una BD sin blueprint asignado no tiene a dónde ir: ahí el texto se queda sin
   * enlace en vez de llevar a una ruta inventada.
   */
  modelId?: number
}) {
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<MigrationHistoryItem | null>(null)
  const { data, isLoading, isError, error, refetch } = useMigrationHistory(
    dbId,
    { page, size: 10 },
    true,
  )

  const items = useMemo(() => data?.items ?? [], [data])

  const columns = useMemo<ColumnDef<MigrationHistoryItem>[]>(
    () => [
      {
        accessorKey: 'applied_at',
        header: 'Fecha',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-foreground">
            {formatDateTime(row.original.applied_at)}
          </span>
        ),
      },
      {
        id: 'version',
        header: 'Versión',
        accessorFn: (row) => row.version ?? '',
        cell: ({ row }) => {
          const spec = historyVersionSpec(row.original)
          return (
            <div className="flex flex-col gap-1">
              {/*
                El enlace se omite en dos casos, y solo en dos: sin `modelId` no hay con qué
                construir la ruta, y con la versión borrada del catálogo
                (`model_migration_id === null`, que es lo que apaga `spec.linkable`) no hay a
                dónde ir. En ninguno se atenúa la fila: el evento ocurrió igual, y cuando la FK
                quedó en null esta fila es lo ÚNICO que queda de él.
              */}
              {spec.linkable && modelId !== undefined && modelId > 0 ? (
                <Link
                  to={`/database-models/${modelId}/migrations?version=${encodeURIComponent(spec.text)}`}
                  className="w-fit break-all rounded bg-surface-muted px-1.5 py-0.5 text-xs text-primary hover:underline"
                >
                  {spec.text}
                </Link>
              ) : (
                <code className="w-fit break-all rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  {spec.text}
                </code>
              )}
              {spec.badge && (
                <Badge tone={spec.badge.tone} title={spec.badge.title}>
                  {spec.badge.short ?? spec.badge.label}
                </Badge>
              )}
              {spec.note && <span className="text-xs text-muted-foreground">{spec.note}</span>}
            </div>
          )
        },
      },
      {
        id: 'direction',
        header: 'Dirección',
        accessorFn: (row) => row.direction ?? '',
        cell: ({ row }) => {
          const spec = historyDirectionSpec(row.original.direction)
          return (
            <Badge tone={spec.tone} title={spec.title}>
              {spec.icon && <span aria-hidden>{spec.icon}</span>}
              {spec.label}
            </Badge>
          )
        },
      },
      {
        id: 'status',
        header: 'Resultado',
        accessorFn: (row) => row.status,
        cell: ({ row }) => {
          const entry = row.original
          const spec = historyStatusSpec(entry.status)
          return (
            <div className="flex flex-col gap-1">
              <Badge tone={spec.tone} title={spec.title}>
                {spec.label}
              </Badge>
              {entry.error && (
                // Recortado a propósito: el error nativo del motor puede ser larguísimo y
                // desmontaría el ancho de la columna. El completo está en el detalle.
                <span className="block max-w-48 truncate text-xs text-error" title={entry.error}>
                  {entry.error}
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'duration',
        header: 'Duración',
        accessorFn: (row) => row.execution_ms ?? -1,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {row.original.execution_ms != null ? formatDuration(row.original.execution_ms) : '—'}
          </span>
        ),
      },
      {
        id: 'actor',
        header: 'Quién',
        accessorFn: (row) => historyActorLabel(row),
        cell: ({ row }) => (
          <span
            className="break-all text-muted-foreground"
            title={
              row.original.actor_username || row.original.actor_type
                ? undefined
                : 'El historial anterior a esta entrega no registraba quién disparaba cada evento.'
            }
          >
            {historyActorLabel(row.original)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <IconButton
              label="Ver detalle"
              icon={<EyeIcon />}
              size="icon-sm"
              onClick={() => setDetail(row.original)}
            />
          </div>
        ),
      },
    ],
    // `modelId` sale de una query del componente padre, así que al montar todavía no está y llega
    // un render después. Sin la dependencia, las columnas se memorizan con el valor inicial y el
    // enlace a la versión no aparecería NUNCA — que es justo el caso normal, no un borde.
    [modelId],
  )

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando historial…
      </div>
    )
  }
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="flex flex-col gap-3">
      {/*
        Va arriba y una sola vez, no repetido en cada fila: mientras haya un solo evento sin
        dirección, lo que deja de ser prueba de vigencia es el historial entero.
      */}
      {hasUnknownDirection(items) && (
        <Callout tone="info" title="Hay eventos anteriores al registro completo">
          <p>
            Esos eventos no registran la dirección: ahí «Aplicada» no prueba que la versión siga
            vigente, porque hasta esta entrega un apply y un rollback se guardaban igual.
          </p>
          {/*
            El mismo `direction: null` marca las filas cuya versión NO está congelada: el backend
            la resuelve por el join y devuelve el número que esa migración tiene HOY
            (api-reference-v25 §5). Si hubo un renumerado por el medio, el evento exhibe un número
            que nunca tuvo. Va en el mismo aviso y no en uno aparte porque es la misma frontera —
            dos avisos sobre la misma cosa se leen como dos problemas distintos.
          */}
          <p>
            Y su número de versión sale del catálogo actual, no de una copia del momento: si esa
            versión se renumeró después, acá figura con el número de ahora y no con el que tuvo.
          </p>
        </Callout>
      )}

      <DataTable<MigrationHistoryItem>
        data={items}
        columns={columns}
        getRowId={(row) => String(row.id)}
        // La paginación es server-side (abajo): un buscador que filtrara solo las 10 filas
        // cargadas se leería como si buscara en todo el historial, y engaña.
        enableGlobalFilter={false}
        // El vacío va DENTRO de la tabla y no como early return: cortando antes, una página
        // vacía —que ocurre si el historial se acorta mientras alguien está en la página 3— se
        // llevaba por delante los controles de paginación y dejaba al operador sin forma de
        // volver. Mismo criterio que `QueryHistoryPanel`.
        emptyState={<EmptyState title="Esta base no tiene historial de migraciones." />}
      />

      {data && data.pagination.pages > 1 && (
        <Pagination
          page={data.pagination.page}
          pages={data.pagination.pages}
          total={data.pagination.total}
          size={data.pagination.size}
          hasNext={data.pagination.has_next}
          hasPrev={data.pagination.has_prev}
          onPageChange={setPage}
        />
      )}

      {detail && <MigrationHistoryDetailModal entry={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

/**
 * Detalle de un evento: lo que no cabe en una celda.
 *
 * Va en diálogo y no como fila desplegable porque `DataTable` no expone sub-filas, y meter un
 * bloque ancho —un error nativo, un checksum de 64 caracteres— dentro de una celda ensancharía
 * esa columna para TODAS las filas (el ancho de columna es global en una tabla), que es justo
 * cómo aparece el scroll horizontal que el proyecto prohíbe. Mismo patrón que el historial de la
 * consola SQL.
 */
function MigrationHistoryDetailModal({
  entry,
  onClose,
}: {
  entry: MigrationHistoryItem
  onClose: () => void
}) {
  const toast = useToast()
  const version = historyVersionSpec(entry)
  const direction = historyDirectionSpec(entry.direction)
  const status = historyStatusSpec(entry.status)
  const clipboardReady = isClipboardAvailable()

  const copyRequestId = async () => {
    if (!entry.request_id) return
    try {
      await navigator.clipboard.writeText(entry.request_id)
      toast.success('ID de solicitud copiado al portapapeles')
    } catch {
      toast.error('No se pudo copiar al portapapeles', 'Selecciónalo y cópialo a mano.')
    }
  }

  return (
    <Modal open onClose={onClose} title="Detalle del evento" size="lg">
      <div className="flex flex-col gap-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha">{formatDateTime(entry.applied_at)}</Field>
          <Field label="Duración">
            {entry.execution_ms != null ? formatDuration(entry.execution_ms) : '—'}
          </Field>
          <Field label="Versión">
            <span className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                {version.text}
              </code>
              {version.badge && (
                <Badge tone={version.badge.tone} title={version.badge.title}>
                  {version.badge.label}
                </Badge>
              )}
            </span>
            {version.note && (
              <span className="mt-1 block text-xs text-muted-foreground">{version.note}</span>
            )}
          </Field>
          <Field label="Quién">{historyActorLabel(entry)}</Field>
          <Field label="Dirección">
            <Badge tone={direction.tone} title={direction.title}>
              {direction.icon && <span aria-hidden>{direction.icon}</span>}
              {direction.label}
            </Badge>
            <span className="mt-1 block text-xs text-muted-foreground">{direction.title}</span>
          </Field>
          <Field label="Resultado">
            <Badge tone={status.tone}>{status.label}</Badge>
          </Field>
        </dl>

        {entry.error && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Error del motor</span>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-error/30 bg-error/5 p-3 font-mono text-xs text-foreground">
              {entry.error}
            </pre>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Checksum aplicado</span>
          <code className="select-all break-all rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-foreground">
            {entry.applied_checksum ?? '—'}
          </code>
          {/*
            Se muestra como DATO y no como insignia de divergencia: marcar «divergente» exigiría
            el checksum vigente de la versión en el blueprint, que la respuesta del historial no
            trae. Inventar la comparación con lo que hay acá daría un falso negativo silencioso.
          */}
          <span className="text-xs text-muted-foreground">
            Checksum del SQL que realmente corrió en esta base. Para saber si la versión se editó
            después hay que compararlo con el checksum vigente en el blueprint.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {/* «ID de solicitud» es el rótulo que ya usa `ErrorState`: mismo dato, mismo nombre. */}
          <span className="text-xs font-medium text-muted-foreground">ID de solicitud</span>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
            <code className="flex-1 select-all break-all font-mono text-xs text-foreground">
              {entry.request_id ?? '—'}
            </code>
            {entry.request_id && (
              <IconButton
                label="Copiar ID de solicitud"
                icon={<CopyIcon />}
                size="icon-sm"
                disabled={!clipboardReady}
                onClick={() => void copyRequestId()}
              />
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            Para correlacionar con la auditoría y los logs.
          </span>
          {entry.request_id && !clipboardReady && (
            // El portapapeles solo existe en contexto seguro, y este gateway también se sirve por
            // HTTP plano: sin el aviso, el botón deshabilitado no explica nada.
            <span className="text-xs text-muted-foreground">
              El portapapeles no está disponible sobre HTTP plano: selecciónalo y cópialo a mano.
            </span>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Par etiqueta/valor del detalle. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}
