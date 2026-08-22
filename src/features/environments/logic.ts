import type { EnvironmentBadgeState } from '@/components/ui/EnvironmentBadge'
import type { EnvironmentOut } from '@/lib/contracts'

/**
 * Resuelve el estado del badge a partir del id crudo que viene en la respuesta y del catálogo.
 *
 * Vive en la capa de feature —y no en `components/ui`— porque es el único lugar que importa
 * legítimamente los dos lados: el contrato (`EnvironmentOut.color`, tipado `EnvironmentColor`) y
 * el token de presentación (`EnvironmentBadgeState.color`, tipado `BadgeTone`). **Esa asignación
 * es la aserción de compatibilidad**: si algún día `EnvironmentColor` deja de ser asignable a
 * `BadgeTone`, falla `pnpm typecheck` en este archivo.
 *
 * Ojo con la verificación: una aserción de tipos NO la chequea `pnpm test` (`vite.config.ts` no
 * tiene `test.typecheck`, así que las aserciones de tipo se borran en runtime y el test pasaría
 * siempre). El guardián es `tsc -b`, que sí incluye `src`.
 *
 * Los cuatro estados se distinguen a propósito; ver el docstring de `EnvironmentBadge`.
 */
export function resolveEnvironmentState(
  environmentId: number | null | undefined,
  catalog: { byId: Map<number, EnvironmentOut>; isPending: boolean; isError: boolean },
): EnvironmentBadgeState {
  if (environmentId == null) return { kind: 'unassigned' }

  const env = catalog.byId.get(environmentId)
  if (env) {
    return {
      kind: 'assigned',
      name: env.name,
      // ⬇️ La aserción: `EnvironmentColor | null` → `BadgeTone | null`.
      color: env.color,
      blocksDestructive: env.blocks_destructive_migrations,
    }
  }

  if (catalog.isPending) return { kind: 'loading' }
  return { kind: 'unresolved', environmentId, reason: catalog.isError ? 'error' : 'unknown' }
}

/** Los entornos que bloquean destructivas, para avisar antes de disparar un apply. */
export function blockingEnvironments(environments: EnvironmentOut[]): EnvironmentOut[] {
  return environments.filter((env) => env.blocks_destructive_migrations)
}
