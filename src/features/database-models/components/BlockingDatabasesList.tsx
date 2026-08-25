import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui'
import { useModelDatabases } from '../hooks/use-database-models'

/**
 * Forma de una fila, con `reason` como `string` y no como el enum del contrato: llega tanto de
 * `MigrationEditPreviewOut` (donde Zod ya la validó) como de `ApiError.blockingDatabases` (donde
 * no, porque `lib/api` no depende de `lib/contracts` a propósito). Aceptar el tipo ancho evita un
 * adaptador y, sobre todo, hace que un motivo nuevo del backend se pinte igual en vez de tumbar
 * la lista — cada fila es una base que va a quedar divergente.
 */
interface BlockingRow {
  managed_database_id: number
  reason: string
  current_version?: string
}

interface BlockingDatabasesListProps {
  modelId: number
  rows: BlockingRow[]
  /** `X-Request-ID` de la respuesta, para los motivos que son inconsistencia del inventario. */
  requestId?: string
}

const REASON_TONE: Record<string, 'warning' | 'error' | 'neutral'> = {
  still_applied: 'warning',
  unreadable: 'neutral',
  unknown_database: 'error',
  unknown_blueprint: 'error',
}

/**
 * Las BDs que bloquean editar o borrar una versión (api-reference-v14 §2).
 *
 * Se usa en los tres sitios donde aparece la misma lista —el panel del 409, el paso 1 de la
 * confirmación y la pantalla de resultado—, porque son literalmente las mismas filas y
 * duplicarlas terminaría con tres textos distintos para el mismo hecho.
 *
 * **Los nombres no vienen en el payload**: el backend manda solo el id, porque el mensaje nativo
 * del motor puede arrastrar host, usuario o fragmentos de sentencia. Se resuelven contra las BDs
 * del blueprint, que es **una sola llamada** ya cacheada (comparte clave con la pestaña «Estado en
 * las BDs») en vez de una por fila. Si no se resuelve, la fila dice «BD #7» y sigue: un nombre que
 * falta no es un fallo de la operación, y bloquear el panel esperándolo sí lo sería.
 *
 * **La lista no se pagina ni se trunca.** Cada fila es una base que va a quedar divergente, y
 * ocultar filas es ocultar el costo: si no entra, hace scroll dentro de su contenedor.
 */
export function BlockingDatabasesList({ modelId, rows, requestId }: BlockingDatabasesListProps) {
  // `enabled` atado a que haya filas: sin bloqueantes no hay nada que nombrar.
  const databases = useModelDatabases(modelId, rows.length > 0)

  const nameOf = (id: number): string | undefined =>
    databases.data?.find((database) => database.id === id)?.name

  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
      {rows.map((row) => {
        const name = nameOf(row.managed_database_id)
        const label = name ?? `BD #${row.managed_database_id}`
        return (
          <li
            key={row.managed_database_id}
            className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{label}</span>
              {name && (
                <span className="text-xs text-muted-foreground">#{row.managed_database_id}</span>
              )}
              <Badge tone={REASON_TONE[row.reason] ?? 'neutral'}>
                {row.reason === 'still_applied'
                  ? `está en la versión ${row.current_version ?? '—'}`
                  : row.reason === 'unreadable'
                    ? 'no se pudo verificar'
                    : 'inconsistencia interna'}
              </Badge>
            </div>

            {row.reason === 'unreadable' && (
              // NO se ofrece «reintentar»: si el operador reintenta hasta que la fila desaparezca,
              // va a leer esa desaparición como «esa BD ya no la tiene». Es un problema a
              // resolver (conexión, aprovisionamiento), no un permiso a forzar.
              <p className="text-xs text-muted-foreground">
                El gateway no pudo leer su versión (motor caído, base sin aprovisionar o
                credenciales rotas) y la cuenta como bloqueante.
              </p>
            )}
            {(row.reason === 'unknown_database' || row.reason === 'unknown_blueprint') && (
              <p className="text-xs text-muted-foreground">
                Inconsistencia interna del inventario. Reportar
                {requestId ? ` con el Request ID ${requestId}` : ''}.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Link
                to={`/managed-databases/${row.managed_database_id}/migrations`}
                className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
              >
                Ver la base →
              </Link>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
