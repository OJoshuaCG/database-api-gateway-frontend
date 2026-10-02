import type { ApiError } from '@/lib/api/errors'
import { DATABASE_MODEL_ERROR_CODES } from '@/lib/contracts'

/**
 * Cuántos nombres se listan antes de resumir el resto en «y N más». Un blueprint puede tener
 * decenas de bases y el backend las manda todas; el mensaje tiene que leerse de un vistazo.
 */
export const MODEL_IN_USE_NAME_LIMIT = 5

/**
 * Texto FIJO del 409 `database_model.in_use` al borrar un blueprint, o `null` si el error es otro.
 *
 * Se clasifica por `public_context.code` y nunca por el `message` del backend: ese texto puede
 * cambiar, y el de acá nombra las bases y dice qué hacer con ellas. El conteo sale de
 * `managed_database_count` (el total real) y, si falta, de las filas recibidas.
 */
export function modelInUseText(error: ApiError): string | null {
  if (error.code !== DATABASE_MODEL_ERROR_CODES.inUse) return null
  const context = error.databaseModelContext
  const rows = context?.inUseDatabases ?? []
  // El total real; las filas recibidas son el piso por si el conteo no llegó o vino corto.
  const total = Math.max(context?.managedDatabaseCount ?? 0, rows.length)

  const fix = total <= 1 ? 'Desasociala o eliminala primero.' : 'Desasocialas o eliminalas primero.'
  if (total === 0) return `No se puede eliminar: lo usa al menos una base gestionada. ${fix}`
  if (rows.length === 0) {
    const usage = total === 1 ? 'usa 1 base gestionada' : `usan ${total} bases gestionadas`
    return `No se puede eliminar: lo ${usage}. ${fix}`
  }

  const shown = rows.slice(0, MODEL_IN_USE_NAME_LIMIT).map((row) => `«${row.name}»`)
  const rest = total - shown.length
  const names =
    rest > 0
      ? `${shown.join(', ')} y ${rest} más`
      : shown.length === 1
        ? shown[0]
        : `${shown.slice(0, -1).join(', ')} y ${shown[shown.length - 1]}`

  return total === 1
    ? `No se puede eliminar: lo usa la base gestionada ${names}. ${fix}`
    : `No se puede eliminar: lo usan ${total} bases gestionadas: ${names}. ${fix}`
}
