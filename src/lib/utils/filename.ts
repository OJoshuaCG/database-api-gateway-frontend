/**
 * Nombre de archivo seguro para una descarga.
 *
 * Los nombres de bases, tablas y servidores son **eco de un motor ajeno**: llegan como los
 * escribió quien creó el objeto y pueden traer barras, dos puntos o cualquier cosa que el
 * sistema de archivos interprete. Se saneen antes de volverse nombre de archivo.
 *
 * Un nombre que al limpiarlo queda en puros separadores (`///` → `_`) no identifica nada, así
 * que cae al genérico en vez de producir un archivo llamado `_`.
 *
 * Vive acá y no en una feature porque lo usan la consola SQL y los diagnósticos de clonado, y
 * una feature no importa de otra.
 */
export function safeFilenamePart(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, '_').slice(0, 64)
  return /[a-zA-Z0-9]/.test(cleaned) ? cleaned : 'resultado'
}
