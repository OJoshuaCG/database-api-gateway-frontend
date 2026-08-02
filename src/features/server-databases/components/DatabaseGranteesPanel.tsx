import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  RefreshIcon,
  Spinner,
} from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { DatabaseGrantee, EngineType } from '@/lib/contracts'
import { filterGrantees, isDangerousPrivilege, type GranteeScope } from '../logic'
import { useDatabaseGrantees } from '../hooks/use-database-grantees'

/** Privilegios visibles antes de plegar el resto tras «y N más». */
const PRIVILEGE_PREVIEW = 6

const SCOPE_OPTIONS: { id: GranteeScope; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'adopted', label: 'Adoptados' },
  { id: 'unmanaged', label: 'No gestionados' },
]

interface DatabaseGranteesPanelProps {
  serverId: number
  database: string
}

/**
 * Consulta INVERSA y de SOLO LECTURA: quién tiene permisos sobre esta base de datos 🔌.
 *
 * Todo el filtrado es en cliente porque el endpoint devuelve la lista completa sin paginar ni
 * aceptar parámetros de búsqueda, y no hay polling: está limitado a 30 consultas por minuto.
 */
export function DatabaseGranteesPanel({ serverId, database }: DatabaseGranteesPanelProps) {
  const { data, isLoading, isError, error, refetch, isFetching } = useDatabaseGrantees(
    serverId,
    database,
  )

  const [search, setSearch] = useState('')
  const [onlyGlobal, setOnlyGlobal] = useState(false)
  const [scope, setScope] = useState<GranteeScope>('all')
  // Filas con la lista de privilegios desplegada, por clave `username@host`.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const grantees = data?.grantees
  const filtered = useMemo(
    () => filterGrantees(grantees ?? [], { search, onlyGlobal, scope }),
    [grantees, search, onlyGlobal, scope],
  )

  const total = grantees?.length ?? 0

  const clearFilters = () => {
    setSearch('')
    setOnlyGlobal(false)
    setScope('all')
  }

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const refreshButton = (
    <IconButton
      label="Actualizar"
      icon={<RefreshIcon />}
      variant="outline"
      size="icon-sm"
      onClick={() => void refetch()}
      isLoading={isFetching}
    />
  )

  const renderContent = () => {
    if (isLoading) {
      // No se pinta la cabecera todavía: sin `supports_hosts` no se sabe si va la columna Host,
      // y una columna que aparece y desaparece al terminar la carga desconcierta.
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Cargando usuarios con permisos…
        </div>
      )
    }

    if (isError) {
      const apiError = toApiError(error)
      if (apiError.status === 404) {
        return (
          <EmptyState
            title="Esta base de datos ya no existe en el servidor."
            description="Pudo haberse borrado desde otra pestaña o directamente en el motor, por fuera del gateway."
          />
        )
      }
      if (apiError.status === 429) {
        return (
          <div className="flex flex-col items-start gap-2 rounded-card border border-warning/30 bg-warning/10 px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              Demasiadas consultas; esperá un momento.
            </p>
            <p className="text-xs text-muted-foreground">
              El motor admite 30 consultas por minuto para esta vista.
            </p>
            {refreshButton}
          </div>
        )
      }
      return <ErrorState error={error} onRetry={() => void refetch()} />
    }

    if (!data) return null

    const supportsHosts = data.supports_hosts

    if (total === 0) {
      return (
        <EmptyState
          title="Ningún usuario del motor tiene privilegios sobre esta base de datos."
          description={
            supportsHosts
              ? 'Es lo normal en una base recién creada. No se listan las cuentas de sistema del motor.'
              : 'Es lo normal en una base recién creada. Recordá que la cobertura del nivel de objeto es parcial.'
          }
        />
      )
    }

    if (filtered.length === 0) {
      return (
        <EmptyState
          title="Ningún usuario coincide con los filtros."
          description={`Hay ${total} usuario(s)/rol(es) con permisos sobre esta base, pero ninguno pasa los filtros activos.`}
          action={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          }
        />
      )
    }

    return (
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Usuario</th>
              {supportsHosts && <th className="px-3 py-2 font-semibold">Host</th>}
              <th className="px-3 py-2 font-semibold">Alcance</th>
              <th className="px-3 py-2 font-semibold">Privilegios</th>
              <th className="px-3 py-2 font-semibold">Niveles</th>
              <th className="px-3 py-2 font-semibold">Inventario</th>
              <th className="px-3 py-2 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((grantee) => {
              const key = granteeKey(grantee)
              const isExpanded = expanded.has(key)
              const hidden = grantee.privileges.length - PRIVILEGE_PREVIEW
              const visiblePrivileges =
                isExpanded || hidden <= 0
                  ? grantee.privileges
                  : grantee.privileges.slice(0, PRIVILEGE_PREVIEW)

              return (
                <tr key={key} className="border-b border-border align-top last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-foreground">
                    {grantee.username}
                  </td>
                  {supportsHosts && (
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {grantee.host ?? '—'}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {grantee.is_global ? (
                      <Badge tone="warning">GLOBAL (*.*)</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Esta base</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {visiblePrivileges.map((privilege) => (
                        <Badge
                          key={privilege}
                          tone={isDangerousPrivilege(privilege) ? 'error' : 'neutral'}
                        >
                          {privilege}
                        </Badge>
                      ))}
                      {hidden > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(key)}
                          aria-expanded={isExpanded}
                          className="rounded px-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {isExpanded ? 'Ver menos' : `y ${hidden} más`}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {grantee.levels.map((level) => (
                        <Badge key={level} tone="neutral">
                          {level}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {grantee.status === 'adopted' ? (
                      <Badge tone="success">Adoptado</Badge>
                    ) : (
                      <Badge tone="warning">No gestionado</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {/* No hay ruta de detalle por id: ambos enlaces llevan al listado de usuarios. */}
                    <Link
                      to="/server-users"
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {grantee.status === 'adopted' && grantee.server_user_id
                        ? 'Ver usuario →'
                        : 'Adoptar usuario →'}
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ScopeNotice dialect={data?.dialect} />

      {data && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <Input
                label="Buscar usuario"
                placeholder={data.supports_hosts ? 'usuario o host' : 'usuario'}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div
              className="flex gap-1.5"
              role="group"
              aria-label="Filtrar por estado de inventario"
            >
              {SCOPE_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={scope === option.id ? 'primary' : 'outline'}
                  aria-pressed={scope === option.id}
                  onClick={() => setScope(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {refreshButton}
          </div>

          {/* En PostgreSQL `is_global` es siempre false: el filtro no tendría ningún efecto. */}
          {data.supports_hosts && (
            <Checkbox
              label="Solo privilegios globales"
              hint="Cuentas con privilegios *.*, que alcanzan a todas las bases del servidor."
              checked={onlyGlobal}
              onChange={(event) => setOnlyGlobal(event.target.checked)}
            />
          )}

          <p className="text-xs text-muted-foreground">
            {filtered.length} usuario(s)/rol(es)
            {filtered.length !== total ? ` de ${total} en total` : ''}
          </p>
        </div>
      )}

      {renderContent()}
    </div>
  )
}

/** Clave estable de fila: en MySQL la identidad es `usuario@host`, no solo el usuario. */
function granteeKey(grantee: DatabaseGrantee): string {
  return `${grantee.username}@${grantee.host ?? ''}`
}

/**
 * Alcance real de la lista. Se muestra SIEMPRE porque la respuesta no trae ninguna señal de lo
 * que quedó fuera: el backend descarta en silencio el privilegio `USAGE`, las cuentas de sistema
 * del motor y —en PostgreSQL— el fallo de la consulta a nivel de objeto.
 */
function ScopeNotice({ dialect }: { dialect?: EngineType }) {
  const isPostgres = dialect === 'postgresql'
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Lista de usuarios/roles del motor con algún privilegio relacionado con esta base. No se
        incluyen las cuentas de sistema del motor ni el privilegio «USAGE», que el backend descarta
        por no otorgar acceso efectivo a datos.
      </p>
      {dialect && !isPostgres && (
        <p className="text-xs text-muted-foreground">
          Incluye usuarios con privilegios globales (*.*), que alcanzan a TODAS las bases del
          servidor.
        </p>
      )}
      {isPostgres && (
        <p className="rounded-card border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <strong className="font-semibold text-warning">Cobertura parcial:</strong> el nivel de
          objeto se lee únicamente del schema «public» y puede estar incompleto. No usar como
          auditoría de permisos definitiva.
        </p>
      )}
    </div>
  )
}
