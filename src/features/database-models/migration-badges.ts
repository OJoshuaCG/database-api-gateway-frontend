import type { BadgeTone } from '@/components/ui'

/**
 * Vocabulario ÚNICO de las insignias de una versión de blueprint.
 *
 * **Existe porque divergió.** Había tres juegos escritos a mano: el `renderItem` del `Combobox` en
 * `VersionNavigator` (7 insignias), la fila de la desaparecida `VersionsTable` (8) y el «card
 * delgado» del `ModelMigrationDetailPanel` (5). El desplegable —el único índice de versiones desde
 * que la tabla se fue— era justamente el que **no** pintaba `no portable`, `SQL congelado`,
 * `SQL editado tras aplicarse` ni `sin rollback`, que son los cuatro de más consecuencia.
 *
 * Lógica pura y sin React, mismo criterio que `version-nav.ts` y `capture.ts`: lo que se le dice al
 * admin sobre una versión antes de aplicarla o borrarla se testea sin montar nada.
 */

/** Lo mínimo que necesita el juego de insignias; encaja con `ModelMigrationSummary` sin acoplarse. */
export interface MigrationBadgeFacts {
  is_baseline?: boolean
  has_non_portable?: boolean
  reviewed?: boolean
  capture_selects?: boolean
  has_rollback?: boolean
  has_seed?: boolean
  forced_collations?: string[]
  destructive?: boolean
  sql_diverged?: boolean
  sql_frozen?: boolean
}

export interface MigrationBadgeSpec {
  key: string
  tone: BadgeTone
  /** Emoji decorativo. Se renderiza en `aria-hidden`: el texto de al lado lleva la información. */
  icon?: string
  /** Texto completo, el de la ficha. */
  label: string
  /** Texto abreviado para el desplegable, donde la fila compite con el nombre de la versión. */
  short?: string
  title?: string
}

/** Densidad de la presentación. `compact` = item del desplegable; `full` = ficha de la versión. */
export type MigrationBadgeDensity = 'compact' | 'full'

export function migrationBadgeSpecs(
  migration: MigrationBadgeFacts,
  sourceEngine?: string | null,
): MigrationBadgeSpec[] {
  const specs: MigrationBadgeSpec[] = []

  if (migration.is_baseline) {
    specs.push({
      key: 'baseline',
      tone: 'info',
      label: 'baseline',
      title: 'Punto de partida del blueprint, no un delta sobre la versión anterior.',
    })
  }

  if (migration.has_non_portable) {
    specs.push({
      key: 'non-portable',
      tone: 'warning',
      icon: '🔒',
      label: `no portable${sourceEngine ? ` (${sourceEngine})` : ''}`,
      short: 'no portable',
      title: 'Tiene SQL específico de un motor: no se puede traducir al contrario.',
    })
  }

  if (migration.has_seed) {
    specs.push({
      key: 'seed',
      tone: 'info',
      icon: '🌱',
      label: 'siembra',
      title: 'Inserta o modifica datos, no solo estructura.',
    })
  }

  const collations = migration.forced_collations ?? []
  if (collations.length > 0) {
    specs.push({
      key: 'collate',
      tone: 'warning',
      icon: '⚑',
      // En `full` se listan: es el dato que permite compararlos con el collation del blueprint sin
      // abrir el SQL.
      label: `collate: ${collations.join(', ')}`,
      short: 'collate',
      title: `COLLATE forzado en el SQL: ${collations.join(', ')}`,
    })
  }

  if (migration.destructive) {
    specs.push({
      key: 'destructive',
      tone: 'error',
      icon: '⚠',
      label: 'destructiva',
      title: 'Contiene DROP o TRUNCATE.',
    })
  }

  // Captura y revisión son el MISMO eje, no dos. Una versión con captura sin revisar no se puede
  // aplicar (409); anunciar «captura» y «sin revisar» como dos insignias deja al operador juntando
  // dos etiquetas para deducir una sola consecuencia.
  if (migration.capture_selects) {
    specs.push(
      migration.reviewed === false
        ? {
            key: 'capture',
            tone: 'warning',
            icon: '⚠️',
            label: 'captura sin revisar',
            short: 'captura ⚠',
            title:
              'Guarda el resultado de sus SELECT en el gateway y todavía no se aprobó: el apply, el rollback y el stamp responden 409.',
          }
        : {
            key: 'capture',
            tone: 'info',
            icon: '🔒',
            label: 'captura aprobada',
            short: 'captura',
            title: 'Guarda el resultado de sus SELECT en el gateway.',
          },
    )
  } else if (migration.reviewed === false) {
    specs.push({
      key: 'unreviewed',
      tone: 'warning',
      icon: '⚠',
      label: 'sin revisar',
      title: 'No se puede aplicar a ninguna BD hasta aprobarla (el backend responde 409).',
    })
  }

  // El NEGATIVO también se pinta, y es el cambio que más importa de este archivo: un rollback que
  // atraviese una versión sin `down_sql` falla con 409 para TODO el camino, y eso solo se veía en
  // la tabla que se eliminó. La AUSENCIA de la insignia verde no es un aviso.
  specs.push(
    migration.has_rollback
      ? {
          key: 'rollback',
          tone: 'success',
          icon: '↩',
          label: 'rollback',
          title: 'Tiene down_sql confirmado.',
        }
      : {
          key: 'no-rollback',
          tone: 'warning',
          icon: '↩',
          label: 'sin rollback',
          title:
            'Sin down_sql confirmado: cualquier rollback que atraviese esta versión falla con 409.',
        },
  )

  if (migration.sql_diverged) {
    specs.push({
      key: 'diverged',
      tone: 'warning',
      icon: '⚠',
      label: 'SQL editado tras aplicarse',
      short: 'SQL editado',
      title:
        'El SQL se editó después de que alguna base la aplicara: esas bases conservan el esquema anterior.',
    })
  }

  if (migration.sql_frozen) {
    specs.push({
      key: 'frozen',
      tone: 'neutral',
      label: 'SQL congelado',
      short: 'congelado',
      title: 'Editar el SQL base pide confirmación explícita.',
    })
  }

  return specs
}

/** El texto que se muestra según la densidad. Uno solo, para que las dos vistas no se separen. */
export function migrationBadgeText(
  spec: MigrationBadgeSpec,
  density: MigrationBadgeDensity,
): string {
  return density === 'compact' ? (spec.short ?? spec.label) : spec.label
}

/**
 * Las mismas insignias en texto plano, para el `aria-live` del navegador de versiones.
 *
 * Existe porque esa región anunciaba «3 de 12» y nada más: quien navega con lector de pantalla
 * pulsaba la flecha y no se enteraba ni de qué versión ni de en qué estado estaba. Y **no** se
 * arregla con una segunda región live en la ficha: dos regiones que cambian a la vez se pisan y
 * solo se oye una.
 */
export function describeMigrationBadges(
  migration: MigrationBadgeFacts,
  sourceEngine?: string | null,
): string[] {
  return migrationBadgeSpecs(migration, sourceEngine).map((spec) => spec.label)
}
