import { useMemo, useState, type ReactNode } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Combobox,
  Checkbox,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  Input,
  PageHeader,
  Spinner,
  SqlEditor,
  CodeIcon,
  HistoryIcon,
  PlayIcon,
} from '@/components/ui'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useServerDatabases } from '@/features/servers/hooks/use-introspection'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import { QUERY_LIMITS, type QueryHistoryOut, type ServerOut } from '@/lib/contracts'
import { cn } from '@/lib/utils/cn'
import { formatCountdown } from '@/lib/utils/countdown'
import { engineLabel, formatInteger } from '@/lib/utils/format'
import { BlockedNotice } from '../components/BlockedNotice'
import { ClassificationPanel } from '../components/ClassificationPanel'
import { ConfirmExecutionDialog } from '../components/ConfirmExecutionDialog'
import { IdentityBanner } from '../components/IdentityBanner'
import { IdentitySelector, type StoredUserOption } from '../components/IdentitySelector'
import { QueryHistoryPanel } from '../components/QueryHistoryPanel'
import { ResultsPanel } from '../components/ResultsPanel'
import { useSqlConsole } from '../hooks/use-sql-console'
import {
  clampMaxRows,
  clampTimeoutMs,
  dangerCopy,
  identityLabel,
  quickActions,
  soleUsableDatabase,
} from '../logic'
import { QUERY_ACTION_HINTS, isSystemFailure, suggestsProvidedMode } from '../messages'

/**
 * Consola SQL: ejecutar SQL ad-hoc con el usuario del motor que se elija (api-reference-v6).
 *
 * El servidor y la pestaña viven en la URL (`?server=2&tab=history`) para que la pantalla sea
 * enlazable desde el detalle de un servidor y sobreviva a un refresco. El estado de la
 * consola en sí (SQL, identidad, token) NO se persiste en ningún lado: la contraseña del
 * modo `provided` no debe sobrevivir a la pestaña, y un `confirm_token` restaurado ya estaría
 * caducado.
 */

const TABS = ['console', 'history'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

export function SqlConsolePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const servers = useServerOptions()

  /**
   * Con una consulta en vuelo no se puede cambiar de servidor ni de pestaña: el cambio de
   * servidor remonta la consola (`key`) y tiraría el resultado de una ejecución que ya está
   * corriendo en el motor, sin forma de recuperarlo. `useIsMutating` evita tener que subir
   * el estado desde el hijo, que exigiría un `setState` en efecto.
   */
  const isMutating = useIsMutating() > 0

  const rawServerId = Number(searchParams.get('server'))
  const serverId = Number.isInteger(rawServerId) && rawServerId > 0 ? rawServerId : null
  const tab: Tab = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as Tab) : 'console'

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const server = servers.data?.find((candidate) => candidate.id === serverId) ?? null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consola SQL"
        description="Ejecutá SQL contra cualquier base del inventario eligiendo con qué usuario del motor se conecta. Sirve para comprobar en la práctica que un permiso quedó como esperabas."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="min-w-64 flex-1">
            <Combobox<ServerOut>
              label="Servidor"
              items={servers.data ?? []}
              value={server}
              onChange={(next) => setParam('server', next ? String(next.id) : null)}
              itemToString={(item) => `${item.name} · ${engineLabel(item.engine)}`}
              itemToKey={(item) => String(item.id)}
              placeholder="Elegí un servidor"
              isLoading={servers.isLoading}
              disabled={isMutating}
              required
            />
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Secciones de la consola">
            <SegmentedTabButton
              active={tab === 'console'}
              disabled={isMutating}
              onClick={() => setParam('tab', 'console')}
            >
              <CodeIcon className="h-4 w-4" />
              Consola
            </SegmentedTabButton>
            <SegmentedTabButton
              active={tab === 'history'}
              disabled={isMutating}
              onClick={() => setParam('tab', 'history')}
            >
              <HistoryIcon className="h-4 w-4" />
              Historial
            </SegmentedTabButton>
          </div>
        </CardContent>
      </Card>

      {servers.isLoading && <FullPageSpinner label="Cargando servidores" />}
      {servers.isError && (
        <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
      )}
      {!servers.isLoading && !servers.isError && server === null && (
        <EmptyState
          title="Elegí un servidor para empezar"
          description="La consola opera sobre un servidor concreto del inventario: de ahí salen las bases de datos y los usuarios del motor con los que se puede probar."
        />
      )}
      {server !== null && (
        // Remontar al cambiar de servidor descarta SQL, identidad y token de una vez, sin
        // efectos de limpieza: nada de lo anterior tiene sentido en otro servidor.
        <ServerSqlConsole
          key={server.id}
          server={server}
          tab={tab}
          onGoToConsole={() => setParam('tab', 'console')}
        />
      )}
    </div>
  )
}

