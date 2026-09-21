import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCapabilities } from '@/features/auth'
import { CAPABILITIES } from '@/lib/contracts'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  Combobox,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Switch,
  TabButton,
  XIcon,
} from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  isDryRunResult,
  MIGRATION_VERSION_PATTERN,
  type MigrationApplyResult,
  type MigrationRollbackResult,
  type ModelMigrationSummary,
  type OnFailureMode,
  type PartialApplicationEntry,
} from '@/lib/contracts'
import { useAllModelMigrations } from '@/features/database-models/hooks/use-model-migrations'
import { OnFailureSelect } from '@/features/database-models/components/OnFailureSelect'
import { splitCaptureVersions } from '@/features/database-models/capture'
import { hasResolvablePartial, isPartialResolvable } from '../partial-application'
import { useManagedDatabase } from '../hooks/use-managed-databases'
import {
  useApplyMigrations,
  useMigrationStatus,
  useRollbackMigration,
  useStampMigration,
} from '../hooks/use-db-migrations'
import { ProvisionStatusBadge } from './ProvisionStatusBadge'
import { ProvisionDatabaseDialog } from './ProvisionDatabaseDialog'
import { historyStatusSpec } from '../history-badges'
import { MigrationHistoryPanel } from './MigrationHistoryPanel'
import { ReconcilePartialSection } from './ReconcilePartialSection'

/** Motivo único para los `title` de los controles que el backend rechazaría con 409. */
const NOT_PROVISIONED_HINT =
  'La base de datos no existe en el motor: aprovisionala antes de operar migraciones.'

/**
 * Motivo único del bloqueo por contabilidad huérfana.
 *
 * Va como TEXTO VISIBLE junto a cada control deshabilitado, no solo como `title`: un `title` no
 * llega por teclado ni existe en táctil, así que el único lector al que le explicaría el bloqueo
 * es el que ya tiene el ratón encima. El `title` se pone además, no en vez de.
 */
const ORPHAN_BLOCK_REASON =
  'Bloqueado: la contabilidad de versiones de esta base está fuera de sitio.'

/**
 * Aviso dominante entre los tres que pueden coexistir en esta pantalla.
 *
 * `database_exists: false`, `has_orphan_accounting: true` y `has_partial_application: true` son
 * independientes en el contrato, así que los tres pueden venir a la vez. Mostrarlos juntos no es
 * «más información»: es tres diagnósticos contradictorios peleando por la misma decisión.
 */
type DominantBanner = 'not-provisioned' | 'orphan-accounting' | 'partial' | null

