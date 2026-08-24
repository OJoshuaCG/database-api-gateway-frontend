import { z } from 'zod'

/**
 * Entornos de despliegue: clasifican cada BD gestionada y llevan la política que el backend
 * hace cumplir. Solo LECTURA — los entornos son un conjunto fijo de cuatro (`local`,
 * `development`, `staging`, `production`) y la administración es por API a propósito, así que
 * acá no hay schemas de create/update (ver `docs/api-coverage.md`, filas ⛔).
 *
 * NO CONFUNDIR con el campo `environment` de `contracts/health.ts`: ese es el `APP_ENV` del
 * PROCESO del gateway (modo de despliegue), no la clasificación de una base de datos. Los dos
 * usan los valores `development`/`production` para cosas distintas.
 */

/**
 * Colores admitidos. Coinciden valor por valor con `BadgeTone` de `components/ui/Badge`, y esa
 * coincidencia se afirma UNA sola vez, en `EnvironmentBadge` (`const tone: BadgeTone = ...`).
 * Deliberadamente NO se deriva un lado del otro: derivar el enum desde `BadgeTone` le daría a
 * `components/ui` autoridad sobre la validación del contrato, y derivar `BadgeTone` desde el
 * enum invertiría las capas (la UI compartida dependiendo del contrato de un dominio).
 */
export const ENVIRONMENT_COLORS = [
  'neutral',
  'primary',
  'success',
  'error',
  'warning',
  'info',
] as const
export const environmentColorSchema = z.enum(ENVIRONMENT_COLORS)
export type EnvironmentColor = z.infer<typeof environmentColorSchema>

/**
 * `EnvironmentOut`. Dos decisiones de nulabilidad que NO son cosméticas:
 *
 * - `color` va `.nullable().catch(null)`. El backend lo tipa `str | None` y el PATCH documenta
 *   que enviar null lo limpia, así que un color limpiado con un enum estricto **descartaría el
 *   listado entero** (`apiRequest` hace `safeParse` del envelope completo). Y el día que el
 *   backend agregue un séptimo color, un `z.enum` duro no deja "un badge sin estilo": rechaza la
 *   respuesta y desaparecen todos los badges y el filtro. El `.catch(null)` degrada a badge
 *   neutro, que es la dirección correcta — el color es decoración; el nombre y la política no.
 * - `blocks_destructive_migrations` **es el significado de la etiqueta**, no un extra. Sin él la
 *   UI no puede avisar "esto va a producción y las destructivas están bloqueadas" antes de
 *   disparar un apply, y el operador infiere —mal— que `staging` también protege.
 *
 * REGLA: la UI nunca hardcodea "production bloquea". La política es un dato que se cambia por
 * API sin desplegar; todo texto sale del flag.
 */
export const environmentOutSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  /** Orden de promoción: menor = más temprano. NO es único; el desempate es por `id`. */
  rank: z.number().int(),
  color: environmentColorSchema.nullable().catch(null),
  is_default: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
  blocks_destructive_migrations: z.boolean().optional().default(false),
  /** BDs asignadas. El borrado por API lo exige en cero, y alimenta el aviso de la UI. */
  database_count: z.number().int().optional().default(0),
  created_at: z.string(),
  updated_at: z.string(),
})
export type EnvironmentOut = z.infer<typeof environmentOutSchema>

/** Orden total de promoción: `(rank, id)`. `rank` no es único, así que el desempate importa. */
export function compareEnvironments(a: EnvironmentOut, b: EnvironmentOut): number {
  return a.rank - b.rank || a.id - b.id
}