/**
 * Variante intencional del patrón de pestaña compartido (`components/ui/TabButton`): estilo
 * "segmented control" (fondo `bg-primary/10` en la activa, sin subrayado) y con `disabled`
 * propio mientras la consola está mutando. No es una copia accidental — no fusionar con
 * `TabButton` a menos que también se unifique el estilo visual.
 */
function SegmentedTabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-primary/10',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  )
}

interface ServerSqlConsoleProps {
  server: ServerOut
  tab: Tab
  onGoToConsole: () => void
}

function ServerSqlConsole({ server, tab, onGoToConsole }: ServerSqlConsoleProps) {
  const sqlConsole = useSqlConsole(server.id, server.engine)
  const databases = useServerDatabases(server.id, true)
  const storedUsers = useServerUserOptions(server.id)

  const [showOptions, setShowOptions] = useState(false)
  const [autoPickedDatabase, setAutoPickedDatabase] = useState<string | null>(null)

  /**
   * Cuentas del inventario para el modo `stored`. `has_password` es el dato que decide: sin
   * contraseña guardada ese modo responde 409, así que el selector las excluye en vez de
   * ofrecer un camino que no lleva a ninguna parte.
   */
  const storedUserOptions = useMemo<StoredUserOption[]>(
    () =>
      (storedUsers.data ?? []).map((user) => ({
        username: user.username,
        host: user.host,
        hasPassword: user.has_password,
      })),
    [storedUsers.data],
  )

  /**
   * El contrato exige `database`, pero no hay que hacer elegir cuando no hay nada que elegir:
   * con una sola base que no sea del sistema, se preselecciona. Es un ajuste de estado en
   * render —el patrón de este repo—, no un efecto, y el testigo evita volver a aplicarlo si
   * el admin la borra a mano.
   */
  const soleDatabase = soleUsableDatabase(databases.data, server.engine)
  if (soleDatabase !== null && autoPickedDatabase !== soleDatabase && sqlConsole.database === '') {
    setAutoPickedDatabase(soleDatabase)
    sqlConsole.setDatabase(soleDatabase)
  }

  const { preview, path, options } = sqlConsole
  const danger = preview ? dangerCopy(preview.danger) : null
  const busy = sqlConsole.isAnalyzing || sqlConsole.isExecuting

  const blockedByPolicy = path === 'blocked'
  const canRun = sqlConsole.canAnalyze && !blockedByPolicy && !sqlConsole.systemDatabaseBlocked

  /**
   * Un solo gesto: si todavía no hay clasificación, clasifica y actúa según el nivel; si ya
   * la hay, va derecho a lo que corresponda. Es lo que hace que una lectura —el caso más
   * frecuente— sea un clic, sin dejar de pasar nunca por el preview.
   */
  const handleRun = () => {
    if (preview === null) {
      void sqlConsole.analyzeAndRun()
      return
    }
    if (path === 'confirm') {
      sqlConsole.openConfirm()
      return
    }
    void sqlConsole.runCurrent()
  }

  const handleLoadFromHistory = (entry: QueryHistoryOut) => {
    sqlConsole.loadFromHistory(entry)
    onGoToConsole()
  }

  if (tab === 'history') {
    return (
      <QueryHistoryPanel
        serverId={server.id}
        onLoadInEditor={handleLoadFromHistory}
        initialDatabase={sqlConsole.database}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="max-w-md">
            <Combobox<string>
              label="Base de datos"
              items={databases.data ?? []}
              value={sqlConsole.database.length > 0 ? sqlConsole.database : null}
              onChange={(next) => sqlConsole.setDatabase(next ?? '')}
              itemToString={(item) => item}
              itemToKey={(item) => item}
              placeholder="Elegí una base"
              isLoading={databases.isLoading}
              disabled={busy}
              clearable
              required
              hint="No hace falta que esté adoptada por el gateway: sirve cualquier base del servidor."
            />
            {databases.isError && (
              <p className="mt-2 text-sm text-error">
                No se pudieron listar las bases del servidor.{' '}
                <button
                  type="button"
                  className="underline hover:text-error/80"
                  onClick={() => void databases.refetch()}
                >
                  Reintentar
                </button>
              </p>
            )}
          </div>

          <IdentitySelector
            value={sqlConsole.identity}
            onChange={sqlConsole.setIdentity}
            engine={server.engine}
            error={sqlConsole.identityError}
            disabled={busy}
            storedUsers={storedUserOptions}
            storedUsersLoading={storedUsers.isLoading}
          />
        </CardContent>
      </Card>

      <IdentityBanner identity={sqlConsole.identity} engine={server.engine} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <QuickActions
            engine={server.engine}
            username={sqlConsole.identity.username}
            onPick={sqlConsole.setSql}
            disabled={busy}
          />

          <SqlEditor
            value={sqlConsole.sql}
            onChange={(event) => sqlConsole.setSql(event.target.value)}
            rows={10}
            disabled={sqlConsole.isExecuting}
            aria-label="Consulta SQL"
            placeholder="SELECT * FROM pedidos LIMIT 10"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className={cn(sqlConsole.sqlTooLarge && 'font-medium text-error')}>
              {formatInteger(sqlConsole.sqlBytes)} de {formatInteger(QUERY_LIMITS.maxSqlBytes)}{' '}
              bytes
              {sqlConsole.sqlTooLarge && ' — recortá la consulta o dividila en varios lotes.'}
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 underline hover:bg-primary/10 hover:text-primary"
              onClick={() => setShowOptions((current) => !current)}
            >
              {showOptions ? 'Ocultar opciones' : 'Opciones de ejecución'}
            </button>
          </div>

          {showOptions && (
            <div className="grid gap-4 rounded-lg border border-border bg-surface-muted p-4 sm:grid-cols-3">
              <Checkbox
                label="Modo de prueba"
                hint="Ejecuta el lote y lo revierte al final. No revierte cambios de estructura en MySQL/MariaDB."
                checked={options.dryRun}
                onChange={(event) =>
                  sqlConsole.setOptions({ ...options, dryRun: event.target.checked })
                }
                disabled={busy}
              />
              <Input
                label="Tope de filas"
                type="number"
                min={1}
                max={QUERY_LIMITS.maxRows}
                value={options.maxRows ?? QUERY_LIMITS.maxRows}
                hint={`Solo puede bajar del tope del despliegue (${formatInteger(QUERY_LIMITS.maxRows)}).`}
                onChange={(event) => {
                  // Se recorta ya en el campo para no mostrar un tope que nunca se enviaría:
                  // `max_rows` solo puede BAJAR el del despliegue.
                  const raw = event.target.value
                  sqlConsole.setOptions({
                    ...options,
                    maxRows: raw.trim().length === 0 ? null : clampMaxRows(Number(raw)),
                  })
                }}
                disabled={busy}
              />
              <Input
                label="Timeout por sentencia (ms)"
                type="number"
                min={QUERY_LIMITS.minTimeoutMs}
                max={QUERY_LIMITS.maxTimeoutMs}
                value={options.timeoutMs}
                hint={`Entre ${formatInteger(QUERY_LIMITS.minTimeoutMs)} y ${formatInteger(QUERY_LIMITS.maxTimeoutMs)} ms.`}
                onChange={(event) => {
                  // Sin recorte, vaciar el campo mandaba `timeout_ms: 0` al backend y se
                  // cobraba un 422 gastando una de las 30 llamadas por minuto.
                  sqlConsole.setOptions({
                    ...options,
                    timeoutMs: clampTimeoutMs(Number(event.target.value)),
                  })
                }}
                disabled={busy}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleRun}
              disabled={!canRun}
              isLoading={busy}
              variant={
                preview?.danger === 'write' || preview?.danger === 'ddl' ? 'accent' : 'primary'
              }
            >
              <PlayIcon className="h-4 w-4" />
              {danger ? danger.actionLabel : 'Analizar y ejecutar'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void sqlConsole.analyze()}
              disabled={!sqlConsole.canAnalyze}
            >
              Solo analizar
            </Button>
            {sqlConsole.isAnalyzing && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" /> Clasificando la consulta…
              </span>
            )}
            {sqlConsole.isExecuting && (
              <span className="text-sm text-muted-foreground">
                Ejecutando en el motor. No se puede cancelar desde acá: hay que esperar a que
                termine o a que venza el timeout.
              </span>
            )}
            {sqlConsole.rateLimitCooldownMs > 0 && (
              <span className="text-sm text-warning">
                Límite de consultas alcanzado. Se reanuda en{' '}
                {formatCountdown(sqlConsole.rateLimitCooldownMs)}.
              </span>
            )}
            {preview && <Badge tone="neutral">Ejecuta como {preview.run_as}</Badge>}
          </div>

          {sqlConsole.systemDatabaseBlocked && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
              <strong>{sqlConsole.database}</strong> es una base de datos de sistema del motor.
              Leerla está permitido, pero modificarla corrompería el propio servidor: el gateway lo
              rechaza aunque la clasificación diga otra cosa.
            </p>
          )}

          {sqlConsole.notice && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <span>{sqlConsole.notice}</span>
              <button
                type="button"
                className="shrink-0 rounded px-2 text-xs underline hover:bg-primary/10"
                onClick={sqlConsole.dismissNotice}
              >
                Entendido
              </button>
            </div>
          )}

          {sqlConsole.error && sqlConsole.errorAction && (
            <ConsoleError
              message={sqlConsole.error.message}
              hint={QUERY_ACTION_HINTS[sqlConsole.errorAction]}
              requestId={sqlConsole.error.requestId}
              isSystem={isSystemFailure(sqlConsole.errorAction)}
              onSwitchToProvided={
                suggestsProvidedMode(sqlConsole.errorAction) ? sqlConsole.switchToProvided : null
              }
              blockedReasons={sqlConsole.error.reasons ?? null}
              blockedStatements={sqlConsole.error.blockedStatements ?? null}
              serverId={server.id}
              onDismiss={sqlConsole.dismissError}
            />
          )}
        </CardContent>
      </Card>

      {preview && <ClassificationPanel preview={preview} serverId={server.id} />}

      {sqlConsole.result && <ResultsPanel result={sqlConsole.result} engine={server.engine} />}

      {preview && sqlConsole.confirmOpen && (
        <ConfirmExecutionDialog
          open
          preview={preview}
          database={sqlConsole.database}
          engine={server.engine}
          identityLabel={identityLabel(sqlConsole.identity, server.engine)}
          dryRun={options.dryRun}
          onDryRunChange={(next) => sqlConsole.setOptions({ ...options, dryRun: next })}
          isExecuting={sqlConsole.isExecuting}
          error={sqlConsole.error}
          errorAction={sqlConsole.errorAction}
          notice={sqlConsole.notice}
          onConfirm={(typedName) => void sqlConsole.confirmAndExecute(typedName)}
          onClose={sqlConsole.closeConfirm}
          onReanalyze={() => void sqlConsole.analyze()}
          isReanalyzing={sqlConsole.isAnalyzing}
        />
      )}
    </div>
  )
}

