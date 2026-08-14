import { fetchData, mutateVoid } from '@/lib/api/client'
import { migrationSelectResultsOutSchema, type MigrationSelectResultsOut } from '@/lib/contracts'

const base = (dbId: number, version: string) =>
  `/managed-databases/${dbId}/migrations/${encodeURIComponent(version)}/select-results`

/**
 * `GET .../migrations/{version}/select-results` — lee lo capturado en la corrida más reciente
 * de esa versión sobre esa BD (api-reference-v9 §3.5, nuevo). No pagina. `items: []` con `200`
 * es un estado válido (nunca capturado, o expirado/purgado — se distingue por `capture_selects`).
 */
export function getSelectResults(
  dbId: number,
  version: string,
  signal?: AbortSignal,
): Promise<MigrationSelectResultsOut> {
  return fetchData(base(dbId, version), migrationSelectResultsOutSchema, { signal })
}

/**
 * `DELETE .../migrations/{version}/select-results` — purga a demanda las filas capturadas
 * (api-reference-v9 §3.6, nuevo). Idempotente (`200` aunque no hubiera nada) e irreversible; la
 * confirmación de dos pasos es responsabilidad del frontend.
 */
export function purgeSelectResults(dbId: number, version: string): Promise<string | undefined> {
  return mutateVoid('DELETE', base(dbId, version))
}
