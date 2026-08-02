import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  Pagination,
  Spinner,
  Switch,
  XIcon,
} from '@/components/ui'
import { cn, formatDateTime } from '@/lib/utils'
import { toApiError } from '@/lib/api/errors'
import {
  isDryRunResult,
  MIGRATION_VERSION_PATTERN,
  PAGINATION,
  type ManagedDatabaseOut,
  type MigrationApplyResult,
  type ModelMigrationSummary,
  type OnFailureMode,
  type PartialApplicationEntry,
} from '@/lib/contracts'
import { useModelMigrations } from '@/features/database-models/hooks/use-model-migrations'
import { OnFailureSelect } from '@/features/database-models/components/OnFailureSelect'
import {
  useApplyMigrations,
  useMigrationHistory,
  useMigrationStatus,
  useRollbackMigration,
  useStampMigration,
} from '../hooks/use-db-migrations'
import { ProvisionStatusBadge } from './ProvisionStatusBadge'
import { ReconcilePartialDialog } from './ReconcilePartialDialog'

interface ManagedDatabaseMigrationsModalProps {
  database: ManagedDatabaseOut | null
  onClose: () => void
}

type Tab = 'actions' | 'history'

/**
 * Migraciones sobre una BD gestionada (§9 / Plan 09 §7-bis): estado, actualizar a la última en un
 * clic, ir a una versión concreta, rollback secuencial e historial 🔌.
 */
