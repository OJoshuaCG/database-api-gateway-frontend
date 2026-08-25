import { Link } from 'react-router-dom'
import { useModelDatabases } from '../hooks/use-database-models'

interface MigrationPartialProgressPanelProps {
  modelId: number
  version: string
  /** `public_context.incomplete_progress` del 409 `model_migration.partial_application`. */
  rows: { managed_database_id: number; last_statement_index: number; total_statements: number }[]
  message: string
}

/**
 * El 409 `model_migration.partial_application` (api-reference-v15 §4).
 *
 * **Este 409 no tiene vía de excepción, y ofrecérsela por analogía con `sql_frozen` sería
 * inventarse una salida.** El problema aquí no es la divergencia: es que un `resume` posterior
 * interpretaría los índices del checkpoint contra un SQL que no es el que corrió. Por eso el
 * panel no ofrece «Editar igual» ni nada que se le parezca — su única salida es terminar o
 * limpiar lo que quedó a medias.
 *
 * Lo que aporta sobre el toast rojo de antes es el dato concreto: **qué** base quedó a medias y
 * **en qué sentencia**. «La BD 7 quedó en la 12 de 40» es lo que permite decidir entre retomar
 * el apply y limpiarlo con un stamp; «hay una aplicación parcial» no permite decidir nada.
 */
export function MigrationPartialProgressPanel({
  modelId,
  version,
  rows,
  message,
}: MigrationPartialProgressPanelProps) {
  // Una sola llamada, ya cacheada por la pestaña «Estado en las BDs», en vez de una por fila.
  const databases = useModelDatabases(modelId, rows.length > 0)

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-error/40 bg-error/5 p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          Hay una aplicación de esta versión a medio camino
        </p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const name = databases.data?.find((db) => db.id === row.managed_database_id)?.name
            return (
              <li
                key={row.managed_database_id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <span className="font-medium text-foreground">
                  {name ?? `BD #${row.managed_database_id}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  quedó en la sentencia {row.last_statement_index} de {row.total_statements}
                </span>
                <Link
                  to={`/managed-databases/${row.managed_database_id}/migrations`}
                  className="ml-auto rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
                >
                  Retomar o limpiar →
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Termina el apply sobre esas bases (la retoma sigue desde donde quedó) o limpia el
        checkpoint con un stamp forzado. Mientras haya progreso a medias, el SQL de la versión{' '}
        {version} no se puede editar por ninguna vía.
      </p>
    </div>
  )
}
