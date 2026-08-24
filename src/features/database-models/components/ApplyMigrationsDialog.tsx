import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Combobox,
  Input,
  Modal,
  MultiCombobox,
  RadioCardGroup,
  Switch,
} from '@/components/ui'
import {
  PAGINATION,
  type ApplyAllResult,
  type ModelDatabaseStatus,
  type OnFailureMode,
  type EnvironmentOut,
} from '@/lib/contracts'
import { useModelDatabases } from '../hooks/use-database-models'
import { useApplyAllMigrations, useModelMigrations } from '../hooks/use-model-migrations'
import { OnFailureSelect } from './OnFailureSelect'
import {
  CAPTURE_UNREVIEWED_CODE,
  describeCaptureRejection,
  splitCaptureVersions,
} from '../capture'
import {
  blockingEnvironments,
  classifyItem,
  databaseLabel,
  describeItemRejection,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  useEnvironmentMap,
  useSelectableEnvironments,
} from '@/features/environments'

interface ApplyMigrationsDialogProps {
  modelId: number
  modelName?: string
  open: boolean
  onClose: () => void
  /** Preselección al abrir desde una fila de la tabla de estado. */
  initialTargets?: ModelDatabaseStatus[]
}

type TargetMode = 'all' | 'selection'

const TARGET_OPTIONS = [
  {
    value: 'all' as const,
    label: 'Todas las BDs del blueprint',
    description: 'Hasta el máximo indicado, en orden de id.',
  },
  {
    value: 'selection' as const,
    label: 'Solo las que elija',
    description: 'Para probar en una BD antes de ir a por todas.',
  },
]

/**
 * Aplica las migraciones del blueprint a **los destinos que se elijan** (§8 + v11 §3).
 *
 * Sustituye al antiguo «Aplicar a todas», que solo permitía acotar *cuántas* BDs, nunca
 * *cuáles*: en desarrollo lo normal es probar una versión nueva contra una BD y solo después
 * ir a por el resto, y eso obligaba a salir a la ficha de esa BD.
 *
 * Sigue siendo UNA llamada: el backend acepta `database_ids`, así que elegir destinos no
 * multiplica las peticiones ni consume el rate limit por BD.
 */
