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
