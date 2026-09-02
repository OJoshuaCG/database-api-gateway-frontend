import type { EngineType } from '@/lib/contracts'

/**
 * Compatibilidad de un perfil de permisos con el motor de un servidor (api-reference-v21 §10).
 *
 * **La regla no es igualdad de `engine`, y filtrar por igualdad pierde casos válidos.** Cuando el
 * perfil y el servidor son de la misma familia (mysql ↔ mariadb) el backend valida
 * **privilegio por privilegio** contra el catálogo del motor real y aplica el perfil si todos los
 * tokens existen ahí; solo devuelve 422 si alguno no existe, o si las familias son distintas.
 *
 * De ahí que este módulo devuelva tres estados y no un booleano: la UI necesita **ofrecer** el
 * perfil de la familia vecina y, a la vez, avisar de que su compatibilidad la decide el motor.
 */
export type ProfileCompatibility = 'exact' | 'same-family' | 'incompatible'

type EngineFamily = 'mysql' | 'postgresql'

const FAMILY_BY_ENGINE: Record<EngineType, EngineFamily> = {
  mysql: 'mysql',
  mariadb: 'mysql',
  postgresql: 'postgresql',
}

/** Familia de motores a la que pertenece un `engine`. MySQL y MariaDB comparten catálogo base. */
export function engineFamily(engine: EngineType): EngineFamily {
  return FAMILY_BY_ENGINE[engine]
}

export function profileCompatibility(
  profileEngine: EngineType,
  serverEngine: EngineType,
): ProfileCompatibility {
  if (profileEngine === serverEngine) return 'exact'
  if (engineFamily(profileEngine) === engineFamily(serverEngine)) return 'same-family'
  return 'incompatible'
}

/** Los perfiles que tiene sentido ofrecer para este motor: los suyos y los de su familia. */
export function profilesApplicableTo<T extends { engine: EngineType }>(
  profiles: T[],
  serverEngine: EngineType | null | undefined,
): T[] {
  if (!serverEngine) return profiles
  return profiles.filter(
    (profile) => profileCompatibility(profile.engine, serverEngine) !== 'incompatible',
  )
}