export function ApplyMigrationsDialog({
  modelId,
  modelName,
  open,
  onClose,
  initialTargets,
}: ApplyMigrationsDialogProps) {
  const [mode, setMode] = useState<TargetMode>(initialTargets?.length ? 'selection' : 'all')
  const [targets, setTargets] = useState<ModelDatabaseStatus[]>(initialTargets ?? [])
  const [maxDatabases, setMaxDatabases] = useState(10)
  const [force, setForce] = useState(false)
  const [onFailure, setOnFailure] = useState<OnFailureMode>('auto')
  const [environment, setEnvironment] = useState<EnvironmentOut | null>(null)
  const [result, setResult] = useState<ApplyAllResult | null>(null)
  const [wasDryRun, setWasDryRun] = useState(false)

  const applyAll = useApplyAllMigrations(modelId)
  const migrations = useModelMigrations(modelId, { page: 1, size: PAGINATION.maxSize }, open)
  // Misma respuesta que alimenta la pestaña de estado: no es una llamada extra.
  const databases = useModelDatabases(modelId, open)
  const environments = useSelectableEnvironments()
  const environmentMap = useEnvironmentMap()

  // Predicado COMPARTIDO con la ficha de la BD (`features/database-models/capture`). Vivía
  // duplicado y las dos copias divergieron en el borde de `reviewed === undefined`.
  const { willCapture, blockedByReview } = splitCaptureVersions(migrations.data?.items ?? [])

  const handleClose = () => {
    setResult(null)
    onClose()
  }

  const run = (dryRun: boolean) => {
    setWasDryRun(dryRun)
    applyAll.mutate(
      {
        // Las guardas van ACÁ y no en el JSX: ocultar un control no impide que su valor viaje.
        // `maxDatabases` ya se mandaba incondicionalmente incluso en modo `selection`, y copiar
        // ese patrón habría mandado `environmentId` junto a `databaseIds`.
        maxDatabases: mode === 'all' ? maxDatabases : undefined,
        environmentId: mode === 'all' ? (environment?.id ?? undefined) : undefined,
        databaseIds: mode === 'selection' ? targets.map((t) => t.id) : undefined,
        force,
        dryRun,
        onFailure,
      },
      { onSuccess: (data) => setResult(data) },
    )
  }

  const nothingSelected = mode === 'selection' && targets.length === 0

  /**
   * Aviso derivado de los DESTINOS, no del control.
   *
   * En modo `selection` los destinos se conocen en cliente (`ModelDatabaseStatus` hereda
   * `environment_id` del schema compartido), así que se puede ser preciso. En modo `all` sin
   * filtro **no se finge precisión**: el lote puede alcanzar cualquier entorno y la única forma
   * de saber cuáles es el dry-run.
   */
  const warning = (() => {
    const blocking = blockingEnvironments(environments.selectable)
    if (blocking.length === 0) return null

    if (mode === 'selection') {
      const hits = targets.filter((t) => {
        const env = t.environment_id != null ? environmentMap.byId.get(t.environment_id) : undefined
        return env?.blocks_destructive_migrations
      })
      if (hits.length === 0) return null
      const names = [
        ...new Set(
          hits.map((t) => environmentMap.byId.get(t.environment_id as number)?.name ?? '—'),
        ),
      ]
      return {
        title: `Este lote alcanza ${hits.length} BD(s) de ${names.join(', ')}.`,
        detail:
          'Ese entorno bloquea las migraciones destructivas: si alguna versión pendiente las ' +
          'contiene, el servidor va a rechazarla y no se va a ejecutar ningún DDL en esa base.',
      }
    }

    if (environment) {
      if (!environment.blocks_destructive_migrations) return null
      return {
        title: `El lote está acotado a ${environment.name}, que bloquea las migraciones destructivas.`,
        detail:
          'Las versiones con DROP / TRUNCATE / DELETE sin WHERE / ALTER DROP COLUMN se van a ' +
          'rechazar por política. "Forzar" no habilita esto.',
      }
    }

    return {
      title: 'El lote puede alcanzar cualquier entorno, incluidos los que bloquean destructivas.',
      detail: `Corré el dry-run para ver a cuáles llega (${blocking
        .map((e) => e.name)
        .join(', ')} bloquea${blocking.length > 1 ? 'n' : ''} las migraciones destructivas).`,
    }
  })()

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Aplicar migraciones"
      description={modelName ? `Aplica las versiones pendientes de «${modelName}».` : undefined}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <RadioCardGroup
          title="Destinos"
          options={TARGET_OPTIONS}
          value={mode}
          onChange={setMode}
          columns={2}
        />

        {mode === 'selection' && (
          <MultiCombobox<ModelDatabaseStatus>
            label="BDs destino"
            items={databases.data ?? []}
            selectedItems={targets}
            onChange={setTargets}
            itemToString={(db) => db.name}
            itemToKey={(db) => db.id}
            renderItem={(db) => (
              <span className="flex w-full items-center gap-2">
                <span className="truncate">{db.name}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Badge tone={db.pending_count > 0 ? 'warning' : 'success'}>
                    {db.pending_count} pendiente(s)
                  </Badge>
                  {db.has_partial_application && <Badge tone="error">parcial</Badge>}
                </span>
              </span>
            )}
            placeholder="Añadir BD…"
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'all' && (
            <Input
              label="Máx. BDs por llamada"
              type="number"
              min={1}
              max={100}
              value={maxDatabases}
              onChange={(event) => setMaxDatabases(Number(event.target.value))}
              hint="1–100 (procesamiento síncrono)."
            />
          )}
          {/*
            El entorno NO es un tercer modo del selector de destinos: es un eje ORTOGONAL que
            acota `all`. De ahí que viva acá, junto al tope, y no en el `RadioCardGroup`.
          */}
          {mode === 'all' && (
            <Combobox<EnvironmentOut>
              items={environments.selectable}
              value={environment}
              onChange={setEnvironment}
              itemToString={(e) =>
                e.blocks_destructive_migrations ? `${e.name} · bloquea destructivas` : e.name
              }
              itemToKey={(e) => e.id}
              label="Entorno (opcional)"
              placeholder="Todos los entornos"
              isLoading={environments.isLoading}
              hint="El filtro se aplica ANTES del tope, así que el máximo no se gasta en otros entornos."
              clearable
            />
          )}
          <div className="flex items-end">
            <Switch
              checked={force}
              onCheckedChange={setForce}
              label="Forzar"
              hint="Override de cuarentena en cada BD."
            />
          </div>
        </div>

        <div className="max-w-sm">
          <OnFailureSelect value={onFailure} onChange={setOnFailure} />
        </div>

        {/* AVISO, no control. Acá había un interruptor de consentimiento por corrida; se
            retiró (contrato v13 §1) porque con un solo admin no aportaba una decisión nueva
            —`reviewed` ya aprueba la consulta concreta— y no dejaba rastro en la auditoría,
            mientras que un click de más en cada corrida entrena el «siempre que sí». Lo que sí
            hacía falta es que se lea QUÉ está en juego, y eso se conserva. */}
        {willCapture.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Este lote va a capturar resultados.</strong> Las
              versiones <strong>{willCapture.join(', ')}</strong> guardan en el gateway el resultado
              de sus SELECT: filas de <strong>cada BD alcanzada</strong>, cifradas. Solo se conserva
              la corrida más reciente por BD y versión, y caduca sola; podrás verlas o purgarlas
              desde cada BD al terminar.
            </p>
          </div>
        )}

        {/* Distinto del anterior: esto NO va a pasar, va a ser rechazado. Se avisa antes de
            gastar una corrida y descubrirlo ítem por ítem. */}
        {blockedByReview.length > 0 && (
          <div className="rounded-lg border border-error/40 bg-error/5 p-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">
                Captura sin aprobar: {blockedByReview.join(', ')}
              </strong>{' '}
              — el backend va a rechazar (409) cada BD que tenga esas versiones pendientes.
              Revisá qué consultan y aprobalas en la tabla de versiones antes de aplicar.
            </p>
          </div>
        )}

        {/*
          BANDA PERSISTENTE, no un `hint`. Tres motivos: (a) un `hint` viviría en un control que
          NO existe en modo `selection` —que es justamente el camino para aplicar a UNA base
          productiva—; (b) el peligro son los destinos resueltos, no el filtro; y (c) la regla del
          repo ya está escrita en `Callout`: "va como banda y no como tooltip a propósito, porque
          un tooltip se descubre por accidente y esto tiene que leerse antes de decidir".
        */}
        {warning && (
          <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
            <p className="font-medium text-foreground">⚠️ {warning.title}</p>
            <p className="mt-1 text-muted-foreground">{warning.detail}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            isLoading={applyAll.isPending}
            disabled={nothingSelected}
            onClick={() => run(true)}
          >
            Previsualizar (dry-run)
          </Button>
          <Button
            isLoading={applyAll.isPending}
            disabled={nothingSelected}
            onClick={() => run(false)}
          >
            {mode === 'selection' ? `Aplicar a ${targets.length} BD(s) 🔌` : 'Aplicar a todas 🔌'}
          </Button>
        </div>

        {result && <ApplyResult result={result} wasDryRun={wasDryRun} />}
      </div>
    </Modal>
  )
}

/**
 * Orden de lectura: primero lo que necesita acción.
 *
 * La lista es `max-h-64 overflow-auto`, así que todo lo que pase de la cuarta fila queda bajo el
 * pliegue: con 2 errores entre 28 filas OK, los dos que importan quedaban enterrados. Errores,
 * después bloqueadas, después OK.
 */
const OUTCOME_ORDER = { failed: 0, blocked: 1, ok: 2 } as const

function ApplyResult({ result, wasDryRun }: { result: ApplyAllResult; wasDryRun: boolean }) {
  const items = [...result.results].sort(
    (a, b) => OUTCOME_ORDER[classifyItem(a)] - OUTCOME_ORDER[classifyItem(b)],
  )
  const counts = { ok: 0, blocked: 0, failed: 0 }
  for (const item of result.results) counts[classifyItem(item)] += 1

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {wasDryRun ? 'Plan (sin aplicar)' : 'Resultado'} · {result.processed} de{' '}
        {/*
          `matched_databases` refleja los filtros del lote; `total_databases` son TODAS las del
          blueprint. Con el filtro de entorno activo, "3 de 40" se leería como "sobraron 37"
          cuando en ese entorno solo había 3.
        */}
        {result.matched_databases || result.total_databases} BD(s) procesada(s)
      </p>
      {/*
        Tres cubos, no dos. Con 6 bloqueadas y 2 falladas, ocho filas rojas idénticas obligan a
        leer ocho frases para saber cuáles necesitan acción.
      */}
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="success">{counts.ok} aplicada(s)</Badge>
        {counts.blocked > 0 && (
          <Badge tone="warning">{counts.blocked} bloqueada(s) por política</Badge>
        )}
        {counts.failed > 0 && <Badge tone="error">{counts.failed} con error</Badge>}
      </p>
      <ul className="flex max-h-64 flex-col divide-y divide-border overflow-auto rounded-lg border border-border">
        {items.map((item) => {
          const outcome = classifyItem(item)
          // La versión a la que enlazar es la que REALMENTE capturó, que el backend informa
          // en `captured_versions`. Antes se adivinaba con la última aplicada: un apply
          // 0005→0010 cuya captura ocurrió en 0007 enlazaba a `…/0010/select-results`, vacío.
          // El fallback a la última aplicada cubre un backend previo al campo.
          const capturedAt = item.captured_versions?.[0] ?? item.applied?.at(-1)?.version
          return (
            <li key={item.managed_database_id} className="flex flex-col gap-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {/*
                    Por acá y no `item.database_name` directo: el backend lo tipa `str | None` y
                    React renderiza `null` como vacío sin que TypeScript avise (`ReactNode` lo
                    acepta). Una fila bloqueada o fallada SIN nombre es inaccionable.
                  */}
                  {databaseLabel(item)}
                </span>
                <span className="flex items-center gap-1">
                  {item.environment_slug && (
                    <Badge tone="neutral" className="shrink-0">
                      {item.environment_slug}
                    </Badge>
                  )}
                  {/*
                    "Bloqueada" va en ÁMBAR, no en rojo: acá el rojo significa "esto está roto",
                    y un rechazo por política es el sistema FUNCIONANDO. El color es lo que
                    distingue "no pasó nada, por diseño" de "algo se rompió".
                  */}
                  <Badge tone={OUTCOME_TONE[outcome]}>
                    {outcome === 'blocked' ? '🔒 ' : ''}
                    {OUTCOME_LABEL[outcome]}
                  </Badge>
                </span>
              </div>
              {item.applied && item.applied.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Aplicadas:{' '}
                  {item.applied
                    .map((a) => {
                      const resumed = a.resumed
                        ? ` (retomada desde sentencia ${a.resumed_from_statement ?? '?'})`
                        : ''
                      const failedAt =
                        a.failed_at_statement_index != null
                          ? ` (falló en sentencia ${a.failed_at_statement_index}${
                              a.statement_total != null ? ` de ${a.statement_total}` : ''
                            })`
                          : ''
                      return `${a.version}${resumed}${failedAt}`
                    })
                    .join(', ')}
                </span>
              )}
              {item.pending_versions && item.pending_versions.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Pendientes: {item.pending_versions.join(', ')}
                </span>
              )}
              {/* Puente que faltaba: desde el blueprint no había forma de llegar a lo
                  capturado; solo se llegaba entrando a la ficha de cada BD. */}
              {item.select_results_available && capturedAt && (
                <Link
                  to={`/managed-databases/${item.managed_database_id}/migrations/${capturedAt}/select-results`}
                  className="text-xs text-primary hover:underline"
                >
                  Ver {item.captured_select_count} resultado(s) capturado(s) →
                </Link>
              )}
              {/*
                Rechazo por política: texto propio, en ámbar, y con "no se intentó" como carga
                útil — esa es la distinción que antes no existía en ninguna forma. NO se ofrece
                reintento: `force` no es un override de esto; las salidas reales son reclasificar
                la base o separar las sentencias destructivas de la versión.
              */}
              {outcome === 'blocked' && (
                <span className="text-xs text-warning">{describeItemRejection(item)}</span>
              )}
              {/*
                Rechazo por CAPTURA sin revisar. Llega como ítem de una respuesta 200 —el guard
                corre por BD dentro del bucle del backend—, así que nunca fue un error de la
                mutación y el `onError` del diálogo no lo veía: caía como el `item.error` crudo,
                sin decir que no se ejecutó nada ni cómo salir. Se clasifica por `error_code`,
                que es el único canal estable acá (el `public_context` de la respuesta HTTP no
                existe para un rechazo por ítem).
              */}
              {item.error_code === CAPTURE_UNREVIEWED_CODE ? (
                <span className="text-xs text-warning">
                  {describeCaptureRejection(item.unreviewed_capture ?? [])}
                </span>
              ) : (
                outcome === 'failed' &&
                item.error && <span className="text-xs text-error">{item.error}</span>
              )}
              {/* Dry-run: informativo, el plan no falla. */}
              {wasDryRun && item.blocked_by && item.blocked_by.length > 0 && (
                <span className="text-xs text-warning">
                  El apply real rechazaría: {item.blocked_by.join(', ')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
