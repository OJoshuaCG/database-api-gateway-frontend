import type { ModelDatabaseStatus } from '@/lib/contracts'

/**
 * En cuántas BDs del blueprint está PENDIENTE una versión.
 *
 * ## Por qué no dice «aplicada en N de M»
 *
 * Porque no se puede sostener. La tentación es `Number(model_version) >= Number(version)`, y esa
 * regla **no distingue aplicada de declarada**:
 *
 * - El alta de una BD gestionada acepta `model_version` y lo escribe **sin ejecutar ningún DDL**;
 *   `adopt` hace lo mismo, y `stamp` (con `force` incluido) existe justamente para declarar una
 *   versión a mano. Una base registrada y **vacía** contaría como «aplicada» en todo el catálogo.
 * - Una versión INTERMEDIA creada después no está obligada a ser mayor que el máximo: se puede
 *   crear `0005` con bases ya en `0010`, y quedaría «aplicada» sin que nadie la haya ejecutado.
 * - Y `pending_versions` **no** es una segunda señal que corrobore nada: el backend la calcula del
 *   mismo escalar (`pending = [v for v in versions if int(v) > int(current)]`), así que «aplicada»
 *   sería el complemento exacto de «pendiente», no un dato independiente.
 *
 * El backend define «aplicada» como una CONJUNCIÓN —fila de `database_migration_history` con
 * `status=applied` **y** alcance de versión— y **decidió no publicar los insumos**, por escrito:
 * «se devuelve la DECISIÓN, no sus insumos (conteos de historial); si el cliente recibiera "cuántas
 * BDs la aplicaron" y dedujera la regla por su cuenta, tendríamos la misma política escrita a los
 * dos lados del contrato». Derivarla acá es exactamente lo que ese comentario evita, y con una
 * regla peor.
 *
 * Así que esto cuenta **solo lo que el backend afirma**: `pending_versions`, que es una lectura
 * directa. Lo demás lo dicen los booleanos por versión del propio `ModelMigrationSummary`
 * (`block_reason === 'in_use'` → alguna BD está parada EXACTAMENTE en ella; `'partial'` →
 * aplicación parcial sin resolver), que sí están decididos del lado que manda. El valor era
 * `'applied'` hasta v18 y se sigue aceptando como legado, pero un backend al día no lo devuelve:
 * quien lea solo por ese nombre va a creer que la versión no está en uso en ninguna parte.
 *
 * ## Dos límites que la UI tiene que decir, no esconder
 *
 * 1. **`pending_versions` de este endpoint es un PISO, no un conteo cerrado.** Se calcula sobre la
 *    copia local del gateway, sin abrir el motor y sin comprobar que la base exista. El endpoint
 *    por BD, en cambio, con `database_exists: false` lista TODO el blueprint como pendiente. Una
 *    base borrada por fuera del gateway no aparece acá como pendiente aunque no tenga nada.
 * 2. **El denominador excluye lo que no está `active`.** `GET /database-models/{id}/databases`
 *    devuelve todas las filas sin filtrar por estado, así que una base registrada sin
 *    `CREATE DATABASE` (`pending`), en cuarentena (`error`) o archivada contaminaría el conteo.
 *    Se excluyen y se **declaran** en `excluded`: ocultarlas cambiaría el denominador en silencio.
 */
export interface PendingAdoption {
  /** BDs consideradas: solo `status === 'active'`. */
  total: number
  /** De esas, cuántas tienen esta versión en `pending_versions`. Lectura directa, sin derivación. */
  pending: number
  /** Solo los entornos CON pendientes. No suma a `total`, y el rótulo de la UI lo dice. */
  byEnvironment: EnvironmentPending[]
  /** BDs descartadas por no estar `active`, para poder nombrarlas. */
  excluded: number
}

export interface EnvironmentPending {
  /** `null` = BD sin clasificar, que es un valor legítimo y significa SIN protección de política. */
  environmentId: number | null
  pending: number
}

export function pendingAdoptionOfVersion(
  version: string,
  databases: readonly ModelDatabaseStatus[],
): PendingAdoption {
  // `Map` y no un objeto índice: con `noUncheckedIndexedAccess` un objeto obliga a un `?? 0` en
  // cada acceso, y el `Map` deja el defecto en un solo sitio. El orden de inserción se conserva,
  // así que los entornos salen en el orden en que aparecen las BDs.
  const perEnvironment = new Map<number | null, number>()
  let total = 0
  let pending = 0
  let excluded = 0

  for (const database of databases) {
    if (database.status !== 'active') {
      excluded += 1
      continue
    }
    total += 1
    if (!database.pending_versions.includes(version)) continue

    pending += 1
    const environmentId = database.environment_id ?? null
    perEnvironment.set(environmentId, (perEnvironment.get(environmentId) ?? 0) + 1)
  }

  return {
    total,
    pending,
    excluded,
    byEnvironment: [...perEnvironment].map(([environmentId, count]) => ({
      environmentId,
      pending: count,
    })),
  }
}
