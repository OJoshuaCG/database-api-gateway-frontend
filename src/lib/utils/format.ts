import type { EngineType } from '@/lib/contracts/common'

/** Nombre legible del motor para cabeceras y etiquetas. */
export function engineLabel(engine: EngineType): string {
  if (engine === 'postgresql') return 'PostgreSQL'
  if (engine === 'mariadb') return 'MariaDB'
  return 'MySQL'
}

/**
 * Entero con separador de miles en español. Se usa para cifras que el admin lee antes de
 * decidir (filas estimadas, filas afectadas): `2481902` a secas se malinterpreta.
 */
export function formatInteger(value: number): string {
  return new Intl.NumberFormat('es').format(value)
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * Tamaño legible: `512 B`, `1,2 MB`, `2,3 GB`. Se usa en cifras que el admin compara contra un
 * tope antes de decidir (el tamaño estimado de una exportación frente al máximo de la entrega en
 * línea), así que la unidad importa tanto como el número: `1048576` a secas no se compara con nada.
 *
 * Base 1024 —la que reportan los motores y el sistema de archivos— con las etiquetas cortas.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // Los bytes sueltos nunca llevan decimales; a partir de KB, uno solo basta para comparar.
  const digits = unit === 0 ? 0 : 1
  return `${new Intl.NumberFormat('es', { maximumFractionDigits: digits }).format(value)} ${BYTE_UNITS[unit]}`
}

/** Duración legible: `842 ms`, `4.2 s`, `1 m 12 s`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes} m ${seconds} s`
}

/** Formatea una fecha ISO 8601 a fecha y hora local legible. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('es', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** Fecha relativa corta (p. ej. "hace 3 h"); cae a fecha absoluta si es muy antigua. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMs = date.getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
  const abs = Math.abs(diffMin)
  if (abs < 60) return rtf.format(diffMin, 'minute')
  if (abs < 60 * 24) return rtf.format(Math.round(diffMin / 60), 'hour')
  if (abs < 60 * 24 * 30) return rtf.format(Math.round(diffMin / (60 * 24)), 'day')
  return formatDateTime(iso)
}
