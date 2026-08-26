/**
 * Vocabulario CERRADO de códigos del módulo de conversión de collation (contrato v17 §5).
 *
 * Los textos salen del contrato tal cual: están redactados ahí a propósito, para que el backend y
 * la UI no diverjan en cómo se le explica lo mismo al operador. **No inventar copy acá.**
 *
 * SUPERSEDE una regla de `api-reference-v8.md` §3.0, que decía que este módulo no usaba
 * `public_context` y que nunca había que leer `detail.context`. Los rechazos nuevos sí traen
 * `public_context.code`. El parser no se toca: `errors.ts` ya lo extrae a `ApiError.code` de
 * forma genérica — lo que había que cambiar era *leerlo*.
 *
 * DOS CANALES, y conviene no confundirlos (mismo reparto que `environments/messages.ts`):
 *
 * 1. Los **422/409** llegan como `ApiError` y su código sale de `detail.public_context.code`.
 * 2. El **`execute` de un lote responde 200** con los ítems rechazados adentro: ahí el código
 *    viaja en `results[].error_code`, dentro del cuerpo de éxito, y ningún extractor de
 *    `errors.ts` lo toca. Para eso está `classifyBatchItem`.
 */

/** Los 14 códigos que el backend emite para este módulo. Vocabulario cerrado. */
export const COLLATION_ERROR_CODES = [
  'collation.scope_not_allowed',
  'collation.batch_no_eligible_databases',
  'collation.batch_database_set_mismatch',
  'collation.batch_confirmation_required',
  'collation.batch_not_pending',
  'collation.engine_not_applicable',
  'collation.version_batch_not_complete',
  'collation.version_blueprint_has_other_engines',
  'collation.version_databases_missing_from_batch',
  'collation.version_not_at_head',
  'collation.version_table_sets_differ',
  'collation.version_partial_selection',
  'collation.version_too_large',
  'collation.version_quarantined_before_batch',
] as const
export type CollationErrorCode = (typeof COLLATION_ERROR_CODES)[number]

const MESSAGES: Record<CollationErrorCode, string> = {
  'collation.scope_not_allowed':
    'Esa base es la propia base de metadatos del gateway: no se puede convertir.',
  'collation.batch_no_eligible_databases':
    'El blueprint no tiene ninguna base activa que se pueda convertir.',
  'collation.batch_database_set_mismatch':
    'El conjunto de bases cambió desde que se planificó. Volvé a planificar el lote.',
  'collation.batch_confirmation_required':
    'Escribí el nombre exacto de las bases de entorno protegido para confirmar.',
  'collation.batch_not_pending': 'Este lote ya se ejecutó o se canceló.',
  'collation.engine_not_applicable': 'El objetivo pedido no aplica a este motor.',
  'collation.version_batch_not_complete': 'El lote no terminó bien en todas sus bases.',
  'collation.version_blueprint_has_other_engines':
    'El blueprint tiene bases de otro motor: este SQL no aplica.',
  'collation.version_databases_missing_from_batch':
    'Hay bases activas que no participaron del lote.',
  'collation.version_not_at_head':
    'Alguna base no está en la última versión del blueprint. Aplicá las pendientes primero.',
  'collation.version_table_sets_differ':
    'Las bases no tienen el mismo conjunto de tablas: hay deriva estructural que resolver antes.',
  'collation.version_partial_selection':
    'Alguna base convirtió solo parte de sus tablas: no se puede versionar una conversión parcial.',
  'collation.version_too_large': 'El SQL de la versión supera el tope de tamaño.',
  'collation.version_quarantined_before_batch':
    'Alguna base está en cuarentena: revisala antes de versionar.',
}

/** Traduce un código, o `null` si no es de este módulo (o si no viene ninguno). */
export function collationMessage(code: string | null | undefined): string | null {
  if (!code) return null
  return MESSAGES[code as CollationErrorCode] ?? null
}

/**
 * Cómo se pinta el resultado de UNA BD dentro de un lote (plan o execute).
 *
 * Tres estados, no dos, y la elección de tono es lo importante: **`not_applicable` va en
 * `warning`, no en `error`**. Una BD PostgreSQL dentro de un lote con `target_charset` no está
 * rota — el objetivo simplemente no le aplica, y el backend la saca del lote sin abortarlo. En
 * esta app el rojo significa "esto está roto"; pintar de rojo una decisión correcta del sistema
 * obliga a leer N frases para saber cuáles necesitan acción.
 *
 * DIRECCIÓN DEL FALLBACK: un ítem con `ok: false` y SIN `error_code` —o con uno que este mapa no
 * conoce— cae en **`failed`**, nunca en `not_applicable`. Ante la duda, la lectura más grave:
 * decir "no aplicaba" sobre algo que en realidad falló sería peor que lo contrario. Es el mismo
 * criterio, y por el mismo motivo, que `classifyItem` de `environments/messages.ts`.
 */
export type BatchItemOutcome = 'ok' | 'not_applicable' | 'failed'

export function classifyBatchItem(item: { ok: boolean; error_code?: string | null }): BatchItemOutcome {
  if (item.ok) return 'ok'
  return item.error_code === 'collation.engine_not_applicable' ? 'not_applicable' : 'failed'
}

export const BATCH_ITEM_LABEL: Record<BatchItemOutcome, string> = {
  ok: 'Lista',
  not_applicable: 'No aplica',
  failed: 'Error',
}

export const BATCH_ITEM_TONE: Record<BatchItemOutcome, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  not_applicable: 'warning',
  failed: 'error',
}

/**
 * Etiqueta de una BD en el resultado del lote.
 *
 * No es cosmético: React renderiza `null`/`undefined` como vacío sin que TypeScript avise
 * (`ReactNode` los acepta), y una fila fallada **sin nombre es inaccionable**. El id siempre
 * viene. Mismo criterio que `databaseLabel` de `environments/messages.ts`.
 */
export function batchDatabaseLabel(item: {
  managed_database_id: number
  database_name?: string | null
}): string {
  return item.database_name ?? `#${item.managed_database_id}`
}
