/**
 * Ordenación y navegación del catálogo de versiones de un blueprint.
 *
 * Lógica pura y sin React para poder testearla: es la que decide qué versión ve el admin al
 * entrar, y equivocarse ahí significa mostrarle un delta viejo como si fuera el estado actual.
 */

/** Lo mínimo que necesita la navegación; encaja con `ModelMigrationSummary` sin acoplarse a él. */
export interface VersionLike {
  version: string
}

/**
 * Ordena ascendente por valor NUMÉRICO de la versión (§8), no lexicográfico.
 *
 * El orden numérico importa porque el backend no garantiza en qué orden devuelve la lista y las
 * versiones son dígitos de ancho variable: `'10'` es posterior a `'9'` aunque ordene antes como
 * texto. Se ordena ascendente porque las migraciones son una secuencia de pasos y `apply` las
 * recorre en ese mismo sentido.
 *
 * Empates y valores no numéricos conservan su orden relativo de entrada (el sort de JS es
 * estable), así que una versión con formato inesperado no desordena al resto.
 */
export function sortVersionsAscending<T extends VersionLike>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const left = Number(a.version)
    const right = Number(b.version)
    if (Number.isNaN(left) || Number.isNaN(right)) return 0
    return left - right
  })
}

/**
 * Índice de la versión que hay que mostrar dentro de una lista YA ordenada.
 *
 * Sin selección explícita —o si la elegida desapareció, p. ej. al borrar la punta— cae en la
 * ÚLTIMA, que es la más reciente. Antes caía en `items[0]`, que con la lista ascendente es la
 * más antigua: el admin entraba viendo `0001` en vez del estado actual del blueprint.
 *
 * Devuelve `-1` con la lista vacía.
 */
export function resolveVersionIndex(
  sorted: readonly VersionLike[],
  selectedVersion: string | null,
): number {
  if (sorted.length === 0) return -1
  if (selectedVersion === null) return sorted.length - 1
  const index = sorted.findIndex((item) => item.version === selectedVersion)
  return index === -1 ? sorted.length - 1 : index
}

/** Versión punta (la de mayor número): la única que el backend deja eliminar. */
export function latestVersionOf(sorted: readonly VersionLike[]): string | null {
  return sorted.at(-1)?.version ?? null
}

export interface VersionNeighbors {
  /** Versión inmediatamente anterior, o `null` si ya está en la primera. */
  previous: string | null
  /** Versión inmediatamente posterior, o `null` si ya está en la punta. */
  next: string | null
  /** Posición 1-based para el indicador «N de M». */
  position: number
  total: number
  isLatest: boolean
}

/** Vecinos de la versión actual, para habilitar o no las flechas de navegación. */
export function versionNeighbors(
  sorted: readonly VersionLike[],
  index: number,
): VersionNeighbors {
  const total = sorted.length
  if (index < 0 || total === 0) {
    return { previous: null, next: null, position: 0, total, isLatest: false }
  }
  return {
    previous: index > 0 ? (sorted[index - 1]?.version ?? null) : null,
    next: index < total - 1 ? (sorted[index + 1]?.version ?? null) : null,
    position: index + 1,
    total,
    isLatest: index === total - 1,
  }
}
