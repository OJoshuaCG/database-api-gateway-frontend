import type { ModelDatabaseStatus } from '@/lib/contracts'

/**
 * En cuántas BDs del blueprint está PENDIENTE una versión y, si el backend lo publica, en cuántas
 * está APLICADA.
 *
 * ## Por qué «aplicada en N de M» no se deriva en el cliente
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
 * `status=applied` **y** versión cacheada que la alcanza— y los insumos de esa conjunción (el
 * historial por base) no llegan al listado. Derivarla acá sería escribir la misma política a los
 * dos lados del contrato, y con una regla peor.
 *
 * **Eso cambió con `applied_database_count`**: el backend ahora publica el RESULTADO de la
 * conjunción por versión en `ModelMigrationSummary`, como dato para mostrar (no gobierna ningún
 * control: para eso siguen `sql_frozen` y `deletable`). Con él la ficha dice «aplicada en N de M»
 * leyéndolo tal cual, sin calcular nada. Sin él —un backend anterior durante el despliegue— vuelve
 * a contar pendientes: `adoptionHeadline` elige, y nunca inventa un cero.
 *
 * Así que esto cuenta **solo lo que el backend afirma**: `pending_versions`, que es una lectura
 * directa, y `applied_database_count` cuando llega. Lo demás lo dicen los booleanos por versión
 * del propio `ModelMigrationSummary` (`block_reason === 'in_use'` → alguna BD está parada
 * EXACTAMENTE en ella; `'partial'` → aplicación parcial sin resolver), que sí están decididos del
 * lado que manda. El valor era `'applied'` hasta v18 y se sigue aceptando como legado, pero un
 * backend al día no lo devuelve: quien lea solo por ese nombre va a creer que la versión no está
 * en uso en ninguna parte.
 *
 * ## Dos límites que la UI tiene que decir, no esconder
 *
 * 1. **`pending_versions` de este endpoint es un PISO, no un conteo cerrado.** Se calcula sobre la
 *    copia local del gateway, sin abrir el motor y sin comprobar que la base exista. El endpoint
 *    por BD, en cambio, con `database_exists: false` lista TODO el blueprint como pendiente. Una
 *    base borrada por fuera del gateway no aparece acá como pendiente aunque no tenga nada.
 *    `applied_database_count` sale de la misma caché y hereda el límite.
 * 2. **El denominador de pendientes excluye lo que no está `active`.** `GET
 *    /database-models/{id}/databases` devuelve todas las filas sin filtrar por estado, así que una
 *    base registrada sin `CREATE DATABASE` (`pending`), en cuarentena (`error`) o archivada
 *    contaminaría el conteo. Se excluyen y se **declaran** en `excluded`: ocultarlas cambiaría el
 *    denominador en silencio. `applied_database_count`, en cambio, el backend lo cuenta **sin
 *    filtrar por estado**, así que su denominador es el de TODAS las filas (`total + excluded`):
 *    dividirlo por las activas podría dar «aplicada en 3 de 2».
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

/**
 * La cifra principal de la fila de adopción.
 *
 * `applied` solo si el backend publicó `applied_database_count` —ausente es «no lo sé», nunca
 * cero—; si no, `pending` sobre las activas, que es lo que se decía antes de existir el campo.
 * Cada una con SU denominador: ver el límite 2 del JSDoc de arriba.
 */
export type AdoptionHeadline =
  | { kind: 'applied'; applied: number; of: number }
  | { kind: 'pending'; pending: number; of: number }

export function adoptionHeadline(
  adoption: PendingAdoption,
  appliedDatabaseCount: number | undefined,
): AdoptionHeadline {
  if (appliedDatabaseCount === undefined) {
    return { kind: 'pending', pending: adoption.pending, of: adoption.total }
  }
  return {
    kind: 'applied',
    applied: appliedDatabaseCount,
    of: adoption.total + adoption.excluded,
  }
}
