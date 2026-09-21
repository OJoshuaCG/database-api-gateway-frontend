import type { BadgeTone } from '@/components/ui'

/**
 * Vocabulario ÚNICO de las insignias del historial de migraciones de una base gestionada.
 *
 * **Existe porque el historial era la última superficie de enum del módulo que NO pasaba por un
 * badge derivado**: pintaba un ternario en línea (`status === 'applied' ? 'success' : 'error'`) y
 * escupía el valor crudo en inglés —`applied` / `failed`— mientras el resto del módulo ya hablaba
 * en español desde `migration-badges.ts`.
 *
 * Y con v25 dejó de ser cosmético. El historial ganó cuatro dimensiones que se leen mal si se
 * improvisan fila a fila:
 *
 * - `direction` distingue apply de rollback, que **antes eran indistinguibles** (los dos escribían
 *   `status: "applied"`). Su `null` no es «arriba por defecto»: es «no sabemos si esto sigue
 *   vigente», y traducirlo a «Aplicada» devuelve la UI al estado anterior al incidente.
 * - `model_migration_id` puede venir en `null` porque la FK pasó a `ON DELETE SET NULL`: el evento
 *   sobrevive al borrado de la versión.
 * - `version` puede no poder determinarse.
 * - el actor puede no estar registrado.
 *
 * Lógica pura y sin React, mismo criterio que `migration-badges.ts`: lo que se le dice al admin
 * sobre lo que ya le pasó a una base se testea sin montar nada.
 */

/** Lo mínimo que necesita el vocabulario; encaja con `MigrationHistoryItem` sin acoplarse a él. */
export interface HistoryBadgeFacts {
  status: 'applied' | 'failed'
  direction?: 'up' | 'down' | null
  version?: string | null
  model_migration_id?: number | null
  actor_type?: string | null
  actor_id?: number | null
  actor_username?: string | null
}

export interface HistoryBadgeSpec {
  key: string
  tone: BadgeTone
  /** Emoji decorativo. Se renderiza en `aria-hidden`: el texto de al lado lleva la información. */
  icon?: string
  label: string
  /** Texto abreviado para donde la insignia compite con otro dato en la misma celda. */
  short?: string
  title?: string
}

/**
 * Resultado del intento, no su sentido.
 *
 * Se dice «Exitosa» / «Fallida» —y no «Aplicada» / «Falló»— a propósito: «Aplicada» ya es la
 * etiqueta de la DIRECCIÓN, y un rollback correcto tiene `status: 'applied'` con
 * `direction: 'down'`. Reutilizar la palabra en las dos columnas obliga a leer las dos juntas
 * para saber qué pasó, que es exactamente el error que v25 vino a cerrar.
 */
export function historyStatusSpec(status: HistoryBadgeFacts['status']): HistoryBadgeSpec {
  return status === 'applied'
    ? {
        key: 'ok',
        tone: 'success',
        label: 'Exitosa',
        title: 'La operación terminó sin error en el motor.',
      }
    : {
        key: 'failed',
        tone: 'error',
        label: 'Fallida',
        title: 'La operación falló en el motor. El detalle del evento trae el error completo.',
      }
}

/**
 * Sentido del evento: `up` = apply, `down` = rollback.
 *
 * 🔴 El `null` tiene insignia PROPIA y visible, no se infiere ni se deja en blanco. Todo el
 * historial previo a v25 lo trae así, y ahí un evento «Exitosa» **no prueba** que la versión siga
 * vigente: pudo ser el apply o su rollback. Un hueco en la celda se lee como «no aplica»; «Sin
 * registrar» se lee como lo que es, un dato que falta.
 */
export function historyDirectionSpec(direction: HistoryBadgeFacts['direction']): HistoryBadgeSpec {
  if (direction === 'up') {
    return {
      key: 'up',
      tone: 'info',
      icon: '↑',
      label: 'Aplicada',
      title: 'Se aplicó la versión (apply).',
    }
  }
  if (direction === 'down') {
    return {
      key: 'down',
      tone: 'warning',
      icon: '↩',
      label: 'Revertida',
      title: 'Se revirtió la versión (rollback): el esquema volvió atrás.',
    }
  }
  return {
    key: 'unknown',
    tone: 'neutral',
    label: 'Sin registrar',
    title:
      'Este evento es anterior a que el gateway registrara la dirección: no se puede saber si fue una aplicación o una reversión, así que «Exitosa» no prueba que la versión siga vigente.',
  }
}

/** Cómo se presenta la versión de un evento, con sus dos formas de estar incompleta. */
export interface HistoryVersionSpec {
  /** Texto de la versión, o «—» si no se pudo determinar. */
  text: string
  /** Insignia de versión huérfana, si la FK al catálogo quedó en `null`. */
  badge: HistoryBadgeSpec | null
  /** Nota al pie de la celda que explica qué falta y por qué. */
  note: string | null
  /**
   * ¿Se puede enlazar al detalle de la versión en el blueprint? `false` cuando la versión ya no
   * existe en el catálogo: no hay a dónde ir, y un enlace roto es peor que ninguno.
   */
  linkable: boolean
}

/**
 * 🔴 La fila **no** se oculta ni se atenúa cuando la versión se borró del blueprint.
 *
 * Con la FK en `null`, `version` y `applied_checksum` son lo único que queda del evento: es
 * justamente la fila que hay que poder leer para reconstruir qué corrió en esta base. Lo que se
 * omite es el enlace al catálogo, porque el destino ya no existe.
 */
export function historyVersionSpec(facts: HistoryBadgeFacts): HistoryVersionSpec {
  const orphan = facts.model_migration_id == null
  const version = facts.version ?? null

  return {
    text: version ?? '—',
    badge: orphan
      ? {
          key: 'orphan-version',
          tone: 'warning',
          label: 'Versión borrada del blueprint',
          short: 'Versión borrada',
          title: 'El evento sobrevive; la versión ya no existe en el catálogo.',
        }
      : null,
    note:
      version === null
        ? 'La versión de este evento no se pudo determinar'
        : orphan
          ? 'El evento sobrevive; la versión ya no existe en el catálogo.'
          : null,
    linkable: !orphan && version !== null,
  }
}

/**
 * Quién disparó el evento.
 *
 * El historial previo a v25 no registraba actor, así que las tres columnas pueden venir vacías —y
 * también a medias: un `actor_type` sin `actor_id` sigue diciendo algo («agent», «admin»), y
 * tirarlo por no poder componer `tipo#id` pierde información que sí está.
 */
export function historyActorLabel(facts: HistoryBadgeFacts): string {
  if (facts.actor_username) return facts.actor_username
  if (facts.actor_type && facts.actor_id != null) return `${facts.actor_type}#${facts.actor_id}`
  if (facts.actor_type) return facts.actor_type
  if (facts.actor_id != null) return `#${facts.actor_id}`
  return '—'
}

/**
 * ¿Hay al menos un evento sin dirección registrada?
 *
 * Decide el aviso de cabecera de la tabla. Va arriba y una sola vez —no repetido en cada fila—
 * porque la consecuencia es de lectura global: mientras haya filas sin dirección, el historial
 * entero deja de ser prueba de vigencia.
 */
export function hasUnknownDirection(items: readonly HistoryBadgeFacts[]): boolean {
  return items.some((item) => (item.direction ?? null) === null)
}
