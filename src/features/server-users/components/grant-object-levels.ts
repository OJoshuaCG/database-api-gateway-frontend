import type { GrantLevel } from '@/lib/contracts'

/**
 * Qué campos del `ObjectRef` aplican a cada nivel de grant (§4). Compartido por
 * `GrantManager` (otorgar/revocar) y la sección «Permisos iniciales» de `ServerUserForm`
 * (`/server-users/provision`), para que ambos construyan el mismo mapeo nivel→objeto.
 */
export const LEVELS_WITH_DATABASE: GrantLevel[] = [
  'database',
  'schema',
  'table',
  'column',
  'sequence',
  'routine',
]
export const LEVELS_WITH_SCHEMA: GrantLevel[] = ['schema', 'table', 'column', 'sequence', 'routine']
export const LEVELS_WITH_TABLE: GrantLevel[] = ['table', 'column']
export const ROUTINE_KINDS: ('FUNCTION' | 'PROCEDURE')[] = ['FUNCTION', 'PROCEDURE']