export function ManagedDatabaseMigrationsModal({
  database,
  onClose,
}: ManagedDatabaseMigrationsModalProps) {
  const [tab, setTab] = useState<Tab>('actions')
  const dbId = database?.id ?? 0
  const hasModel = Boolean(database?.model_id)
  const open = database !== null

  const status = useMigrationStatus(dbId, open && hasModel)
  const apply = useApplyMigrations(dbId)
  const rollback = useRollbackMigration(dbId)
  const stamp = useStampMigration(dbId)
  // Catálogo de versiones del blueprint para poblar el selector del stamp (Cambio 4).
  const versions = useModelMigrations(
    database?.model_id ?? 0,
    { page: 1, size: PAGINATION.maxSize },
    open && hasModel,
  )

  const [applyVersion, setApplyVersion] = useState('')
  const [force, setForce] = useState(false)
  // `on_failure` (§9): compartido por "actualizar" e "ir a una versión" (solo MySQL/MariaDB).
  const [onFailure, setOnFailure] = useState<OnFailureMode>('auto')
  const [preview, setPreview] = useState<MigrationApplyResult | null>(null)
  // Resultado del último apply REAL (no dry-run): tabla de `results[]` + reconciliación.
  const [lastRun, setLastRun] = useState<MigrationApplyResult | null>(null)
  // Mensaje del 409 del gate R1 (baseline de snapshot sin revisar) para el CTA al blueprint.
  const [baselineGateMsg, setBaselineGateMsg] = useState<string | null>(null)
  const [confirmVersion, setConfirmVersion] = useState('')
  const [rollbackTarget, setRollbackTarget] = useState('')
  // Versiones sin `down_sql` confirmado devueltas por el 409 (`public_context.missing_down_sql`).
  const [missingDownSql, setMissingDownSql] = useState<string[] | null>(null)
  const [stampVersion, setStampVersion] = useState('')
  const [stampForce, setStampForce] = useState(false)
  const [stampOpen, setStampOpen] = useState(false)
  // Tras un 429 (rate limit 10/min) bloqueamos el botón de stamp unos segundos (Item 9).
  const [stampCooldown, setStampCooldown] = useState(false)
  // Entrada de `partial_application[]` en reconciliación (monta el diálogo condicionalmente).
  const [reconcileTarget, setReconcileTarget] = useState<PartialApplicationEntry | null>(null)
  // La BD llega como snapshot: tras un stamp exitoso reflejamos error→active localmente sin esperar
  // a que el padre recargue la lista (el estado real ya se invalidó/refetch-eó).
  const [recovered, setRecovered] = useState(false)

  const currentVersion = status.data?.current_version ?? null
  const latest = status.data?.latest_available ?? null
  const pendingCount = status.data?.pending_count ?? 0
  // Aplicación parcial (§9): la versión más alta primero; se resuelven de mayor a menor.
  const hasPartial = status.data?.has_partial_application ?? false
  const partialEntries = [...(status.data?.partial_application ?? [])].sort(
    (a, b) => Number(b.version) - Number(a.version),
  )
  const firstReconcilable = partialEntries.find((entry) => entry.reconcilable) ?? null
  const canRollback = confirmVersion.length > 0 && confirmVersion === currentVersion && !hasPartial

  const isQuarantined = database?.status === 'error' && !recovered
  // Una BD archivada es de solo lectura: se ocultan las acciones que tocan el motor (Item 11).
  const isArchived = database?.status === 'archived'
  const effectiveStatus = recovered ? 'active' : (database?.status ?? 'pending')
  const versionItems = versions.data?.items ?? []
  const selectedStampVersion = versionItems.find((m) => m.version === stampVersion) ?? null
  const stampValid = MIGRATION_VERSION_PATTERN.test(stampVersion.trim())

  const openStamp = () => {
    setStampVersion('')
    setStampForce(false)
    setStampOpen(true)
  }

  const confirmStamp = () => {
    stamp.mutate(
      { version: stampVersion.trim(), force: stampForce || undefined },
      {
        onSuccess: () => {
          setStampOpen(false)
          setStampVersion('')
          setStampForce(false)
          // Un stamp saca a la BD de cuarentena (error→active); lo reflejamos en la UI.
          if (database?.status === 'error') setRecovered(true)
        },
        onError: (err) => {
          // 429: superó el límite de 10/min. Bloqueamos el botón unos segundos (el hook ya avisa).
          if (toApiError(err).status === 429) {
            setStampCooldown(true)
            window.setTimeout(() => setStampCooldown(false), 15_000)
          }
        },
      },
    )
  }

  /** 409 del gate R1 (§9): el baseline de snapshot del blueprint aún no está revisado/aprobado. */
  const isBaselineGate409 = (err: unknown): string | null => {
    const apiError = toApiError(err)
    return apiError.status === 409 &&
      /baseline/i.test(apiError.message) &&
      /revis|aprob/i.test(apiError.message)
      ? apiError.message
      : null
  }

  const runApply = (options: { version?: string; dryRun: boolean; force?: boolean }) => {
    apply.mutate(
      {
        version: options.version,
        force: options.force ?? force,
        dryRun: options.dryRun,
        onFailure,
      },
      {
        onSuccess: (result) => {
          setBaselineGateMsg(null)
          if (isDryRunResult(result)) {
            setPreview(result)
          } else {
            setPreview(null)
            setLastRun(result)
          }
        },
        onError: (err) => setBaselineGateMsg(isBaselineGate409(err)),
      },
    )
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          setMissingDownSql(null)
          onClose()
        }}
        title="Migraciones de la base de datos"
        description={database ? `«${database.name}» (#${database.id})` : undefined}
        size="lg"
      >
        {!hasModel ? (
          <EmptyState
            title="Sin blueprint asignado"
            description="Asigna un blueprint (model_id) a esta base de datos para gestionar sus migraciones."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex gap-1 border-b border-border">
              <button
                type="button"
                onClick={() => setTab('actions')}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === 'actions'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                Estado y acciones
              </button>
              <button
                type="button"
                onClick={() => setTab('history')}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === 'history'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                Historial
              </button>
            </div>

            {tab === 'actions' && (
              <div className="flex flex-col gap-5">
                {/* Estado de la BD + recuperación de cuarentena (Cambio 4) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Estado de la BD:</span>
                  <ProvisionStatusBadge status={effectiveStatus} />
                </div>
                {isQuarantined && (
                  <div className="flex flex-col gap-3 rounded-lg border border-error/40 bg-error/5 p-3">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-foreground">En cuarentena</h3>
                      <p className="text-xs text-muted-foreground">
                        Esta base quedó en cuarentena por un apply fallido. Si el esquema ya
                        coincide con el baseline, márcala con un stamp para recuperarla; si no,
                        reintenta el apply forzando la cuarentena.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        isLoading={apply.isPending}
                        onClick={() =>
                          apply.mutate(
                            { force: true, dryRun: false, onFailure },
                            {
                              onSuccess: (result) => {
                                setPreview(null)
                                setLastRun(result)
                                // Si el apply forzado no falló, la BD sale de cuarentena (error→active).
                                if (!result.failed && !result.quarantined) setRecovered(true)
                              },
                              onError: (err) => setBaselineGateMsg(isBaselineGate409(err)),
                            },
                          )
                        }
                      >
                        Reintentar apply (force) 🔌
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openStamp}
                        disabled={stamp.isPending}
                      >
                        Marcar versión (stamp) para recuperar
                      </Button>
                    </div>
                  </div>
                )}

                {/* Estado */}
                {status.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="h-4 w-4" /> Cargando estado…
                  </div>
                ) : status.isError ? (
                  <ErrorState error={status.error} onRetry={() => void status.refetch()} />
                ) : status.data ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                    <Badge tone="info">actual: {currentVersion ?? 'ninguna'}</Badge>
                    <Badge tone="neutral">última: {latest ?? '—'}</Badge>
                    <Badge tone={pendingCount > 0 ? 'warning' : 'success'}>
                      {pendingCount} pendiente(s)
                    </Badge>
                    {status.data.pending_versions.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {status.data.pending_versions.join(', ')}
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Aplicación parcial (§9): sentencias ejecutadas sin registrar la versión */}
                {hasPartial && partialEntries.length > 0 && (
                  <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-foreground">
                        Aplicación parcial detectada
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Una migración falló a mitad: hay sentencias ya ejecutadas en el motor sin
                        que la versión quedara registrada. El rollback está bloqueado hasta
                        resolverlo.
                      </p>
                      {partialEntries.length > 1 && (
                        <p className="text-xs text-muted-foreground">
                          Hay {partialEntries.length} aplicaciones parciales: se resuelven de la
                          versión <strong>más alta a la más baja</strong>, una por llamada.
                        </p>
                      )}
                    </div>
                    <ul className="flex flex-col gap-2">
                      {partialEntries.map((entry) => (
                        <li
                          key={entry.version}
                          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm text-foreground">
                              Migración{' '}
                              <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                                {entry.version}
                              </code>
                              : {entry.applied_statements} de {entry.total_statements} sentencias
                              aplicadas
                            </span>
                            {entry.reconcilable ? (
                              !isArchived && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setReconcileTarget(entry)}
                                >
                                  Reconciliar…
                                </Button>
                              )
                            ) : (
                              <Badge tone="warning">no reconciliable</Badge>
                            )}
                          </div>
                          {!entry.reconcilable && (
                            <div className="flex flex-col gap-1 text-xs">
                              {entry.reason && <p className="text-foreground">{entry.reason}</p>}
                              <p className="text-muted-foreground">
                                Salidas: <strong>reintenta el apply</strong> (retoma del checkpoint,
                                desde la sentencia {entry.applied_statements + 1}), o reconcilia el
                                esquema a mano y usa <strong>stamp force</strong>.
                              </p>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isArchived && (
                  <div className="rounded-lg border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
                    Esta base de datos está <strong>archivada</strong>: es de solo lectura. Puedes
                    consultar el estado y el historial, pero las acciones sobre el motor
                    (actualizar, revertir, stamp) están deshabilitadas.
                  </div>
                )}

                {!isArchived && (
                  <>
                    {/* Actualizar a la última — acción de un clic (Plan 09 §7-bis) */}
                    <section className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <div className="flex flex-col gap-1">
                        <h3 className="text-sm font-semibold text-foreground">Actualizar</h3>
                        <p className="text-xs text-muted-foreground">
                          Aplica <strong>todas</strong> las migraciones pendientes en orden, en una
                          sola operación. No necesitas elegir la versión: el gateway llega hasta la
                          última
                          {latest ? ` (${latest})` : ''}.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          isLoading={apply.isPending}
                          disabled={pendingCount === 0}
                          onClick={() => runApply({ dryRun: false })}
                        >
                          {pendingCount === 0
                            ? 'Ya está al día'
                            : `Actualizar a la última${latest ? ` (${latest})` : ''} 🔌`}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={apply.isPending}
                          disabled={pendingCount === 0}
                          onClick={() => runApply({ dryRun: true })}
                        >
                          Previsualizar (dry-run)
                        </Button>
                        <Switch
                          checked={force}
                          onCheckedChange={setForce}
                          label="Forzar"
                          hint="Override de cuarentena."
                        />
                      </div>
                      <div className="max-w-sm">
                        <OnFailureSelect
                          value={onFailure}
                          onChange={setOnFailure}
                          hint="Solo MySQL/MariaDB. Aplica también a «ir a una versión concreta»."
                        />
                      </div>
                      {preview && (
                        <div className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
                          Plan: {preview.pending_versions.length} pendiente(s)
                          {preview.pending_versions.length > 0
                            ? ` · ${preview.pending_versions.join(', ')}`
                            : ' · nada que aplicar'}
                        </div>
                      )}
                    </section>

                    {/* Ir a una versión concreta (avanzado) */}
                    <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Ir a una versión concreta
                      </h3>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[12rem] flex-1">
                          <Input
                            label="Versión objetivo"
                            placeholder="p. ej. 0003"
                            value={applyVersion}
                            onChange={(event) => setApplyVersion(event.target.value)}
                            hint="Aplica desde la actual+1 hasta esta versión (inclusive). Forward-only."
                          />
                        </div>
                        <Button
                          size="sm"
                          isLoading={apply.isPending}
                          disabled={applyVersion.trim().length === 0}
                          onClick={() => runApply({ version: applyVersion.trim(), dryRun: false })}
                        >
                          Aplicar hasta esa versión 🔌
                        </Button>
                      </div>
                    </section>

                    {/* Gate R1 (§9): 409 por baseline de snapshot sin revisar → CTA al blueprint */}
                    {baselineGateMsg && (
                      <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-3 text-xs">
                        <p className="text-foreground">{baselineGateMsg}</p>
                        {(status.data?.model_id ?? database?.model_id) != null && (
                          <Link
                            to={`/database-models/${status.data?.model_id ?? database?.model_id}/migrations`}
                            className="font-medium text-primary hover:underline"
                          >
                            Ir al blueprint a revisar el baseline →
                          </Link>
                        )}
                      </div>
                    )}

                    {/* Resultado del último apply real: results[] + reconciliación (§9) */}
                    {lastRun && (
                      <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-foreground">
                            Resultado del último apply
                          </h3>
                          <IconButton
                            label="Descartar"
                            icon={<XIcon />}
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setLastRun(null)}
                          />
                        </div>
                        {lastRun.results.length > 0 ? (
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                  <th className="px-2 py-1.5 font-medium">Versión</th>
                                  <th className="px-2 py-1.5 font-medium">Estado</th>
                                  <th className="px-2 py-1.5 font-medium">ms</th>
                                  <th className="px-2 py-1.5 font-medium">Detalle</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {lastRun.results.map((item) => (
                                  <tr key={item.migration_id}>
                                    <td className="px-2 py-1.5">
                                      <code className="rounded bg-surface-muted px-1.5 py-0.5">
                                        {item.version}
                                      </code>
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <Badge tone={item.status === 'applied' ? 'success' : 'error'}>
                                        {item.status}
                                      </Badge>
                                    </td>
                                    <td className="px-2 py-1.5 text-muted-foreground">
                                      {item.execution_ms ?? '—'}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {item.resumed && (
                                          <Badge tone="info">
                                            retomada desde sentencia{' '}
                                            {item.resumed_from_statement ?? '?'}
                                          </Badge>
                                        )}
                                        {item.failed_at_statement_index != null && (
                                          <Badge tone="error">
                                            falló en sentencia {item.failed_at_statement_index}
                                            {item.statement_total != null
                                              ? ` de ${item.statement_total}`
                                              : ''}
                                          </Badge>
                                        )}
                                        {item.error && (
                                          <span className="text-error">{item.error}</span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Sin resultados por migración.
                          </p>
                        )}

                        {lastRun.reconciliation?.fully_reconciled && (
                          <p className="rounded-lg border border-success/40 bg-success/5 p-2 text-xs text-foreground">
                            La migración {lastRun.reconciliation.version} falló, pero el sistema
                            deshizo automáticamente los cambios aplicados (
                            {lastRun.reconciliation.undone_count} sentencia(s)). La base volvió a la
                            versión anterior sin intervención necesaria. Corrige la migración y
                            reintenta.
                          </p>
                        )}
                        {lastRun.reconciliation && !lastRun.reconciliation.fully_reconciled && (
                          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs">
                            <p className="text-foreground">
                              {lastRun.reconciliation.attempted
                                ? `La reconciliación automática de ${lastRun.reconciliation.version} deshizo ${lastRun.reconciliation.undone_count} de ${lastRun.reconciliation.statements_to_undo} sentencia(s), pero quedó incompleta.`
                                : `La migración ${lastRun.reconciliation.version} falló y la reconciliación automática no se intentó.`}
                            </p>
                            {lastRun.reconciliation.error && (
                              <p className="text-error">{lastRun.reconciliation.error}</p>
                            )}
                            {lastRun.reconciliation.unreversible_statements.length > 0 && (
                              <p className="text-muted-foreground">
                                Sin reverso conocido (quedaron aplicadas):{' '}
                                <code className="break-all">
                                  {lastRun.reconciliation.unreversible_statements.join(' · ')}
                                </code>
                              </p>
                            )}
                            {lastRun.reconciliation.unconfirmed_reverses.length > 0 && (
                              <p className="text-muted-foreground">
                                Aviso — reversos ejecutados no demostrablemente seguros:{' '}
                                <code className="break-all">
                                  {lastRun.reconciliation.unconfirmed_reverses.join(' · ')}
                                </code>
                              </p>
                            )}
                            <p className="text-muted-foreground">
                              Revisa el aviso de aplicación parcial de arriba para reconciliar lo
                              pendiente.
                            </p>
                          </div>
                        )}
                        {lastRun.failed &&
                          !lastRun.reconciliation &&
                          (status.isFetching ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Spinner className="h-3.5 w-3.5" /> Verificando si quedó una
                              aplicación parcial…
                            </div>
                          ) : hasPartial ? (
                            <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
                              El apply falló y dejó una <strong>aplicación parcial</strong>: revisa
                              el aviso de arriba para reconciliarla o retomar del checkpoint.
                            </p>
                          ) : (
                            <p className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
                              El apply falló sin dejar una aplicación parcial registrada; corrige la
                              migración y reintenta.
                            </p>
                          ))}
                      </section>
                    )}

                    {/* Rollback secuencial */}
                    <section className="flex flex-col gap-3 rounded-lg border border-error/30 p-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Rollback (destructivo)
                      </h3>
                      {hasPartial && (
                        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                          <p className="text-foreground">
                            Hay una <strong>aplicación parcial</strong> pendiente: el rollback está
                            bloqueado (el backend respondería <code>409</code>) porque el estado
                            físico no coincide con ninguna versión registrada.
                          </p>
                          {firstReconcilable && !isArchived && (
                            <div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setReconcileTarget(firstReconcilable)}
                              >
                                Reconciliar primero…
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          label="Confirma la versión actual"
                          hint="Debe coincidir con la versión actual (doble confirmación)."
                          placeholder={currentVersion ?? 'sin versión actual'}
                          value={confirmVersion}
                          onChange={(event) => setConfirmVersion(event.target.value)}
                        />
                        <Input
                          label="Revertir hasta (opcional)"
                          hint="Versión destino, anterior a la actual. Vacío = solo la última."
                          placeholder="p. ej. 0007"
                          value={rollbackTarget}
                          onChange={(event) => setRollbackTarget(event.target.value)}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Revierte secuencialmente en una sola llamada; requiere <code>down_sql</code>{' '}
                        confirmado en cada versión del camino (si falta, responde <code>409</code>).
                      </p>
                      {missingDownSql && missingDownSql.length > 0 && (
                        <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-3 text-xs">
                          <p className="text-foreground">
                            Falta confirmar el <code>down_sql</code> de la(s) versión(es){' '}
                            <strong>{missingDownSql.join(', ')}</strong> antes de poder revertir.
                          </p>
                          {database?.model_id && (
                            <Link
                              to={`/database-models/${database.model_id}/migrations`}
                              className="font-medium text-primary hover:underline"
                            >
                              Ir al blueprint a confirmarlas →
                            </Link>
                          )}
                        </div>
                      )}
                      <div className="flex justify-end">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={!canRollback}
                          isLoading={rollback.isPending}
                          onClick={() =>
                            rollback.mutate(
                              {
                                confirmVersion,
                                targetVersion: rollbackTarget.trim() || undefined,
                              },
                              {
                                onSuccess: () => {
                                  setConfirmVersion('')
                                  setRollbackTarget('')
                                  setMissingDownSql(null)
                                },
                                onError: (err) => {
                                  const apiError = toApiError(err)
                                  setMissingDownSql(
                                    apiError.status === 409 && apiError.missingDownSql
                                      ? apiError.missingDownSql
                                      : null,
                                  )
                                },
                              },
                            )
                          }
                        >
                          Revertir
                        </Button>
                      </div>
                    </section>

                    {/* Stamp (marca una versión sin ejecutar SQL) */}
                    <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Marcar versión (stamp)
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Marca la BD en una versión del blueprint <strong>sin ejecutar SQL</strong>.
                        Útil para una BD pre-existente cuyo esquema ya coincide con esa versión.
                      </p>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={openStamp}
                          disabled={stamp.isPending}
                        >
                          Marcar versión (stamp)…
                        </Button>
                      </div>
                    </section>
                  </>
                )}
              </div>
            )}

            {tab === 'history' && <MigrationHistoryPanel dbId={dbId} enabled={open} />}
          </div>
        )}
      </Modal>

      {/* Diálogo de stamp (Cambio 4): selector de versión + confirmación con aviso */}
      <Modal
        open={stampOpen}
        onClose={() => {
          if (!stamp.isPending) setStampOpen(false)
        }}
        title="Marcar versión (stamp)"
        description={database ? `«${database.name}» (#${database.id})` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStampOpen(false)} disabled={stamp.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={confirmStamp}
              isLoading={stamp.isPending}
              disabled={!stampValid || stampCooldown}
            >
              Marcar versión
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {versionItems.length > 0 ? (
            <Combobox<ModelMigrationSummary>
              items={versionItems}
              value={selectedStampVersion}
              onChange={(m) => setStampVersion(m?.version ?? '')}
              itemToString={(m) => `${m.version} · ${m.name}`}
              itemToKey={(m) => m.id}
              label="Versión a marcar"
              placeholder="Selecciona una versión del blueprint…"
              isLoading={versions.isLoading}
            />
          ) : (
            <Input
              label="Versión a marcar"
              placeholder="p. ej. 0002"
              hint="Patrón del backend: solo dígitos, 4–10."
              value={stampVersion}
              onChange={(event) => setStampVersion(event.target.value)}
              error={stampVersion && !stampValid ? 'Solo dígitos, 4–10 (ej. 0002).' : undefined}
            />
          )}
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
            El stamp <strong>no ejecuta SQL</strong>: solo marca la versión en el motor. Úsalo solo
            si el esquema de la BD ya coincide con esa versión.
          </p>
          <Switch
            checked={stampForce}
            onCheckedChange={setStampForce}
            label="Forzar (force)"
            disabled={hasPartial}
            hint={
              hasPartial
                ? 'Bloqueado: hay una aplicación parcial pendiente; usa primero «Reconciliar» (reconcile-partial).'
                : 'Solo si ya reconciliaste el estado físico de la BD a mano.'
            }
          />
          {stampForce && (
            <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
              <strong>stamp force NO arregla un apply fallido a mitad</strong>: afirmaría que la
              migración corrió completa y un rollback posterior partiría de un estado que nunca
              existió (un tercer estado inconsistente). Úsalo únicamente si ya reconciliaste el
              estado físico a mano y la BD coincide de verdad con esa versión.
            </p>
          )}
          {stampCooldown && (
            <p className="rounded-lg border border-error/40 bg-error/5 p-2 text-xs text-error">
              Has alcanzado el límite de 10/min. Espera unos segundos e inténtalo de nuevo.
            </p>
          )}
        </div>
      </Modal>

      {/* Flujo de reconciliación (§9): montado condicionalmente para estado fresco por entrada */}
      {reconcileTarget && database && (
        <ReconcilePartialDialog
          dbId={dbId}
          databaseName={database.name}
          entry={reconcileTarget}
          onClose={() => setReconcileTarget(null)}
        />
      )}
    </>
  )
}

function MigrationHistoryPanel({ dbId, enabled }: { dbId: number; enabled: boolean }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, error, refetch } = useMigrationHistory(
    dbId,
    { page, size: 10 },
    enabled,
  )

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando historial…
      </div>
    )
  }
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />
  if ((data?.items.length ?? 0) === 0) {
    return <EmptyState title="Sin historial de aplicaciones" />
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
        {data?.items.map((entry) => (
          <li key={entry.id} className="flex items-center justify-between gap-2 p-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  {entry.version}
                </code>{' '}
                {formatDateTime(entry.applied_at)}
              </span>
              {entry.error && <span className="text-xs text-error">{entry.error}</span>}
            </div>
            <div className="flex items-center gap-2">
              {entry.execution_ms != null && (
                <span className="text-xs text-muted-foreground">{entry.execution_ms} ms</span>
              )}
              <Badge tone={entry.status === 'applied' ? 'success' : 'error'}>{entry.status}</Badge>
            </div>
          </li>
        ))}
      </ul>
      {data && data.pagination.pages > 1 && (
        <Pagination
          page={data.pagination.page}
          pages={data.pagination.pages}
          total={data.pagination.total}
          size={data.pagination.size}
          hasNext={data.pagination.has_next}
          hasPrev={data.pagination.has_prev}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