const TABS = ['actions', 'history'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

/**
 * Contenido de migraciones sobre una BD gestionada (§9 / Plan 09 §7-bis): estado, actualizar a la
 * última en un clic, ir a una versión concreta, rollback secuencial, stamp, reconciliación de
 * aplicaciones parciales e historial 🔌.
 *
 * Se extrajo de `ManagedDatabaseMigrationsPage` (que ahora es un wrapper delgado sobre
 * `:databaseId`) para poder montarlo también como pestaña `migrations` de la ficha unificada de
 * `ServerDatabaseDetailPage`, que ya resolvió el `id` de inventario vía `managed.id` — de ahí que
 * reciba `databaseId` por props en vez de leerlo de la URL.
 *
 * Fue un modal hasta que el flujo creció a cuatro fases con diálogos apilados dentro de 672 px;
 * como bloque a todo el ancho cada fase tiene sitio y el estado navegable (pestaña, versión en
 * reconciliación) vive en la URL, así que se puede enlazar y recargar sin perderlo.
 */
export function ManagedDatabaseMigrationsContent({ databaseId }: { databaseId: number }) {
  // Pestaña y objetivo de reconciliación viven en la URL, no en estado local: así se enlaza
  // directamente al historial o a una reconciliación concreta, y «cerrar» es quitar el parámetro.
  const canSeeCaptures = useCapabilities().can(CAPABILITIES.blueprintsCaptures)
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'actions'
  const reconcileVersion = searchParams.get('reconcile')
  /**
   * Precarga del stamp desde el informe de contabilidad del blueprint (`?stamp=<version>`).
   *
   * Se valida contra el patrón del backend antes de aceptarla: la URL la escribe quien sea, y una
   * versión inventada abriría el diálogo con un valor que el POST rechazaría con 422. Si no pasa
   * el patrón, la precarga simplemente no existe.
   */
  const stampParam = searchParams.get('stamp')?.trim() ?? ''
  const preloadedStamp = MIGRATION_VERSION_PATTERN.test(stampParam) ? stampParam : null

  const [applyVersion, setApplyVersion] = useState('')
  const [force, setForce] = useState(false)
  // `on_failure` (§9): compartido por "actualizar" e "ir a una versión" (solo MySQL/MariaDB).
  const [onFailure, setOnFailure] = useState<OnFailureMode>('auto')
  const [preview, setPreview] = useState<MigrationApplyResult | null>(null)
  // Resultado del último apply REAL (no dry-run): tabla de `results[]` + reconciliación.
  const [lastRun, setLastRun] = useState<MigrationApplyResult | null>(null)
  const [lastRollback, setLastRollback] = useState<MigrationRollbackResult | null>(null)
  // Mensaje del 409 del gate R1 (baseline de snapshot sin revisar) para el CTA al blueprint.
  const [baselineGateMsg, setBaselineGateMsg] = useState<string | null>(null)
  /**
   * Rechazo del guard de entorno (409 `environment.destructive_blocked`).
   *
   * El guard del backend cubre los DOS entrypoints —el apply masivo y este—, así que sin
   * clasificarlo acá el 409 caía como un error rojo genérico justo en el camino más
   * peligroso: «Aplicar» desde la cabecera no pasa por ningún dry-run intermedio. Esta
   * página ya tenía la maquinaria exacta para esto (`baselineGateMsg`, `captureGate`), así
   * que el código nuevo encaja uno a uno.
   */
  const [environmentGate, setEnvironmentGate] = useState<{
    slug: string | null
    versions: string[]
  } | null>(null)
  // 409 de captura sin revisar / falta de consentimiento (api-reference-v9 §3.0), compartido por
  // apply y rollback: `public_context.unreviewed_capture` (contrato v13 §2).
  const [captureGate, setCaptureGate] = useState<{
    versions: string[]
    message: string
  } | null>(null)
  const [confirmVersion, setConfirmVersion] = useState('')
  const [rollbackTarget, setRollbackTarget] = useState('')
  // Versiones sin `down_sql` confirmado devueltas por el 409 (`public_context.missing_down_sql`).
  const [missingDownSql, setMissingDownSql] = useState<string[] | null>(null)
  // El estado inicial del diálogo se DERIVA de la URL en el inicializador de `useState`, no en un
  // efecto: un `setState` síncrono dentro de `useEffect` está prohibido en este repo (y
  // `react-hooks` v7 lo marca como error), y además pintaría un fotograma con el diálogo cerrado.
  const [stampVersion, setStampVersion] = useState(() => preloadedStamp ?? '')
  const [stampForce, setStampForce] = useState(false)
  /**
   * `purge` (v25): vacía la tabla de versión ANTES de escribir el puntero nuevo.
   *
   * Vive junto a `stampForce` porque el backend solo lo acepta acompañado de `force` (si no,
   * responde 422). La UI no debe llegar ahí: el interruptor está deshabilitado sin `force`, y al
   * apagar `force` se apaga también este.
   */
  const [stampPurge, setStampPurge] = useState(false)
  const [stampOpen, setStampOpen] = useState(() => preloadedStamp !== null)
  // 422 sin `public_context.code`: el único camino conocido es purge sin force, que esta UI ya
  // impide. Si aun así llega, el mensaje del backend se muestra tal cual dentro del diálogo —el
  // toast del hook se va solo y el diálogo sigue abierto sin explicar por qué no pasó nada.
  const [stampFallbackError, setStampFallbackError] = useState<string | null>(null)
  // 409 de captura sin revisar al stampear (api-reference-v9 §3.4): `force` NO habilita la
  // captura, solo permite marcar el puntero de versión igual.
  const [stampUnreviewedCapture, setStampUnreviewedCapture] = useState<string[] | null>(null)
  // Tras un 429 (rate limit 10/min) bloqueamos el botón de stamp unos segundos (Item 9).
  const [stampCooldown, setStampCooldown] = useState(false)
  // Última entrada parcial vista para el `?reconcile=` actual: al ejecutar la reconciliación el
  // backend la borra de `partial_application[]`, y sin conservarla la sección se desmontaría justo
  // al terminar, llevándose el resultado que el admin necesita leer.
  const [seenEntry, setSeenEntry] = useState<PartialApplicationEntry | null>(null)
  // La BD llega como snapshot: tras un stamp exitoso reflejamos error→active localmente sin esperar
  // al refetch del detalle (el estado real ya se invalidó).
  const [recovered, setRecovered] = useState(false)
  // Diálogo de aprovisionamiento para el caso «la base no existe en el motor».
  const [provisionOpen, setProvisionOpen] = useState(false)

  const db = useManagedDatabase(databaseId, true)
  const modelId = db.data?.model_id ?? 0
  const hasModel = modelId > 0

  const status = useMigrationStatus(databaseId, hasModel)
  const apply = useApplyMigrations(databaseId)
  const rollback = useRollbackMigration(databaseId)
  const stamp = useStampMigration(databaseId)
  // Catálogo de versiones del blueprint para poblar el selector del stamp (Cambio 4).
  //
  // COMPLETO, no una página: el stamp tiene que poder apuntar a cualquier versión, y con una
  // sola página ordenada ascendente un blueprint largo dejaba fuera justamente la punta —o sea
  // que no se podía stampear a la versión actual, que es el caso más habitual—.
  const versions = useAllModelMigrations(modelId, hasModel)

  if (db.isLoading) return <FullPageSpinner label="Cargando base de datos" />
  if (db.isError || !db.data) {
    return <ErrorState error={db.error} onRetry={() => void db.refetch()} />
  }

  const database = db.data
  const currentVersion = status.data?.current_version ?? null
  const latest = status.data?.latest_available ?? null
  const pendingCount = status.data?.pending_count ?? 0
  // Aplicación parcial (§9): la versión más alta primero; se resuelven de mayor a menor.
  const hasPartial = status.data?.has_partial_application ?? false
  const partialEntries = [...(status.data?.partial_application ?? [])].sort(
    (a, b) => Number(b.version) - Number(a.version),
  )
  // RESOLUBLE = el gateway puede deshacerlo por sí mismo, con `force` o sin él (la regla y
  // el porqué viven en `../partial-application`).
  const firstResolvable = partialEntries.find(isPartialResolvable) ?? null
  const hasAutomaticWayOut = hasResolvablePartial(partialEntries)
  const canRollback = confirmVersion.length > 0 && confirmVersion === currentVersion && !hasPartial

  const isQuarantined = database.status === 'error' && !recovered
  // La BD figura en el inventario pero NO existe en el motor: registrada sin aprovisionar, o
  // borrada por fuera. Se lee del backend (plano físico) y no del `status` de la fila, que está
  // rancio en las dos direcciones. Mientras dure, `pending_count` cuenta TODAS las versiones del
  // blueprint: pintarlo sin este aviso haría creer que hay trabajo pendiente cuando lo que falta
  // es la base. Todo lo que ejecuta responde 409, así que se deshabilita en la UI.
  const notProvisioned = status.data?.database_exists === false
  /**
   * Contabilidad huérfana (v25): la versión real vive en una tabla `_gw_v_*` que el gateway NO
   * está leyendo, así que `pending_versions` NO es de fiar —lista todo como pendiente— y aplicar
   * desde acá reejecutaría migraciones que esta base ya tiene. Bloquea apply y rollback; el stamp
   * sigue habilitado porque es la vía de salida.
   */
  const hasOrphanAccounting = status.data?.has_orphan_accounting ?? false
  const orphanTables = status.data?.orphan_version_tables ?? []
  const cachedVersion = status.data?.cached_version ?? null
  /**
   * Orden fijo, de más a menos dominante: sin base no hay nada que diagnosticar, y la contabilidad
   * huérfana invalida la lectura sobre la que se juzga la aplicación parcial (los contadores de
   * los que sale «hay una parcial» salen de la tabla equivocada).
   */
  const pickDominantBanner = (): DominantBanner => {
    if (notProvisioned) return 'not-provisioned'
    if (hasOrphanAccounting) return 'orphan-accounting'
    if (hasPartial && partialEntries.length > 0) return 'partial'
    return null
  }
  const dominantBanner = pickDominantBanner()
  // Una BD archivada es de solo lectura: se ocultan las acciones que tocan el motor (Item 11).
  const isArchived = database.status === 'archived'
  const effectiveStatus = recovered ? 'active' : database.status
  const versionItems = versions.data?.items ?? []
  const selectedStampVersion = versionItems.find((m) => m.version === stampVersion) ?? null
  const stampValid = MIGRATION_VERSION_PATTERN.test(stampVersion.trim())
  /**
   * El desplegable solo sirve mientras la versión elegida esté en el catálogo del blueprint.
   *
   * Con una precarga de contabilidad huérfana puede NO estarlo —ese es justamente el caso «Can't
   * locate revision»—, y un `Combobox` con un valor que no figura entre sus opciones se pinta
   * vacío: la pantalla diría «no elegiste nada» mientras el POST manda una versión. En ese caso
   * se cae al campo de texto, que sí muestra lo que se va a enviar. Es derivado, no estado: por
   * el desplegable solo entran versiones del catálogo, así que no puede cambiar mientras se usa.
   */
  const stampVersionInCatalog = versionItems.some((m) => m.version === stampVersion)
  const useStampCombobox = versionItems.length > 0 && (stampVersion === '' || stampVersionInCatalog)
  // Captura de SELECT: aviso PROACTIVO, acotado a las versiones PENDIENTES de ESTA base. El
  // predicado es compartido con el diálogo del lote (`features/database-models/capture`): estaba
  // duplicado y las dos copias divergieron en el borde de `reviewed === undefined`, con el
  // resultado de que acá el aviso no aparecía nunca contra un backend que no devuelve el campo.
  const { willCapture: captureWillRun, blockedByReview: captureBlocked } = splitCaptureVersions(
    versionItems,
    { only: status.data?.pending_versions },
  )

  // Ajuste de estado en render (no en efecto): memoriza la entrada mientras siga en el estado.
  const matchedEntry = reconcileVersion
    ? (partialEntries.find((entry) => entry.version === reconcileVersion) ?? null)
    : null
  if (matchedEntry && matchedEntry !== seenEntry) setSeenEntry(matchedEntry)
  const reconcileEntry = reconcileVersion
    ? (matchedEntry ?? (seenEntry?.version === reconcileVersion ? seenEntry : null))
    : null

  const updateParams = (mutate: (next: URLSearchParams) => void) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      mutate(next)
      return next
    })
  }
  const setTab = (value: Tab) => updateParams((next) => next.set('tab', value))
  const openReconcile = (version: string) => updateParams((next) => next.set('reconcile', version))
  const closeReconcile = () => {
    setSeenEntry(null)
    updateParams((next) => next.delete('reconcile'))
  }

  const openStamp = () => {
    setStampVersion('')
    setStampForce(false)
    setStampPurge(false)
    setStampUnreviewedCapture(null)
    setStampFallbackError(null)
    setStampOpen(true)
  }

  /**
   * Cierra el diálogo y consume la precarga.
   *
   * El `?stamp=` es de un solo uso: si sobreviviera al cierre, recargar la página o volver atrás
   * reabriría el diálogo con una versión ya elegida, que es justo lo que nadie espera de una
   * pantalla que acaba de cerrar.
   */
  const closeStamp = () => {
    setStampOpen(false)
    if (searchParams.has('stamp')) updateParams((next) => next.delete('stamp'))
  }

  /** Apagar `force` apaga `purge`: el backend responde 422 si llega purge sin force. */
  const changeStampForce = (value: boolean) => {
    setStampForce(value)
    if (!value) setStampPurge(false)
  }

  const confirmStamp = () => {
    stamp.mutate(
      {
        version: stampVersion.trim(),
        force: stampForce || undefined,
        purge: stampPurge || undefined,
      },
      {
        onSuccess: () => {
          closeStamp()
          setStampVersion('')
          setStampForce(false)
          setStampPurge(false)
          setStampUnreviewedCapture(null)
          setStampFallbackError(null)
          // Un stamp saca a la BD de cuarentena (error→active); lo reflejamos en la UI.
          if (database.status === 'error') setRecovered(true)
        },
        onError: (err) => {
          const apiError = toApiError(err)
          // 429: superó el límite de 10/min. Bloqueamos el botón unos segundos (el hook ya avisa).
          if (apiError.status === 429) {
            setStampCooldown(true)
            window.setTimeout(() => setStampCooldown(false), 15_000)
          }
          // 409 de captura sin revisar (api-reference-v9 §3.4): `force=true` NO habilita la
          // captura, solo permite marcar el puntero de versión igual (defensa en profundidad).
          setStampUnreviewedCapture(
            apiError.status === 409 && apiError.unreviewedCapture
              ? apiError.unreviewedCapture
              : null,
          )
          // 422 sin código estable: no hay nada que traducir a una salida concreta, así que se
          // muestra el mensaje del backend tal cual en vez de inventar un diagnóstico.
          setStampFallbackError(apiError.status === 422 && !apiError.code ? apiError.message : null)
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

  /**
   * 409 `environment.destructive_blocked`: el entorno de esta base prohíbe las destructivas.
   *
   * Se clasifica por CÓDIGO (`public_context.code`), no por la prosa del mensaje — a diferencia
   * de `isBaselineGate409`, que tiene que reconocer el texto porque aquel 409 no expone código.
   * Los datos estructurados también vienen en `public_context`, así que no hay que parsear nada.
   */
  const readEnvironmentGate409 = (
    err: unknown,
  ): { slug: string | null; versions: string[] } | null => {
    const apiError = toApiError(err)
    if (apiError.status !== 409 || apiError.code !== 'environment.destructive_blocked') return null
    return {
      slug: apiError.environmentContext?.environmentSlug ?? null,
      versions: apiError.environmentContext?.blockedVersions ?? [],
    }
  }

  /**
   * 409 de captura SIN REVISAR (contrato v13 §2). Ya no hay variante de "falta consentimiento":
   * ese gate se retiró, así que la única causa posible es que la versión no esté aprobada — y
   * eso tiene una salida concreta (aprobarla en el blueprint), no un checkbox.
   */
  const readCaptureGate409 = (err: unknown): { versions: string[]; message: string } | null => {
    const apiError = toApiError(err)
    if (apiError.status !== 409) return null
    if (apiError.unreviewedCapture) {
      return { versions: apiError.unreviewedCapture, message: apiError.message }
    }
    return null
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
          setEnvironmentGate(null)
          if (isDryRunResult(result)) {
            setPreview(result)
          } else {
            setPreview(null)
            setLastRun(result)
            setCaptureGate(null)
          }
        },
        onError: (err) => {
          setBaselineGateMsg(isBaselineGate409(err))
          setCaptureGate(readCaptureGate409(err))
          setEnvironmentGate(readEnvironmentGate409(err))
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/managed-databases"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Bases de datos
          </Link>
          <Link
            to={`/servers/${database.server_id}/databases/${encodeURIComponent(database.name)}?tab=migrations`}
            className="text-sm text-primary hover:underline"
          >
            Ver ficha completa de la base de datos →
          </Link>
        </div>
        <PageHeader
          title={database.name}
          description="Aplica, revierte y marca versiones del blueprint sobre esta base de datos real. Las acciones marcadas con 🔌 ejecutan SQL en el motor."
          actions={
            hasModel && !isArchived ? (
              <>
                <Button
                  variant="outline"
                  onClick={openStamp}
                  disabled={stamp.isPending || notProvisioned}
                  title={notProvisioned ? NOT_PROVISIONED_HINT : undefined}
                >
                  Marcar versión (stamp)…
                </Button>
                <div className="flex flex-col items-end gap-1">
                  <Button
                    isLoading={apply.isPending}
                    disabled={pendingCount === 0 || notProvisioned || hasOrphanAccounting}
                    title={
                      notProvisioned
                        ? NOT_PROVISIONED_HINT
                        : hasOrphanAccounting
                          ? ORPHAN_BLOCK_REASON
                          : undefined
                    }
                    onClick={() => runApply({ dryRun: false })}
                  >
                    {/* En la cabecera el botón se lee antes que el estado: mientras se carga no
                        puede afirmar «ya está al día», que aún no se sabe. Y con la base sin
                        crear tampoco: hay pendientes, pero no hay dónde aplicarlas. Con la
                        contabilidad huérfana tampoco puede prometer «a la última»: no se sabe
                        cuál es la actual. */}
                    {status.isLoading
                      ? 'Comprobando estado…'
                      : notProvisioned
                        ? 'La base no existe en el motor'
                        : hasOrphanAccounting
                          ? 'Actualizar (bloqueado)'
                          : pendingCount === 0
                            ? 'Ya está al día'
                            : `Actualizar a la última${latest ? ` (${latest})` : ''} 🔌`}
                  </Button>
                  {hasOrphanAccounting && (
                    <p className="max-w-xs text-right text-xs text-error">{ORPHAN_BLOCK_REASON}</p>
                  )}
                </div>
              </>
            ) : undefined
          }
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ProvisionStatusBadge status={effectiveStatus} />
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            #{database.id}
          </code>
          {hasModel && (
            <Link
              to={`/database-models/${modelId}/migrations`}
              className="text-xs font-medium text-primary hover:underline"
            >
              Ver el blueprint →
            </Link>
          )}
        </div>
      </div>

      {!hasModel ? (
        <EmptyState
          title="Sin blueprint asignado"
          description="Asigna un blueprint (model_id) a esta base de datos para gestionar sus migraciones."
        />
      ) : (
        <>
          <div className="flex gap-1 border-b border-border" role="tablist">
            <TabButton active={tab === 'actions'} onClick={() => setTab('actions')}>
              Estado y acciones
            </TabButton>
            <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
              Historial
            </TabButton>
          </div>

          {tab === 'actions' && (
            <div className="flex flex-col gap-6">
              {/* La base no existe en el motor: es la causa raíz más frecuente de que esta
                  pantalla no sirva para nada, y hasta ahora se manifestaba como un 404 opaco
                  («El recurso solicitado no existe en el servidor destino») sin decir qué
                  hacer. Va PRIMERO porque bloquea todo lo demás. */}
              {dominantBanner === 'not-provisioned' && (
                <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-sm font-semibold text-foreground">
                      La base de datos no existe en el motor
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Está registrada en el inventario pero nunca se creó en el servidor (o la
                      borraron por fuera del gateway). Hasta que se aprovisione no hay dónde
                      aplicar, revertir ni marcar versiones, y el contador de pendientes lista todas
                      las del blueprint porque ninguna pudo aplicarse.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setProvisionOpen(true)}>
                      Aprovisionar ahora 🔌
                    </Button>
                  </div>
                </div>
              )}

              {/* Recuperación de cuarentena (Cambio 4) */}
              {isQuarantined && (
                <div className="flex flex-col gap-3 rounded-lg border border-error/40 bg-error/5 p-4">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-sm font-semibold text-foreground">En cuarentena</h2>
                    <p className="text-xs text-muted-foreground">
                      Esta base quedó en cuarentena por un apply fallido. Si el esquema ya coincide
                      con el baseline, márcala con un stamp para recuperarla; si no, reintenta el
                      apply forzando la cuarentena.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/*
                      🔴 Este botón también se bloquea con la contabilidad huérfana, y es el que
                      MÁS importa de los cinco, porque es el que aparece justo al final de la
                      secuencia del incidente: renombrar el slug deja la contabilidad huérfana →
                      la cadena entera figura pendiente → alguien aplica → el motor falla con
                      «ya existen las tablas» → la base queda en `error` y se pinta este banner.
                      O sea que el operador llega hasta acá **por culpa** de la contabilidad rota,
                      y se encontraba con un botón habilitado que reejecuta el MISMO apply, ahora
                      con `force: true`, sobre la MISMA lista falsa. El banner de cuarentena se
                      evalúa fuera de `pickDominantBanner`, así que convivía con el de huérfana
                      sin que ninguno de los dos supiera del otro.
                    */}
                    <Button
                      variant="outline"
                      size="sm"
                      isLoading={apply.isPending}
                      disabled={hasOrphanAccounting || notProvisioned}
                      title={
                        hasOrphanAccounting
                          ? ORPHAN_BLOCK_REASON
                          : notProvisioned
                            ? NOT_PROVISIONED_HINT
                            : undefined
                      }
                      onClick={() =>
                        apply.mutate(
                          { force: true, dryRun: false, onFailure },
                          {
                            onSuccess: (result) => {
                              setPreview(null)
                              setLastRun(result)
                              setCaptureGate(null)
                              // Si el apply forzado no falló, la BD sale de cuarentena (error→active).
                              if (!result.failed && !result.quarantined) setRecovered(true)
                            },
                            onError: (err) => {
                              setBaselineGateMsg(isBaselineGate409(err))
                              setCaptureGate(readCaptureGate409(err))
                            },
                          },
                        )
                      }
                    >
                      Reintentar apply (force) 🔌
                    </Button>
                    {hasOrphanAccounting && (
                      <p className="basis-full text-xs text-error">{ORPHAN_BLOCK_REASON}</p>
                    )}
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

              {/* Contabilidad huérfana: va ARRIBA de los contadores porque es lo que decide si
                  esos contadores se pueden leer siquiera. */}
              {dominantBanner === 'orphan-accounting' && (
                <Callout
                  tone="danger"
                  title="La contabilidad de versiones de esta base está fuera de sitio."
                  action={
                    <>
                      <Link
                        to={`/database-models/${modelId}/migrations?tab=contabilidad`}
                        className="inline-flex min-h-8 select-none items-center justify-center gap-1.5 rounded-lg border border-input bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        Ver el informe del blueprint
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={openStamp}
                        disabled={stamp.isPending || isArchived}
                      >
                        Recuperar con stamp…
                      </Button>
                    </>
                  }
                >
                  <p>
                    La versión real de esta base vive en una tabla que el gateway{' '}
                    <strong>no está leyendo</strong>, así que la lista de pendientes{' '}
                    <strong>no es de fiar</strong>: figuran todas como pendientes sin estarlo, y
                    aplicar desde acá reejecutaría migraciones que esta base ya tiene.
                  </p>
                  <p>
                    <span className="text-foreground">Tabla(s) que el gateway no lee:</span>{' '}
                    {orphanTables.length > 0 ? (
                      orphanTables.map((table, index) => (
                        <span key={table}>
                          {index > 0 && ' · '}
                          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                            {table}
                          </code>
                        </span>
                      ))
                    ) : (
                      <em>el gateway no devolvió ninguna</em>
                    )}
                  </p>
                  <p>
                    <span className="text-foreground">
                      Última versión que el inventario registró:
                    </span>{' '}
                    {cachedVersion !== null ? (
                      <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                        {cachedVersion}
                      </code>
                    ) : (
                      // Un `null` escondido se lee como «no pasa nada»: acá significa que el
                      // inventario nunca llegó a registrar una versión, que es un dato.
                      <em>ninguna — el inventario nunca registró una</em>
                    )}
                  </p>
                </Callout>
              )}

              {/* Estado */}
              {status.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Cargando estado…
                </div>
              ) : status.isError ? (
                <ErrorState error={status.error} onRetry={() => void status.refetch()} />
              ) : status.data ? (
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-2 p-4">
                    {/* `actual` se SUSTITUYE por el mismo motivo que el contador, y no es un
                        detalle: `has_orphan_accounting: true` implica, por construcción de la
                        sonda del backend, que `current_version` viene `null`. O sea que este
                        badge diría «actual: ninguna» —que es FALSO: la versión está viva en la
                        tabla huérfana que el banner de arriba nombra— y, junto a «última: 0009»,
                        le sirve al operador las dos premisas para que reconstruya solo la
                        conclusión del incidente («falta todo») sin que la pantalla la afirme.
                        Un `null` en azul se sigue leyendo como un dato. */}
                    {hasOrphanAccounting ? (
                      <Badge tone="error">actual: no se puede determinar</Badge>
                    ) : (
                      <Badge tone="info">actual: {currentVersion ?? 'ninguna'}</Badge>
                    )}
                    <Badge tone="neutral">última: {latest ?? '—'}</Badge>
                    {/* Con la contabilidad huérfana el contador se SUSTITUYE, no se decora: un
                        número tachado, en gris o con asterisco se sigue leyendo como número, y
                        este incidente empezó con alguien creyéndole a ese contador. La lista que
                        devolvió el gateway se conserva —es evidencia— pero plegada y rotulada
                        como no fiable, para que haya que ir a buscarla a propósito. */}
                    {hasOrphanAccounting ? (
                      <>
                        <Badge tone="error">Pendientes: no se puede determinar</Badge>
                        {status.data.pending_versions.length > 0 && (
                          <details className="basis-full rounded-lg border border-border p-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              Ver la lista que devolvió el gateway (no fiable)
                            </summary>
                            <p className="mt-2 break-all text-xs text-muted-foreground">
                              {status.data.pending_versions.join(', ')}
                            </p>
                          </details>
                        )}
                      </>
                    ) : (
                      <>
                        <Badge tone={pendingCount > 0 ? 'warning' : 'success'}>
                          {pendingCount} pendiente(s)
                        </Badge>
                        {status.data.pending_versions.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {status.data.pending_versions.join(', ')}
                          </span>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {/* Aplicación parcial (§9): sentencias ejecutadas sin registrar la versión */}
              {dominantBanner === 'partial' && (
                <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-sm font-semibold text-foreground">
                      Aplicación parcial detectada
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Una migración falló a mitad: hay sentencias ya ejecutadas en el motor sin que
                      la versión quedara registrada. El rollback está bloqueado hasta resolverlo.
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
                          {isPartialResolvable(entry) ? (
                            !isArchived && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={reconcileVersion === entry.version}
                                onClick={() => openReconcile(entry.version)}
                              >
                                {entry.reconcilable ? 'Reconciliar…' : 'Reconciliar (con force)…'}
                              </Button>
                            )
                          ) : (
                            <Badge tone="warning">sin reconciliación automática</Badge>
                          )}
                        </div>
                        {/* El motivo se muestra siempre que la vía normal no esté disponible,
                            incluido el caso reconciliable-con-force: es lo único que explica
                            por qué el botón pide force y qué queda sin deshacer. */}
                        {!entry.reconcilable && entry.reason && (
                          <p className="text-xs text-foreground">{entry.reason}</p>
                        )}
                        {!isPartialResolvable(entry) && (
                          <p className="text-xs text-muted-foreground">
                            No hay vía automática. Salidas: <strong>reintenta el apply</strong>{' '}
                            (retoma del checkpoint, desde la sentencia{' '}
                            {entry.applied_statements + 1}), o arregla el esquema a mano y declara
                            la versión con <strong>stamp force</strong> (abajo, en «Marcar
                            versión»).
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reconciliación (§9): `key` por versión para arrancar con estado fresco por entrada */}
              {reconcileEntry && (
                <ReconcilePartialSection
                  key={reconcileEntry.version}
                  dbId={databaseId}
                  entry={reconcileEntry}
                  onClose={closeReconcile}
                />
              )}

              {isArchived && (
                <div className="rounded-lg border border-border bg-surface-muted p-4 text-xs text-muted-foreground">
                  Esta base de datos está <strong>archivada</strong>: es de solo lectura. Puedes
                  consultar el estado y el historial, pero las acciones sobre el motor (actualizar,
                  revertir, stamp) están deshabilitadas.
                </div>
              )}

              {!isArchived && (
                <>
                  {/* AVISO, no control. Acá había un interruptor de consentimiento por
                      corrida; se retiró (contrato v13 §1). Además el aviso ahora se acota a las
                      versiones PENDIENTES de ESTA base: el interruptor aparecía por cualquier
                      versión aprobada del blueprint aunque esta BD ya la tuviera aplicada, y un
                      aviso que sale siempre deja de leerse. */}
                  {captureWillRun.length > 0 && (
                    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                      <p className="text-muted-foreground">
                        <strong className="text-foreground">
                          Esta corrida va a capturar resultados.
                        </strong>{' '}
                        Las versiones pendientes <strong>{captureWillRun.join(', ')}</strong>{' '}
                        guardan en el gateway el resultado de sus SELECT: filas de esta base de
                        datos, cifradas. Se conserva solo la corrida más reciente por versión y
                        caduca sola; al terminar podés verlas o purgarlas desde esta misma pantalla.
                      </p>
                    </div>
                  )}

                  {/* Distinto del anterior: esto NO va a pasar, va a ser rechazado con 409. */}
                  {captureBlocked.length > 0 && (
                    <div className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs">
                      <p className="text-muted-foreground">
                        <strong className="text-foreground">
                          Captura sin aprobar: {captureBlocked.join(', ')}
                        </strong>{' '}
                        — el apply y el rollback se van a rechazar hasta que revises qué consultan y
                        las apruebes.
                      </p>
                    </div>
                  )}

                  <div className="grid items-start gap-6 lg:grid-cols-2">
                    {/* Opciones del apply — el disparador vive en la cabecera (Plan 09 §7-bis) */}
                    <Card className="border-primary/30">
                      <CardContent className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <h2 className="text-sm font-semibold text-foreground">
                            Actualizar a la última
                          </h2>
                          <p className="text-xs text-muted-foreground">
                            <strong>Actualizar a la última{latest ? ` (${latest})` : ''}</strong>,
                            en la cabecera, aplica <strong>todas</strong> las migraciones pendientes
                            en orden y en una sola operación. Aquí se ajusta cómo se ejecuta y se
                            previsualiza el plan antes de tocar el motor.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          {/* El dry-run se bloquea con la contabilidad huérfana aunque NO escriba
                              nada, y esa es justamente la lección del incidente: el daño no fue la
                              escritura, fue la AFIRMACIÓN. Este plan se calcula sobre
                              `pending_versions`, que con el flag en `true` no es de fiar, así que
                              devolvería la lista completa —«0001, 0002, …»— con la autoridad
                              añadida de «esto es lo que el backend dice que va a pasar», dos
                              tarjetas debajo del banner que acaba de decir que no se puede
                              determinar. Un plan calculado sobre datos falsos no tiene valor
                              diagnóstico: para diagnosticar está el informe de /version-tables. */}
                          <Button
                            variant="outline"
                            size="sm"
                            isLoading={apply.isPending}
                            disabled={pendingCount === 0 || notProvisioned || hasOrphanAccounting}
                            title={
                              notProvisioned
                                ? NOT_PROVISIONED_HINT
                                : hasOrphanAccounting
                                  ? ORPHAN_BLOCK_REASON
                                  : undefined
                            }
                            onClick={() => runApply({ dryRun: true })}
                          >
                            Previsualizar (dry-run)
                          </Button>
                          {hasOrphanAccounting && (
                            <p className="basis-full text-xs text-error">{ORPHAN_BLOCK_REASON}</p>
                          )}
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
                        {/* Un preview pedido ANTES de que llegara el flag seguiría pintando
                            «Plan: 8 pendiente(s) · 0001, 0002…» debajo del bloqueo. Se retira
                            junto con el botón: la evidencia envenenada no se conserva «por si
                            acaso», porque acá lo que se conserva se cree. */}
                        {preview && !hasOrphanAccounting && (
                          <div className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
                            Plan: {preview.pending_versions.length} pendiente(s)
                            {preview.pending_versions.length > 0
                              ? ` · ${preview.pending_versions.join(', ')}`
                              : ' · nada que aplicar'}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Ir a una versión concreta (avanzado) */}
                    <Card>
                      <CardContent className="flex flex-col gap-3">
                        <h2 className="text-sm font-semibold text-foreground">
                          Ir a una versión concreta
                        </h2>
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
                            disabled={
                              applyVersion.trim().length === 0 ||
                              notProvisioned ||
                              hasOrphanAccounting
                            }
                            title={
                              notProvisioned
                                ? NOT_PROVISIONED_HINT
                                : hasOrphanAccounting
                                  ? ORPHAN_BLOCK_REASON
                                  : undefined
                            }
                            onClick={() =>
                              runApply({ version: applyVersion.trim(), dryRun: false })
                            }
                          >
                            Aplicar hasta esa versión 🔌
                          </Button>
                        </div>
                        {hasOrphanAccounting && (
                          <p className="text-xs text-error">{ORPHAN_BLOCK_REASON}</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Gate R1 (§9): 409 por baseline de snapshot sin revisar → CTA al blueprint */}
                  {/*
                    Ámbar y no rojo: en esta app el rojo significa "está roto", y un rechazo por
                    política es el sistema funcionando. Y sin acción de reintento — `force` es
                    override de cuarentena, no de esto.
                  */}
                  {environmentGate && (
                    <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
                      <p className="font-medium text-foreground">
                        🔒 No se intentó: no se ejecutó ningún DDL.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        El entorno <strong>{environmentGate.slug ?? 'de esta base'}</strong> bloquea
                        las migraciones destructivas
                        {environmentGate.versions.length > 0 && (
                          <> y las versiones {environmentGate.versions.join(', ')} las contienen</>
                        )}
                        . Las salidas son reclasificar la base o separar las sentencias destructivas
                        de esa versión.
                      </p>
                    </div>
                  )}
                  {baselineGateMsg && (
                    <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-4 text-xs">
                      <p className="text-foreground">{baselineGateMsg}</p>
                      {(status.data?.model_id ?? database.model_id) != null && (
                        <Link
                          to={`/database-models/${status.data?.model_id ?? database.model_id}/migrations`}
                          className="font-medium text-primary hover:underline"
                        >
                          Ir al blueprint a revisar el baseline →
                        </Link>
                      )}
                    </div>
                  )}

                  {/* 409 de captura SIN REVISAR (contrato v13 §2). Antes había dos variantes;
                      la de "falta consentimiento" desapareció con su gate, y con ella el botón
                      que activaba un control que ya no existe. La salida es una sola: aprobar la
                      versión en el blueprint. */}
                  {captureGate && (
                    <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-4 text-xs">
                      <p className="text-foreground">{captureGate.message}</p>
                      <p className="text-muted-foreground">
                        Versión(es) involucrada(s):{' '}
                        <strong>{captureGate.versions.join(', ')}</strong>
                      </p>
                      {(database.model_id ?? status.data?.model_id) != null && (
                        <Link
                          to={`/database-models/${database.model_id ?? status.data?.model_id}/migrations`}
                          className="font-medium text-primary hover:underline"
                        >
                          Ir al blueprint a revisar y aprobar →
                        </Link>
                      )}
                    </div>
                  )}

                  {/* Resultado del último apply real: results[] + reconciliación (§9) */}
                  {lastRun && (
                    <Card>
                      <CardContent className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-sm font-semibold text-foreground">
                            Resultado del último apply
                          </h2>
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
                                      {/* Vocabulario derivado, no el valor crudo: este ternario
                                          pintaba `applied`/`failed` en inglés en una UI que es
                                          toda en español, y quedaba al lado de la pestaña de
                                          historial que ya lo traduce. Dos rótulos distintos para
                                          el mismo hecho en la misma pantalla. */}
                                      <Badge tone={historyStatusSpec(item.status).tone}>
                                        {historyStatusSpec(item.status).label}
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

                        {/* Captura de SELECT (api-reference-v9 §3.2): tras un 200 con
                            `select_results_available: true`, se ofrece el link directo a la
                            pantalla de lectura (§6). `true` NO garantiza `row_count > 0`. */}
                        {lastRun.select_results_available && lastRun.to_version && (
                          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs">
                            <span className="text-foreground">
                              {lastRun.captured_select_count > 0
                                ? `Se capturaron ${lastRun.captured_select_count} fila(s) de SELECT.`
                                : 'Hay una captura de SELECT disponible (sin filas).'}
                            </span>
                            {/* Solo con `blueprints.captures`: ver las filas es divulgación. */}
                            {canSeeCaptures && (
                              <Link
                                to={`/managed-databases/${databaseId}/migrations/${lastRun.to_version}/select-results`}
                                className="shrink-0 font-medium text-primary hover:underline"
                              >
                                Ver resultados capturados →
                              </Link>
                            )}
                          </div>
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
                      </CardContent>
                    </Card>
                  )}

                  {/* Rollback secuencial */}
                  <Card className="border-error/30">
                    <CardContent className="flex flex-col gap-3">
                      <h2 className="text-sm font-semibold text-foreground">
                        Rollback (destructivo)
                      </h2>
                      {hasPartial && (
                        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                          <p className="text-foreground">
                            Hay una <strong>aplicación parcial</strong> pendiente: el rollback está
                            bloqueado (el backend respondería <code>409</code>) porque el estado
                            físico no coincide con ninguna versión registrada.
                          </p>
                          {firstResolvable && !isArchived ? (
                            <div>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={reconcileVersion === firstResolvable.version}
                                onClick={() => openReconcile(firstResolvable.version)}
                              >
                                Reconciliar primero…
                              </Button>
                            </div>
                          ) : (
                            /* Sin vía automática, mandar a «Reconciliar» era un lazo cerrado: la
                               acción no existe para esta parcial. Se nombra la salida real. */
                            <p className="text-muted-foreground">
                              Esta parcial no tiene reconciliación automática (mira el motivo en el
                              aviso de arriba). Para desbloquear el rollback: reintenta el apply
                              para completarla, o arregla el esquema a mano y declara la versión con{' '}
                              <strong>stamp force</strong>.
                            </p>
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
                          {database.model_id && (
                            <Link
                              to={`/database-models/${database.model_id}/migrations`}
                              className="font-medium text-primary hover:underline"
                            >
                              Ir al blueprint a confirmarlas →
                            </Link>
                          )}
                        </div>
                      )}
                      {lastRollback?.select_results_available && lastRollback.to_version && (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs">
                          <span className="text-foreground">
                            {lastRollback.captured_select_count > 0
                              ? `Se capturaron ${lastRollback.captured_select_count} fila(s) de SELECT (down_sql).`
                              : 'Hay una captura de SELECT disponible (sin filas).'}
                          </span>
                          {/* Solo con `blueprints.captures`: ver las filas es divulgación. */}
                          {canSeeCaptures && (
                            <Link
                              to={`/managed-databases/${databaseId}/migrations/${lastRollback.to_version}/select-results`}
                              className="shrink-0 font-medium text-primary hover:underline"
                            >
                              Ver resultados capturados →
                            </Link>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {hasOrphanAccounting && (
                          <p className="text-xs text-error">{ORPHAN_BLOCK_REASON}</p>
                        )}
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={!canRollback || notProvisioned || hasOrphanAccounting}
                          title={
                            notProvisioned
                              ? NOT_PROVISIONED_HINT
                              : hasOrphanAccounting
                                ? ORPHAN_BLOCK_REASON
                                : undefined
                          }
                          isLoading={rollback.isPending}
                          onClick={() =>
                            rollback.mutate(
                              {
                                confirmVersion,
                                targetVersion: rollbackTarget.trim() || undefined,
                              },
                              {
                                onSuccess: (result) => {
                                  setConfirmVersion('')
                                  setRollbackTarget('')
                                  setMissingDownSql(null)
                                  setCaptureGate(null)
                                  setLastRollback(result)
                                },
                                onError: (err) => {
                                  const apiError = toApiError(err)
                                  setMissingDownSql(
                                    apiError.status === 409 && apiError.missingDownSql
                                      ? apiError.missingDownSql
                                      : null,
                                  )
                                  setCaptureGate(readCaptureGate409(err))
                                },
                              },
                            )
                          }
                        >
                          Revertir
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          {tab === 'history' && (
            <MigrationHistoryPanel dbId={databaseId} modelId={hasModel ? modelId : undefined} />
          )}
        </>
      )}

      {/* Stamp (Cambio 4): sigue siendo modal — es una acción corta con doble confirmación */}
      <Modal
        open={stampOpen}
        onClose={() => {
          if (!stamp.isPending) closeStamp()
        }}
        title="Marcar versión (stamp)"
        description={`«${database.name}» (#${database.id})`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeStamp} disabled={stamp.isPending}>
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
          {/* Precarga desde el informe de contabilidad del blueprint. Se anuncia porque el
              diálogo se abre solo con una versión ya elegida: sin decir de dónde salió, parece
              un valor que el usuario puso y no recuerda. */}
          {preloadedStamp !== null && stampVersion === preloadedStamp && (
            <Callout tone="info" title={`Precargado con ${preloadedStamp}`}>
              <p>Es la versión que guarda la tabla huérfana de esta base.</p>
            </Callout>
          )}
          {preloadedStamp !== null &&
            stampVersion === preloadedStamp &&
            cachedVersion !== null &&
            cachedVersion !== preloadedStamp && (
              <Callout tone="warning" title="El inventario no dice lo mismo que la tabla huérfana">
                <p>
                  El inventario del gateway registra{' '}
                  <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                    {cachedVersion}
                  </code>
                  . Mirá esta base antes de tocarla.
                </p>
              </Callout>
            )}
          {useStampCombobox ? (
            <Combobox<ModelMigrationSummary>
              items={versionItems}
              value={selectedStampVersion}
              onChange={(m) => setStampVersion(m?.version ?? '')}
              itemToString={(m) => `${m.version} · ${m.name}`}
              itemToKey={(m) => m.id}
              label="Versión a marcar"
              placeholder="Selecciona una versión del blueprint…"
              isLoading={versions.isLoading}
              // El catálogo se corta en el tope de páginas ante un historial desmedido. Se dice
              // en el propio control: un desplegable al que le faltan opciones y no lo avisa
              // hace pensar que la versión buscada no existe.
              hint={
                versions.data?.truncated
                  ? 'El blueprint tiene más versiones de las que se pudieron listar; puede faltar alguna.'
                  : undefined
              }
            />
          ) : (
            <Input
              label="Versión a marcar"
              placeholder="p. ej. 0002"
              hint={
                versionItems.length > 0
                  ? 'Esta versión no figura en el catálogo del blueprint, así que se escribe a mano. Patrón del backend: solo dígitos, 4–10.'
                  : 'Patrón del backend: solo dígitos, 4–10.'
              }
              value={stampVersion}
              onChange={(event) => setStampVersion(event.target.value)}
              error={stampVersion && !stampValid ? 'Solo dígitos, 4–10 (ej. 0002).' : undefined}
            />
          )}
          {/*
            El contrato es explícito: «el destino sigue teniendo que existir en el blueprint»
            (api-reference-v25 §6), o sea 404. Se avisa ANTES de enviar en vez de dejar que el
            operador lo descubra por el error.

            El aviso se calla con el catálogo truncado, y esa excepción es el punto: ahí la
            ausencia no prueba nada —la versión puede estar en una página que no se pidió—, y
            afirmar «no existe» sobre una lista incompleta es peor que no decir nada. Mismo
            criterio fail-closed que el resto del módulo, pero al revés: acá lo seguro es callarse.
          */}
          {stampValid &&
            !stampVersionInCatalog &&
            versionItems.length > 0 &&
            !versions.data?.truncated && (
              <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
                La versión <strong>{stampVersion.trim()}</strong> no figura en el catálogo de este
                blueprint. El backend exige que el destino exista, así que va a rechazarla. Revisa
                el número, o créala en el blueprint antes de marcarla.
              </p>
            )}
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
            El stamp <strong>no ejecuta SQL</strong>: solo marca la versión en el motor. Úsalo solo
            si el esquema de la BD ya coincide con esa versión.
          </p>
          {stampUnreviewedCapture && stampUnreviewedCapture.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-error/40 bg-error/5 p-2 text-xs">
              <p className="text-foreground">
                La versión <strong>{stampUnreviewedCapture.join(', ')}</strong> tiene captura de
                resultados sin revisar (api-reference-v9 §3.4). Revisa el SQL y apruébalo (
                <code>PATCH reviewed=true</code>) en el blueprint, o activa «Forzar» abajo —{' '}
                <strong>
                  forzar solo marca el puntero de versión, NO habilita la captura real
                </strong>
                .
              </p>
              {database.model_id && (
                <Link
                  to={`/database-models/${database.model_id}/migrations`}
                  className="font-medium text-primary hover:underline"
                >
                  Ir al blueprint a revisar y aprobar →
                </Link>
              )}
            </div>
          )}
          {/* Se bloquea SOLO si el gateway puede reconciliar por sí mismo — ahí force es el
              atajo peligroso y «Reconciliar» es la vía correcta. Cuando NO hay vía automática
              (p. ej. la versión no tiene manifiesto de sentencias), force es la salida
              PREVISTA por el backend y deshabilitarlo dejaba la BD sin ninguna: la UI mandaba
              a una reconciliación que no existe. Ver el docstring de
              `_guard_partial_checkpoint`: "sin este override … dejaría al admin sin ninguna
              salida". */}
          <Switch
            checked={stampForce}
            onCheckedChange={changeStampForce}
            label="Forzar (force)"
            disabled={hasAutomaticWayOut}
            hint={
              hasAutomaticWayOut
                ? 'Bloqueado: esta aplicación parcial SÍ se puede reconciliar; usa «Reconciliar» (reconcile-partial) en vez de forzar.'
                : hasPartial
                  ? 'Esta aplicación parcial no tiene reconciliación automática: force es la salida prevista, pero solo después de haber arreglado el esquema a mano.'
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
          {/* Zona de excepción, PLEGADA por defecto: `purge` solo tiene sentido en un caso que
              casi nunca se da, y un interruptor destructivo a la vista en el camino normal se
              acaba activando «por si acaso». Quien llega acá viene buscándolo. */}
          <details className="rounded-lg border border-border p-3">
            {/* El literal va en inglés A PROPÓSITO, y es la única cadena así de toda la UI: es
                el texto exacto que devuelve Alembic, y el operador llega hasta acá justamente
                buscando lo que acaba de leer en el error. Traducirlo rompería el reconocimiento,
                que es la función del rótulo. Por eso se presenta como cita del motor y no como
                frase nuestra. */}
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Esta base no se deja marcar: el motor responde{' '}
              <code className="font-mono text-xs">Can&apos;t locate revision</code>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <Switch
                checked={stampPurge}
                onCheckedChange={setStampPurge}
                label="Vaciar la tabla de versión antes de escribir"
                // Deshabilitado sin `force`, y nunca se marca `force` por el usuario: encender un
                // override que no pidió es peor que no dejarlo avanzar. El backend responde 422 si
                // llega `purge` sin `force`, así que acá no se llega nunca.
                disabled={!stampForce}
                hint={
                  stampForce
                    ? 'Se ejecuta como parte del stamp: primero vacía, después escribe.'
                    : 'Requiere también "force".'
                }
              />
              <p className="rounded-lg border border-error/40 bg-error/5 p-2 text-xs text-foreground">
                <strong>Descarta el puntero actual SIN LEERLO.</strong> Solo tiene sentido si el
                puntero nombra una revisión que ya no está en la cadena, que es el caso en que esta
                base quedó sin apply, sin rollback y sin stamp.
              </p>
            </div>
          </details>
          {stampFallbackError && (
            <p className="rounded-lg border border-error/40 bg-error/5 p-2 text-xs text-error">
              {stampFallbackError}
            </p>
          )}
          {stampCooldown && (
            <p className="rounded-lg border border-error/40 bg-error/5 p-2 text-xs text-error">
              Has alcanzado el límite de 10/min. Espera unos segundos e inténtalo de nuevo.
            </p>
          )}
        </div>
      </Modal>

      {provisionOpen && (
        <ProvisionDatabaseDialog database={database} onClose={() => setProvisionOpen(false)} />
      )}
    </div>
  )
}
