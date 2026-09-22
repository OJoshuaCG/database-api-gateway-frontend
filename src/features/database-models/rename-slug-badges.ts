import type { BadgeTone } from '@/components/ui'
import type { RenameSlugAction } from '@/lib/contracts'

/**
 * Vocabulario ÚNICO del enum de cinco del renombrado de slug y de la migración al formato
 * Datum (v25 §2.1 y §2.3): los dos endpoints devuelven el mismo schema.
 *
 * **Existe por lo mismo que `migration-badges.ts`**: allí tres juegos de insignias escritas a mano
 * divergieron y el desplegable acabó siendo el único que NO pintaba los cuatro estados de más
 * consecuencia. Este enum aparece en cinco sitios —`databases[]` y `blockers[]` del plan,
 * `renamed_databases[]` del resultado, y las listas de `conflicting_databases`,
 * `unreachable_databases`, `rename_plan`, `renamed` y `not_compensated` de los `public_context`—
 * así que la tentación de escribir un quinto juego a mano ya está servida. No se abre.
 *
 * Lógica pura y sin React, mismo criterio que `migration-badges.ts`: lo que se le dice al admin
 * antes de escribir en N bases ajenas se testea sin montar nada.
 */
export interface RenameSlugBadgeSpec {
  tone: BadgeTone
  label: string
  /** Texto de apoyo; el `label` de al lado ya lleva la información, esto explica la consecuencia. */
  title: string
  /**
   * 🔴 ¿Aborta la operación ENTERA? No «se salta esta base»: el gateway apunta a UN nombre de
   * tabla, así que renombrar solo una parte del parque deja a la otra parte con su contabilidad
   * huérfana. Por eso el veredicto del asistente es binario y no por fila.
   */
  blocking: boolean
}

const SPECS: Record<RenameSlugAction, RenameSlugBadgeSpec> = {
  rename: {
    tone: 'primary',
    label: 'Se renombra',
    title: 'Tiene la tabla de versión y se le va a aplicar un RENAME dentro del motor. 🔌',
    blocking: false,
  },
  skip: {
    tone: 'neutral',
    label: 'Sin tabla que renombrar',
    title:
      'Todavía no tiene tabla de versión: no hay nada que renombrar en esta base y no se la toca.',
    blocking: false,
  },
  // `neutral` y NO bloquea: la base ya tiene la tabla destino y no la de origen, así que no hay
  // nada que hacer. En la migración al formato Datum es el caso NORMAL de toda base ya migrada, y
  // una segunda corrida sale entera así. Pintarlo como problema haría que un blueprint ya
  // modernizado pareciera tener algo pendiente.
  already: {
    tone: 'neutral',
    label: 'Ya está al día',
    title: 'Ya tiene la tabla con el nombre de destino y no la de origen: no hay nada que hacer.',
    blocking: false,
  },
  // Antes de `already` este valor significaba «ya existe el destino», y ese caso ahora es el de
  // arriba, que NO bloquea. `conflict` quedó para cuando CONVIVEN las dos tablas: el gateway no
  // puede saber cuál de las dos es el puntero bueno, y elegir una por él es la auto-corrección
  // que el backend rechaza por principio.
  conflict: {
    tone: 'error',
    label: 'Conviven las dos tablas',
    title:
      'Esta base tiene a la vez la tabla de origen y la de destino, y no se puede decidir cuál es el puntero bueno. Se aborta la operación entera.',
    blocking: true,
  },
  // `warning` y no `error` a propósito: es **fail-closed**, no un conflicto probado. El gateway no
  // dice «en esta base conviven las dos tablas», dice «no pude leerla» — y afirmar lo primero
  // mandaría al operador a buscar una tabla que quizá no existe. Bloquea igual, y por
  // eso tampoco es `neutral`: un blocker pintado como dato inocuo no se lee.
  unreachable: {
    tone: 'warning',
    label: 'No se pudo leer',
    title:
      'No se pudo consultar esta base, así que no se sabe qué tablas tiene. Bloquea por prudencia, no por conflicto confirmado.',
    blocking: true,
  },
}

/**
 * Valor fuera del enum. **Bloquea**, que es el único default seguro: si el backend añade una quinta
 * acción, tratarla como inocua la dejaría pasar sin que nadie la lea. Pasa de verdad porque las
 * filas de los `public_context` NO están validadas por Zod (`ApiRenameSlugDatabase.action` es
 * `string`), así que este módulo recibe `string` y no el enum.
 */
const UNKNOWN: RenameSlugBadgeSpec = {
  tone: 'warning',
  label: 'Acción desconocida',
  title:
    'El gateway devolvió una acción que esta versión de la interfaz no conoce. Se trata como bloqueante: revisá el informe de contabilidad antes de seguir.',
  blocking: true,
}

/** La insignia de una acción del plan. Acepta `string` porque las filas de error no pasan por Zod. */
export function renameSlugBadge(action: string): RenameSlugBadgeSpec {
  return SPECS[action as RenameSlugAction] ?? UNKNOWN
}

/** ¿Esta acción aborta la operación entera? Atajo sobre `renameSlugBadge`, misma fuente. */
export function renameSlugBlocks(action: string): boolean {
  return renameSlugBadge(action).blocking
}

/**
 * Las filas con los bloqueantes PRIMERO, conservando el orden del backend dentro de cada grupo.
 *
 * Vive acá y no en el componente porque es parte de la misma regla: quien decide qué bloquea
 * decide qué se lee primero. Con la tabla ordenada por el backend, los dos motivos de abandonar la
 * operación pueden quedar en la fila 30 de un parque grande, debajo de veintinueve «se renombra»
 * que no obligan a hacer nada.
 *
 * No muta la entrada: `sort` se aplica sobre una copia.
 */
export function sortBlockersFirst<T extends { action: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftBlocks = renameSlugBlocks(left.action) ? 0 : 1
    const rightBlocks = renameSlugBlocks(right.action) ? 0 : 1
    return leftBlocks - rightBlocks
  })
}
