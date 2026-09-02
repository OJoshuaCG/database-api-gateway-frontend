import type { PartialApplicationEntry } from '@/lib/contracts/db-migrations'

/**
 * Reglas de lectura de una entrada de `partial_application[]` (§9).
 *
 * Vive fuera del componente porque es la regla que decide si el operador ve una salida o
 * no, y esa decisión se rompió una vez ya: la UI ofrecía «Reconciliar» mirando solo
 * `reconcilable` y, a la vez, deshabilitaba el `stamp force` en cuanto había cualquier
 * parcial. Con una parcial sin reconciliación automática eso era un lazo cerrado — las dos
 * salidas apagadas — y la BD quedaba sin forma de salir del estado desde la interfaz.
 */

/**
 * `true` si el gateway puede deshacer lo aplicado por sí mismo, con `force` o sin él.
 *
 * Son TRES estados y no dos (ver `partialApplicationEntrySchema`): `reconcilable` (se
 * deshace todo), `reconcilable_with_force` (hay reversos para parte, y el endpoint lo
 * acepta con `force=true`) y ninguno de los dos (sin vía automática: arreglo manual del
 * esquema + `stamp?force=true`). Los dos primeros deben ofrecer el botón; solo el tercero
 * habilita el `stamp force`.
 */
export function isPartialResolvable(entry: PartialApplicationEntry): boolean {
  return entry.reconcilable || entry.reconcilable_with_force
}

/** `true` si alguna de las parciales pendientes tiene vía automática. */
export function hasResolvablePartial(entries: PartialApplicationEntry[]): boolean {
  return entries.some(isPartialResolvable)
}
