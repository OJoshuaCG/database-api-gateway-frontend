import { roleRank } from '@/features/auth'

/**
 * Techo de lo que el actor puede OTORGAR, espejo de `_assert_within_ceiling` del backend:
 *
 * - rol base (alta y edición) ≤ el rol BASE del actor;
 * - rol por alcance ≤ el rol UNIÓN del actor (el más alto en cualquier alcance);
 * - capacidad global: solo las que el actor tiene.
 *
 * Y lo que lo vuelve usable: **solo se mide lo que se AGREGA**. Un permiso o una global que la
 * persona ya tenía se puede conservar aunque supere el techo de quien edita — el backend compara
 * contra el estado actual —, así que la UI tampoco lo bloquea.
 *
 * Con un backend que no publica roles (`null`) no hay techo conocido y no se filtra nada: el 409
 * lo explica igual. Es una pista para no llevar a nadie hasta el rechazo, no la barrera.
 */
export interface GrantCeiling {
  baseRole: string | null
  unionRole: string | null
  globalCapabilities: readonly string[]
}

/** ¿`role` entra bajo el techo? Sin techo conocido, sí. */
export function withinCeiling(role: string, ceiling: string | null): boolean {
  return ceiling === null || roleRank(role) <= roleRank(ceiling)
}

/** Motivo visible cuando hay roles fuera del techo. `null` si no se ocultó ninguno. */
export function roleCeilingHint(
  roles: readonly string[],
  ceiling: string | null,
  kind: 'base' | 'scope',
): string | null {
  if (ceiling === null || roles.every((role) => withinCeiling(role, ceiling))) return null
  return kind === 'base'
    ? `Solo podés asignar un rol base hasta ${ceiling}, que es el tuyo: nadie otorga más acceso del que tiene.`
    : `Solo podés otorgar hasta ${ceiling}, tu rol más alto: nadie otorga más acceso del que tiene.`
}

export const GLOBAL_CEILING_HINT =
  'No la tenés, así que no podés otorgarla: nadie otorga más acceso del que tiene.'
