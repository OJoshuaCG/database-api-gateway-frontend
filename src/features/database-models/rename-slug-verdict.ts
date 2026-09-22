import type { RenameSlugDatabase, RenameSlugPlan } from '@/lib/contracts'

/**
 * Los dos usos del asistente de tablas de versión. Comparten schema de plan y de resultado
 * (v25 §2.3), así que comparten también el veredicto: lo único que cambia es qué significa «no
 * hay nada remoto que hacer».
 *
 * - `rename-slug`: cambia el slug del blueprint (§2.1 y §2.2). Sin nada remoto que hacer, el
 *   cambio sigue siendo LOCAL y se puede ejecutar.
 * - `migrate-format`: moderniza las tablas al formato Datum sin tocar el slug (§2.3). Sin nada
 *   remoto que hacer, no queda nada que ejecutar.
 */
export type RenameSlugMode = 'rename-slug' | 'migrate-format'

/**
 * 🔴 El semáforo del asistente, como dato. Cuatro estados, uno solo a la vez.
 *
 * - `blocked`: algún `conflict` o `unreachable`. La operación entera no se puede ejecutar.
 * - `ready`: hay escrituras remotas —renombrar, crear el espejo, o las dos—. `tokenRequired`
 *   dice si el backend emite `confirm_token`: SOLO cuando hay algo que renombrar. Con
 *   `renameCount === 0` y `mirrorPendingCount > 0` no hay token y aun así se ejecuta, mandando
 *   `confirm_token: null`.
 * - `local` (solo `rename-slug`): nada remoto; el slug cambia en el gateway y ya.
 * - `up-to-date` (solo `migrate-format`): todo el blueprint ya está en formato Datum. No es un
 *   error: una segunda corrida sale siempre así.
 */
export type RenameSlugVerdict =
  | {
      kind: 'blocked'
      conflicts: RenameSlugDatabase[]
      unreachable: RenameSlugDatabase[]
    }
  | {
      kind: 'ready'
      renameCount: number
      mirrorPendingCount: number
      alreadyCount: number
      /** Bases DISTINTAS en las que se escribe: una puede renombrarse y recibir el espejo. */
      writeCount: number
      tokenRequired: boolean
    }
  | { kind: 'local'; alreadyCount: number }
  | { kind: 'up-to-date'; alreadyCount: number; skipCount: number }

/**
 * Cuántas bases distintas reciben alguna escritura.
 *
 * Una misma base puede renombrarse Y recibir el espejo, así que sumar `rename_count` y
 * `mirror_pending_count` contaría dos veces. Se cuentan por fila, y los contadores del backend
 * actúan de suelo: si un backend anterior no manda `has_mirror` por fila, las filas no
 * alcanzan, pero el número que se le pide reconocer al operador nunca queda por debajo del
 * que el propio backend declaró.
 */
function countWrites(plan: RenameSlugPlan, renameCount: number): number {
  const ids = new Set<number>()
  for (const row of plan.databases) {
    const renames = renameCount > 0 && row.action === 'rename'
    if (renames || row.has_mirror === false) ids.add(row.managed_database_id)
  }
  return Math.max(ids.size, renameCount, plan.mirror_pending_count)
}

/**
 * Calcula el veredicto de un plan. Función pura: lo que se le dice al admin antes de escribir en
 * N bases ajenas se testea sin montar el diálogo.
 *
 * Los bloqueantes mandan sobre todo: con uno solo, lo demás no se ejecuta. Después, `no_op`
 * anula `rename_count` —los dos slugs truncan al mismo nombre y no hay nada que renombrar—
 * aunque el espejo pueda seguir pendiente.
 */
export function renameSlugVerdict(plan: RenameSlugPlan, mode: RenameSlugMode): RenameSlugVerdict {
  if (plan.blockers.length > 0) {
    return {
      kind: 'blocked',
      conflicts: plan.blockers.filter((row) => row.action === 'conflict'),
      // Todo bloqueante que no sea `conflict` se presenta como ilegible: es la lectura
      // prudente — afirmar que conviven dos tablas en una base que no se leyó mandaría al
      // operador a buscar algo que quizá no existe.
      unreachable: plan.blockers.filter((row) => row.action !== 'conflict'),
    }
  }

  const alreadyCount = plan.databases.filter((row) => row.action === 'already').length
  const renameCount = plan.no_op ? 0 : plan.rename_count
  const mirrorPendingCount = plan.mirror_pending_count

  if (renameCount > 0 || mirrorPendingCount > 0) {
    return {
      kind: 'ready',
      renameCount,
      mirrorPendingCount,
      alreadyCount,
      writeCount: countWrites(plan, renameCount),
      tokenRequired: renameCount > 0,
    }
  }

  if (mode === 'rename-slug') return { kind: 'local', alreadyCount }

  return {
    kind: 'up-to-date',
    alreadyCount,
    skipCount: plan.databases.filter((row) => row.action === 'skip').length,
  }
}

/** ¿El veredicto deja ejecutar algo? `blocked` y `up-to-date` no. */
export function verdictAllowsExecution(verdict: RenameSlugVerdict): boolean {
  return verdict.kind === 'ready' || verdict.kind === 'local'
}

/**
 * ¿Describen dos planes las MISMAS consecuencias sobre bases reales?
 *
 * Comparación por ids en orden, igual que el `planConsequencesChanged` de
 * `MigrationDeletePlanDialog`. Se usa para desmarcar el reconocimiento tras re-planificar: lo que
 * el usuario aceptó describía otra lista de bases, y arrastrar ese «sí» a una lista distinta
 * convierte la casilla en un trámite.
 *
 * Compara `databases` y no solo `blockers` porque el reconocimiento habla de «escribe en N
 * base(s)»: si cambia QUIÉN se renombra, aunque no haya bloqueantes ni antes ni después, el texto
 * que se aceptó ya no describe lo que va a pasar. También mira la ACCIÓN de cada fila y su
 * `has_mirror`, porque la misma base puede pasar de `skip` a `rename`, o dejar de necesitar el
 * espejo, sin que la lista cambie de tamaño.
 */
export function planConsequencesChanged(before: RenameSlugPlan, after: RenameSlugPlan): boolean {
  const same = (left: RenameSlugDatabase[], right: RenameSlugDatabase[]) =>
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.managed_database_id === right[index]?.managed_database_id &&
        row.action === right[index]?.action &&
        row.has_mirror === right[index]?.has_mirror,
    )

  return (
    before.new_table !== after.new_table ||
    before.rename_count !== after.rename_count ||
    before.mirror_pending_count !== after.mirror_pending_count ||
    !same(before.databases, after.databases)
  )
}

/**
 * Los nombres de unas bases para una frase, con tope: el veredicto NOMBRA las bases que
 * bloquean, pero en un parque grande una frase con treinta nombres deja de leerse. El resto
 * está completo en la tabla de evidencia, justo debajo.
 */
export function listDatabaseNames(
  rows: readonly { managed_database_id: number; database_name: string }[],
  max = 5,
): string {
  const names = rows.map((row) => row.database_name || `BD #${row.managed_database_id}`)
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} y ${names.length - max} más`
}
