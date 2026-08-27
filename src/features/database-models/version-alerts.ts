import type { ModelMigrationSummary } from '@/lib/contracts'

/**
 * Los avisos del catálogo de versiones de un blueprint: **qué versiones** están en cada estado que
 * tiene consecuencia.
 *
 * **Existe porque se eliminó `VersionsTable`.** Esa tabla no era un índice redundante del
 * desplegable: era la única vista que permitía ESCANEAR. Sin ella, «¿qué versiones no tienen
 * rollback?» o «¿cuáles están sin revisar?» pasaba a contestarse clic por clic, y dos textos de la
 * app —`describeCaptureRejection` en `capture.ts` y el aviso previo del `ApplyMigrationsDialog`—
 * mandaban al operador «a la tabla de versiones», que ya no existía.
 *
 * Lógica pura sobre el catálogo que ya está en memoria: **no dispara ninguna petición**.
 *
 * Los cuatro cubos no son «los booleanos que había»: son los que llevan a una acción distinta.
 * - `unreviewed` frena el apply con 409 → hay que aprobarlas.
 * - `withoutRollback` hace que cualquier rollback que las atraviese falle con 409 → hay que
 *   confirmarles un `down_sql` antes de necesitarlo, no después.
 * - `diverged` dice que hay bases con el esquema anterior → hay que decidir si se reconcilia.
 * - `frozen` dice que editarlas pide confirmación explícita → no es un problema, es un aviso de
 *   fricción, y por eso va con el tono más bajo de los cuatro.
 */
export interface VersionAlerts {
  /** `reviewed === false`: no se pueden aplicar (409). */
  unreviewed: string[]
  /** `has_rollback === false`: un rollback que las atraviese falla con 409, para todo el camino. */
  withoutRollback: string[]
  /** `sql_diverged`: el SQL se editó después de que alguna base la aplicara. */
  diverged: string[]
  /** `sql_frozen`: editar el SQL base pide confirmación explícita. */
  frozen: string[]
}

/**
 * Recorre el catálogo UNA vez y reparte. Recibe la lista ya ordenada para que las versiones de
 * cada cubo salgan en el mismo orden que el desplegable — un aviso que lista «0007, 0003, 0011» se
 * lee como si el orden significara algo.
 */
export function versionAlerts(sorted: readonly ModelMigrationSummary[]): VersionAlerts {
  const alerts: VersionAlerts = {
    unreviewed: [],
    withoutRollback: [],
    diverged: [],
    frozen: [],
  }

  for (const migration of sorted) {
    // `=== false` y no `!migration.reviewed`: el campo es OPCIONAL en el contrato, y un backend que
    // no lo mande no significa «sin revisar». Mismo criterio estricto que `blockedByReview` en
    // `capture.ts`, que describe un rechazo real del backend y no un aviso preventivo.
    if (migration.reviewed === false) alerts.unreviewed.push(migration.version)
    if (!migration.has_rollback) alerts.withoutRollback.push(migration.version)
    if (migration.sql_diverged) alerts.diverged.push(migration.version)
    if (migration.sql_frozen) alerts.frozen.push(migration.version)
  }

  return alerts
}

/** Si no hay nada que avisar, la barra no se renderiza. Un cero no es información acá. */
export function hasVersionAlerts(alerts: VersionAlerts): boolean {
  return (
    alerts.unreviewed.length > 0 ||
    alerts.withoutRollback.length > 0 ||
    alerts.diverged.length > 0 ||
    alerts.frozen.length > 0
  )
}
