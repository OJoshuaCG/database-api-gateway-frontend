import type { EngineType, GrantLevel } from '@/lib/contracts'

interface GrantLevelOption {
  value: GrantLevel
  label: string
  /** `true` si el nivel solo aplica a PostgreSQL (§4). */
  postgresOnly: boolean
}

/** Niveles de grant para selects (§4). `schema` y `sequence` solo PostgreSQL. */
export const GRANT_LEVELS: GrantLevelOption[] = [
  { value: 'global', label: 'Global', postgresOnly: false },
  { value: 'database', label: 'Base de datos', postgresOnly: false },
  { value: 'schema', label: 'Esquema (PG)', postgresOnly: true },
  { value: 'table', label: 'Tabla', postgresOnly: false },
  { value: 'column', label: 'Columna', postgresOnly: false },
  { value: 'sequence', label: 'Secuencia (PG)', postgresOnly: true },
  { value: 'routine', label: 'Rutina', postgresOnly: false },
]

/** Niveles permitidos para un motor dado. */
export function grantLevelsForEngine(engine: EngineType | null | undefined): GrantLevelOption[] {
  if (engine === 'postgresql') return GRANT_LEVELS
  return GRANT_LEVELS.filter((level) => !level.postgresOnly)
}
