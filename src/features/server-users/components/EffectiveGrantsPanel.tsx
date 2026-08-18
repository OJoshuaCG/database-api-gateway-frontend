import { useEffect, useState } from 'react'
import {
  Badge,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  RefreshIcon,
  Spinner,
} from '@/components/ui'
import type { EngineType, ServerUserOut } from '@/lib/contracts'
import { useUserGrants } from '../hooks/use-user-grants'

/** Devuelve `value` retrasado `delayMs` para no consultar el motor 🔌 en cada pulsación. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

interface EffectiveGrantsPanelProps {
  user: ServerUserOut
  engine: EngineType
}

/**
 * Permisos efectivos del usuario según la introspección del motor 🔌 (§7). Se extrajo de
 * `ServerUserGrantsPage` (que ahora es un redirect de compatibilidad) para poder montarse también
 * como pestaña "grants" de la ficha unificada de usuario del motor (`ServerUserDetailPage`) —
 * mismo criterio que `ManagedDatabaseMigrationsContent` en la Fase 1 de bases de datos.
 */
export function EffectiveGrantsPanel({ user, engine }: EffectiveGrantsPanelProps) {
  const [databaseDraft, setDatabaseDraft] = useState('')
  const database = useDebouncedValue(databaseDraft, 400)
  const isPg = engine === 'postgresql'

  // PostgreSQL exige `?database=` para la introspección de grants: sin BD la query no se
  // dispara (queda gateada en el hook) y en su lugar se muestra el hint de abajo.
  const needsDatabase = isPg && !database.trim()
  const grants = useUserGrants(user.id, database.trim() || undefined, true, isPg)

  return (
    <div className="flex flex-col gap-3">
      {isPg && (
        <Input
          label="Base de datos"
          hint="PostgreSQL: obligatoria para ver grants de tablas/columnas/secuencias/rutinas."
          value={databaseDraft}
          onChange={(event) => setDatabaseDraft(event.target.value)}
          placeholder="app_prod"
        />
      )}
      {needsDatabase ? (
        <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          Indicá una base de datos para consultar los permisos (PostgreSQL la exige para los grants
          de objeto).
        </p>
      ) : grants.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando permisos…
        </div>
      ) : grants.isError ? (
        <ErrorState error={grants.error} onRetry={() => void grants.refetch()} />
      ) : (grants.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Sin permisos efectivos"
          description="Este usuario no tiene privilegios otorgados (o no en la BD indicada)."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {grants.data?.map((grant, index) => (
            <li
              key={`${grant.level}-${grant.object ?? ''}-${index}`}
              className="flex flex-col gap-1 py-2"
            >
              <div className="flex items-center gap-2">
                <Badge tone="info">{grant.level}</Badge>
                <span className="text-sm font-medium text-foreground">
                  {grant.object ?? '(global)'}
                </span>
                {grant.with_grant_option && <Badge tone="warning">WITH GRANT</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">{grant.privileges.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        {/* Un botón `disabled` no dispara el tooltip nativo, así que sin este `span` el
            icono quedaría gris y mudo cuando falta la BD en PostgreSQL. Mismo recurso que
            usa `ModelMigrationDetailPanel` para explicar por qué no se puede pulsar. */}
        <span
          title={
            needsDatabase
              ? 'Indicá una base de datos para poder actualizar los permisos.'
              : undefined
          }
        >
          <IconButton
            type="button"
            label="Actualizar"
            icon={<RefreshIcon />}
            variant="outline"
            size="icon-sm"
            onClick={() => void grants.refetch()}
            isLoading={grants.isFetching}
            disabled={needsDatabase}
          />
        </span>
      </div>
    </div>
  )
}
