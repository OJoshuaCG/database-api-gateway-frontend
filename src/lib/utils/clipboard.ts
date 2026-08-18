/**
 * ¿Existe el portapapeles del navegador?
 *
 * `navigator.clipboard` está restringida a contextos seguros —HTTPS o `localhost`— y este gateway
 * también se sirve sobre HTTP plano, donde es `undefined`.
 *
 * Se comprueba **antes** de emprender la acción, no en un `catch`: hay botones que consumen algo
 * irrecuperable de camino al portapapeles —el artefacto de una exportación es de un solo uso— y
 * ahí «intentar y fallar» no cuesta un mensaje de error, cuesta el artefacto entero.
 */
export function isClipboardAvailable(): boolean {
  return typeof navigator.clipboard?.writeText === 'function'
}
