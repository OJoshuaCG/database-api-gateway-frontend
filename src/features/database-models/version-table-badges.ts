import type { BadgeTone } from '@/components/ui'
import type { VersionTableStatus } from '@/lib/contracts'

/**
 * Vocabulario ÚNICO del enum de cinco estados de `/version-tables` (api-reference-v25 §3.4).
 *
 * Mismo criterio que `migration-badges.ts`, y por el mismo motivo: allí hubo tres juegos de
 * insignias escritos a mano que divergieron, y el que más se usaba era justo el que omitía los
 * avisos de más consecuencia. Este enum entra a la UI por tres sitios a la vez —la tira de
 * contadores del `summary`, la columna «Estado» de la tabla y el semáforo de `needs_attention`—,
 * así que el nombre, el tono y el porqué de cada estado se deciden UNA vez, acá, y sin React:
 * lo que se le dice al admin sobre la contabilidad de una base se testea sin montar nada.
 *
 * 🔴 **Las dos trampas de este enum**, que son las que deciden los tonos de abajo:
 *
 * 1. **`none` NO es un problema.** Es el estado normal de una base que nunca fue posicionada:
 *    no hay tabla de versión porque nunca se aplicó ni se stampeó nada. Pintarlo en ámbar hace
 *    que el informe grite en blueprints perfectamente sanos, y un informe que grita siempre deja
 *    de leerse — que es exactamente perder la señal de `orphaned`, la única que importa.
 * 2. **`unreachable` NO es «está bien».** Es INDETERMINADO: el motor no respondió, así que no se
 *    sabe qué contabilidad tiene esa base. No se agrupa con `ok`, no se cuenta como resuelta en
 *    ningún contador de «bases sanas» (ver `isHealthyVersionTable`) y no se le ofrece acción.
 *    `needs_attention` tampoco lo cuenta, de modo que un informe puede venir `false` con tres
 *    bases sin leer: verde en el semáforo no significa verde en el parque.
 */

export interface VersionTableBadgeSpec {
  key: VersionTableStatus
  tone: BadgeTone
  /** Texto de la insignia. Es el nombre del estado en toda la UI: no se reescribe en el render. */
  label: string
  /**
   * Glifo decorativo, con el mismo criterio que `migration-badges.ts`: se renderiza
   * `aria-hidden` porque la información la lleva el `label` de al lado.
   *
   * Solo lo usa `unreachable`, y por un motivo concreto: comparte `tone: 'neutral'` con `none`
   * —los dos son ausencia de alarma— pero sus consecuencias son opuestas, así que en un escaneo
   * rápido por color se confunden justo los dos estados que no hay que confundir.
   */
  icon?: string
  /** La consecuencia, no la definición: qué implica ese estado para quien va a operar. */
  title: string
}

const SPECS: Record<VersionTableStatus, VersionTableBadgeSpec> = {
  ok: {
    key: 'ok',
    tone: 'success',
    label: 'Correcta',
    title:
      'Solo está la tabla que el gateway busca. Su versión es la que manda y no hay nada que hacer.',
  },
  orphaned: {
    key: 'orphaned',
    tone: 'error',
    label: 'Fuera de sitio',
    title:
      'La tabla que el gateway busca NO existe, pero sí hay otra con la contabilidad dentro. Mientras siga así el estado de migraciones de esta base no es de fiar, y aplicar reejecutaría migraciones ya aplicadas.',
  },
  mixed: {
    key: 'mixed',
    tone: 'warning',
    label: 'Correcta + residuo',
    title:
      'El puntero es correcto —el gateway lee la tabla que espera—, pero sobra al menos una tabla de un renombrado o una recuperación a medias. No bloquea, aunque conviene resolverlo antes de que confunda al siguiente.',
  },
  none: {
    key: 'none',
    tone: 'neutral',
    label: 'Sin posicionar',
    title:
      'No hay ninguna tabla de versión. Es lo NORMAL en una base que nunca fue posicionada: no es un problema.',
  },
  /*
   * Comparte `tone: 'neutral'` con `none`, y ese empate es deliberado pero NO puede quedar solo
   * en el color: son los dos estados de consecuencia opuesta —`none` es «esto está bien»,
   * `unreachable` es «esto no lo sabemos»— y pintados idénticos el neutro deja de codificar
   * nada. El glifo «?» los separa sin gastar un tono de alarma en algo que no lo es: subir
   * `unreachable` a `warning` lo leería como problema, y no lo es; bajarlo a nada lo leería como
   * sano, que es peor.
   *
   * Y sí: el MISMO estado va en `warning` en `rename-slug-badges.ts`. No es una incoherencia, es
   * la regla del vocabulario: **el tono codifica la consecuencia en el flujo donde aparece, no
   * el estado**. Acá `unreachable` es un dato del informe; allá aborta la operación entera. No
   * lo «uniformes» sin cambiar antes esa regla.
   */
  unreachable: {
    key: 'unreachable',
    tone: 'neutral',
    icon: '?',
    label: 'No se pudo leer',
    title:
      'El motor no respondió, así que su contabilidad es INDETERMINADA: ni correcta ni fuera de sitio. No cuenta como resuelta.',
  },
}

/** La insignia de un estado del enum cerrado. */
export function versionTableBadge(status: VersionTableStatus): VersionTableBadgeSpec {
  return SPECS[status]
}

/**
 * ¿Es una de las cinco claves conocidas?
 *
 * Existe porque `summary` viene declarado `dict[str, int]` **abierto**: puede faltar una de las
 * cinco y puede traer una que este front no conoce. Una clave desconocida se muestra tal cual en
 * vez de esconderse — un contador que el backend se molestó en mandar y la UI descarta en
 * silencio es justo el fallo que no se detecta hasta que hace falta.
 */
export function isVersionTableStatus(value: string): value is VersionTableStatus {
  return Object.hasOwn(SPECS, value)
}

/**
 * Orden de lectura del informe: **lo que bloquea primero**.
 *
 * `orphaned` y `mixed` son las dos que mueve `needs_attention`; `unreachable` va inmediatamente
 * después porque es lo que NO se sabe, y lo que no se sabe se mira antes que lo que ya está bien.
 * `/version-tables` no pagina y devuelve el parque entero, así que este orden es el único que
 * garantiza que lo accionable quede en la primera pantalla sin inventar parámetros que el
 * endpoint no acepta.
 */
export const VERSION_TABLE_STATUS_ORDER: readonly VersionTableStatus[] = [
  'orphaned',
  'mixed',
  'unreachable',
  'none',
  'ok',
]

/** Posición en `VERSION_TABLE_STATUS_ORDER`, para ordenar filas sin repetir el criterio. */
export function versionTableStatusRank(status: VersionTableStatus): number {
  return VERSION_TABLE_STATUS_ORDER.indexOf(status)
}

/**
 * ¿Cuenta esta base como «sana» en un recuento?
 *
 * Solo `ok` y `none`. 🔴 `unreachable` devuelve `false` a propósito: es indeterminado, y sumarlo
 * a las sanas convertiría «no pudimos leer 3 bases» en «3 bases están bien», que es la afirmación
 * que este informe existe para no hacer.
 */
export function isHealthyVersionTable(status: VersionTableStatus): boolean {
  return status === 'ok' || status === 'none'
}

/** Los dos estados que mueven `needs_attention`. `unreachable` NO está, igual que en el backend. */
export function isBlockingVersionTable(status: VersionTableStatus): boolean {
  return status === 'orphaned' || status === 'mixed'
}
