/**
 * Captura de resultados de SELECT: qué versiones la tienen y en qué estado.
 *
 * Lógica pura y sin React, por el mismo motivo que `version-nav.ts`: es lo que decide qué se le
 * dice al admin antes de ejecutar algo que va a extraer filas de una base ajena.
 *
 * **Existe porque el predicado divergió.** Había dos, uno por pantalla: la ficha de la BD usaba
 * `capture_selects && reviewed` (estricto) y el diálogo del lote `capture_selects && reviewed !==
 * false` (laxo). Con el estricto, un backend que no devuelve `reviewed` en el resumen —el campo
 * es opcional en el contrato— hacía que el aviso **no apareciera nunca**. Que dos pantallas
 * escriban a mano el mismo criterio es cómo se llegó ahí; por eso vive en un solo lugar.
 */

/** Lo mínimo que hace falta; encaja con `ModelMigrationSummary` sin acoplarse a él. */
export interface CaptureVersionLike {
  version: string
  capture_selects?: boolean
  reviewed?: boolean
}

/** Código estable del 409 que frena una corrida por captura sin revisar (backend v13 §2). */
export const CAPTURE_UNREVIEWED_CODE = 'migration.capture_unreviewed'

/** Código estable del 409 equivalente en `stamp`, donde `force` SÍ es un escape legítimo. */
export const CAPTURE_UNREVIEWED_STAMP_CODE = 'migration.capture_unreviewed_stamp'

export interface CaptureSplit {
  /** Versiones que van a CAPTURAR. Es lo que se anuncia. */
  willCapture: string[]
  /** Versiones que el backend va a RECHAZAR con 409 por no estar revisadas. */
  blockedByReview: string[]
}

/**
 * Parte las versiones en los dos cubos que la UI necesita, que **no son el mismo predicado con
 * el borde cambiado**: son complementarios y por eso ninguno se puede "arreglar" solo.
 *
 * - `willCapture` usa el criterio LAXO (`reviewed !== false`): es un **aviso**, así que ante un
 *   `reviewed` ausente la dirección segura es informar de más, no ocultar.
 * - `blockedByReview` usa el criterio ESTRICTO (`reviewed === false`): describe un rechazo
 *   concreto del backend, y afirmarlo sin que el servidor lo diga sería inventar un bloqueo.
 *
 * Son disjuntos y su unión es todas las versiones con `capture_selects`, así que ninguna se cae
 * entre los dos. Ese invariante es lo que impide que el borde vuelva a divergir.
 *
 * `only` acota a un subconjunto —las versiones realmente PENDIENTES de esa BD—. Sin él, el aviso
 * salía por cualquier versión del blueprint aunque esa base ya la tuviera aplicada, y un aviso
 * que sale siempre deja de leerse.
 */
export function splitCaptureVersions(
  items: readonly CaptureVersionLike[],
  options: { only?: readonly string[] } = {},
): CaptureSplit {
  const scope = options.only ? new Set(options.only) : null
  const willCapture: string[] = []
  const blockedByReview: string[] = []
  for (const item of items) {
    if (item.capture_selects !== true) continue
    if (scope !== null && !scope.has(item.version)) continue
    if (item.reviewed === false) blockedByReview.push(item.version)
    else willCapture.push(item.version)
  }
  return { willCapture, blockedByReview }
}

/**
 * Texto del rechazo por captura sin revisar dentro de un lote.
 *
 * Función y no JSX inline para poder testear el mensaje sin montar el modal — mismo criterio que
 * `describeItemRejection` en `features/environments/messages.ts`. Lo primero que dice es que **no
 * se ejecutó nada**: en un apply masivo, un ítem en rojo se lee como «rompió algo».
 */
export function describeCaptureRejection(versions: readonly string[]): string {
  const lista = versions.length > 0 ? ` (${versions.join(', ')})` : ''
  return (
    `No se intentó: no se ejecutó ningún DDL en esta base. Hay versiones con captura de ` +
    `SELECT sin aprobar${lista}. Revisá qué consultan y aprobalas en la tabla de versiones ` +
    `antes de reintentar.`
  )
}
