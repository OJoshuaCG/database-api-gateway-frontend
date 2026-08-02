import { useEffect, useState } from 'react'
import {
  Badge,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  RefreshIcon,
  Spinner,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import type { EngineType, ServerUserOut } from '@/lib/contracts'
import { useUserGrants } from '../hooks/use-user-grants'
import { GrantManager } from './GrantManager'
import { ApplyProfilePanel } from './ApplyProfilePanel'

/** Devuelve `value` retrasado `delayMs` para no consultar el motor 🔌 en cada pulsación. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

interface ServerUserGrantsModalProps {
  user: ServerUserOut | null
  engine: EngineType | null
  onClose: () => void
}

type Tab = 'effective' | 'manage' | 'profile'

const TABS: { id: Tab; label: string }[] = [
  { id: 'effective', label: 'Permisos efectivos' },
  { id: 'manage', label: 'Otorgar / revocar' },
  { id: 'profile', label: 'Aplicar perfil' },
]

/** Gestión de permisos de un usuario del motor (§7): introspección, grants y perfiles 🔌. */
export function ServerUserGrantsModal({ user, engine, onClose }: ServerUserGrantsModalProps) {
  const [tab, setTab] = useState<Tab>('effective')
  const [databaseDraft, setDatabaseDraft] = useState('')
  const database = useDebouncedValue(databaseDraft, 400)
  const isPg = engine === 'postgresql'

  // PostgreSQL exige `?database=` para la introspección de grants: sin BD la query no se
  // dispara (queda gateada en el hook) y en su lugar se muestra el hint de abajo.
  const needsDatabase = isPg && !database.trim()
  const grants = useUserGrants(
    user?.id ?? 0,
    database.trim() || undefined,
    user !== null && tab === 'effective',
    isPg,
  )

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Permisos del usuario"
      description={user ? `${user.username}${user.host ? `@${user.host}` : ''}` : undefined}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === item.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {user && tab === 'effective' && (
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
                Indicá una base de datos para consultar los permisos (PostgreSQL la exige para los
                grants de objeto).
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
                    <span className="text-xs text-muted-foreground">
                      {grant.privileges.join(', ')}
                    </span>
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
        )}

        {user && tab === 'manage' && <GrantManager user={user} engine={engine} />}
        {user && tab === 'profile' && <ApplyProfilePanel user={user} engine={engine} />}
      </div>
    </Modal>
  )
}