/**
 * Atajos de un clic. Todos son lecturas —`SHOW GRANTS` no está bloqueado y leer los catálogos
 * del sistema está permitido—, así que responden la pregunta que trajo al admin a esta
 * pantalla sin pasar por ninguna confirmación.
 */
function QuickActions({
  engine,
  username,
  onPick,
  disabled,
}: {
  engine: ServerOut['engine']
  username: string
  onPick: (sql: string) => void
  disabled: boolean
}) {
  const actions = quickActions(engine, username)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Consultas frecuentes:</span>
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="outline"
          size="sm"
          title={action.hint}
          disabled={disabled}
          onClick={() => onPick(action.sql)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  )
}

interface ConsoleErrorProps {
  message: string
  hint: string
  requestId?: string
  isSystem: boolean
  onSwitchToProvided: (() => void) | null
  blockedReasons: { code: string; message: string }[] | null
  blockedStatements: { seq: number; sql: string }[] | null
  serverId: number
  onDismiss: () => void
}

/**
 * Error de la API con su salida. El rojo se reserva para los fallos de sistema (5xx/502/504):
 * el resto son condiciones del flujo —un usuario que no está en el inventario, una política
 * que prohíbe la sentencia— y pintarlas de rojo las haría parecer averías.
 */
function ConsoleError({
  message,
  hint,
  requestId,
  isSystem,
  onSwitchToProvided,
  blockedReasons,
  blockedStatements,
  serverId,
  onDismiss,
}: ConsoleErrorProps) {
  if (blockedReasons && blockedReasons.length > 0) {
    return (
      <BlockedNotice
        reasons={blockedReasons}
        serverId={serverId}
        statements={blockedStatements ?? undefined}
      />
    )
  }

  return (
    <div
      role="alert"
      className={cn(
        'space-y-2 rounded-lg border p-3 text-sm',
        isSystem ? 'border-error/30 bg-error/10' : 'border-border bg-surface-muted',
      )}
    >
      <p className={cn('font-medium', isSystem && 'text-error')}>{message}</p>
      <p className="text-muted-foreground">{hint}</p>
      {isSystem && requestId && (
        <p className="text-xs text-muted-foreground">
          Identificador de la petición: <span className="font-mono">{requestId}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {onSwitchToProvided && (
          <Button variant="outline" size="sm" onClick={onSwitchToProvided}>
            Probar con contraseña
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Descartar
        </Button>
      </div>
    </div>
  )
}
