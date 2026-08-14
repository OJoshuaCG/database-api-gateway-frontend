import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import type {
  CollationConversionCreate,
  CollationConversionExecuteIn,
  CollationConversionSummaryOut,
  CollationObjectRef,
  ConversionMode,
  EngineType,
} from '@/lib/contracts'
import {
  COLLATION_CONVERSION_TERMINAL_STATUSES,
  useCollationConversion,
  useCollationConversionItems,
  useCollationConversionObjects,
  useCollationConversionPreview,
} from '../hooks/use-collation-conversions'
import {
  useCancelCollationConversion,
  useCreateCollationConversion,
  useExecuteCollationConversion,
} from '../hooks/use-collation-conversion-actions'
import {
  buildExecuteBody,
  buildPreviewBody,
  modeForEngine,
  preselectObjects,
  preselectTables,
  toggleObjectSelection,
  toggleTableSelection,
} from './logic'

/**
 * Hook central del asistente de conversión de collation (`collation-conversions`). A diferencia
 * de `database-clones`, acá los 4 pasos existen SIEMPRE (no hay ramas por modo): lo que cambia
 * según `mode` es el CONTENIDO de `inventory`/`preview` (columnas vs. tablas+objetos), nunca la
 * lista de pasos.
 */

export type CollationConversionWizardStep = 'summary' | 'plan' | 'inventory' | 'preview' | 'monitor'

export interface CollationConversionWizardOptions {
  serverId: number
  serverName: string
  database: string
  /** Ya conocido por la navegación — el wizard no lo elige, solo adapta el formulario con `mode`. */
  engine: EngineType
  /** Reentrada por `?jobId=`. */
  presetJobId?: number
}

export interface CollationConversionWizard {
  // Identidad y modo
  serverId: number
  serverName: string
  database: string
  engine: EngineType
  mode: ConversionMode

  // Navegación
  step: CollationConversionWizardStep
  order: CollationConversionWizardStep[]
  canBack: boolean
  next: () => void
  back: () => void
  goToStep: (step: CollationConversionWizardStep) => void
  replan: () => void
  reset: () => void

  // Paso 1 — plan
  jobId: number | null
  job: ReturnType<typeof useCollationConversion>
  targetCharset: string | null
  setTargetCharset: (value: string | null) => void
  targetCollation: string
  setTargetCollation: (value: string) => void
  createPlan: UseMutationResult<CollationConversionSummaryOut, unknown, CollationConversionCreate>

  // Paso 2 — inventario y selección
  objects: ReturnType<typeof useCollationConversionObjects>
  reloadInventory: () => void
  checkedTables: Set<string>
  toggleTable: (name: string) => void
  checkedObjects: Map<string, CollationObjectRef>
  toggleObject: (ref: CollationObjectRef) => void
  includeDatabaseDefault: boolean
  setIncludeDatabaseDefault: (value: boolean) => void

  // Paso 3 — preview y confirmación
  preview: ReturnType<typeof useCollationConversionPreview>
  refreshPreview: () => void
  savedConfirmToken: string | null
  savedTotals: { tablesToConvert: number; objectsToRecreate: number } | null
  confirmTargetName: string
  setConfirmTargetName: (value: string) => void
  force: boolean
  setForce: (value: boolean) => void
  execute: UseMutationResult<CollationConversionSummaryOut, unknown, void>

  // Paso 4 — progreso y resultado
  itemsPage: number
  setItemsPage: (page: number) => void
  items: ReturnType<typeof useCollationConversionItems>
  cancel: UseMutationResult<CollationConversionSummaryOut, unknown, void>

  // Rate limit (429)
  actionCooldown: number
}

const ITEMS_PAGE_SIZE = 20
const COOLDOWN_SECONDS = 20

/**
 * Envuelve una mutación cruda (variables = forma interna del hook de API, p. ej.
 * `{ serverId, database, body }`) para exponerla con la forma de variables que el wizard le
 * ofrece a los pasos (`body` sola, o `void` cuando el resto ya lo sabe el hook). Los efectos de
 * `onSettled` SIEMPRE corren, aunque el step no pase sus propios `onSuccess`/`onError` — mismo
 * criterio que el cooldown de 429 y el reset de estado ligado al job: no pueden depender de que
 * cada consumidor se acuerde de invocarlos.
 *
 * Nombrado `use*` (aunque no llama hooks por dentro) a propósito: `onSettled.onError` referencia
 * `handleActionError`, que toca el `ref` del temporizador del cooldown. `react-hooks/refs`
 * prohíbe pasar un valor derivado de un ref a una función común durante el render porque no puede
 * probar que esa función no lo lee de forma síncrona — declararla como hook es la señal que el
 * linter reconoce como "confío en que respeta las reglas de los hooks".
 */
function useWrapMutation<TData, TRawVariables, TVariables>(
  raw: UseMutationResult<TData, unknown, TRawVariables>,
  mapVariables: (variables: TVariables) => TRawVariables,
  onSettled: { onSuccess?: (data: TData) => void; onError: (error: unknown) => void },
): UseMutationResult<TData, unknown, TVariables> {
  return {
    ...raw,
    // No se spreadea `...options` tal cual: su `onSettled` está tipado con `TVariables` (las
    // variables que ve el step), no con `TRawVariables` (las que espera `raw`) — se remapea cada
    // callback a mano para no perder ese tercer parámetro.
    mutate: (variables, options) => {
      raw.mutate(mapVariables(variables), {
        onSuccess: (data, _rawVariables, onMutateResult, context) => {
          onSettled.onSuccess?.(data)
          options?.onSuccess?.(data, variables, onMutateResult, context)
        },
        onError: (error, _rawVariables, onMutateResult, context) => {
          onSettled.onError(error)
          options?.onError?.(error, variables, onMutateResult, context)
        },
        onSettled: (data, error, _rawVariables, onMutateResult, context) =>
          options?.onSettled?.(data, error, variables, onMutateResult, context),
      })
    },
    mutateAsync: (variables, options) =>
      raw.mutateAsync(mapVariables(variables), {
        onSuccess: (data, _rawVariables, onMutateResult, context) => {
          onSettled.onSuccess?.(data)
          options?.onSuccess?.(data, variables, onMutateResult, context)
        },
        onError: (error, _rawVariables, onMutateResult, context) => {
          onSettled.onError(error)
          options?.onError?.(error, variables, onMutateResult, context)
        },
        onSettled: (data, error, _rawVariables, onMutateResult, context) =>
          options?.onSettled?.(data, error, variables, onMutateResult, context),
      }),
  } as UseMutationResult<TData, unknown, TVariables>
}

export function useCollationConversionWizard(
  wizardOptions: CollationConversionWizardOptions,
): CollationConversionWizard {
  const { serverId, serverName, database, engine, presetJobId } = wizardOptions
  const queryClient = useQueryClient()
  const mode = useMemo(() => modeForEngine(engine), [engine])

  const [step, setStep] = useState<CollationConversionWizardStep>(
    presetJobId != null ? 'summary' : 'plan',
  )
  const [jobId, setJobId] = useState<number | null>(presetJobId ?? null)

  // ── Paso 1 — plan ────────────────────────────────────────────────────────────────
  const [targetCharset, setTargetCharset] = useState<string | null>(null)
  const [targetCollation, setTargetCollation] = useState('')

  // ── Paso 2 — inventario y selección ─────────────────────────────────────────────
  const [checkedTables, setCheckedTables] = useState<Set<string>>(new Set())
  const [checkedObjects, setCheckedObjects] = useState<Map<string, CollationObjectRef>>(new Map())
  const [includeDatabaseDefaultState, setIncludeDatabaseDefaultState] = useState(true)

  // ── Paso 3 — preview y confirmación ─────────────────────────────────────────────
  const [confirmTargetName, setConfirmTargetName] = useState('')
  const [force, setForce] = useState(false)
  const [savedConfirmToken, setSavedConfirmToken] = useState<string | null>(null)
  const [savedTotals, setSavedTotals] = useState<{
    tablesToConvert: number
    objectsToRecreate: number
  } | null>(null)

  // ── Paso 4 — progreso ────────────────────────────────────────────────────────────
  const [itemsPage, setItemsPageState] = useState(1)
  const setItemsPage = useCallback((page: number) => setItemsPageState(page), [])

  // ── Rate limit (429) — cooldown genérico, reusado por las tres mutaciones ────────
  const [actionCooldown, setActionCooldown] = useState(0)
  const cooldownIntervalRef = useRef<ReturnType<typeof window.setInterval> | null>(null)

  const clearCooldownTimer = useCallback(() => {
    if (cooldownIntervalRef.current != null) {
      window.clearInterval(cooldownIntervalRef.current)
      cooldownIntervalRef.current = null
    }
  }, [])

  const startCooldown = useCallback(
    (seconds: number) => {
      clearCooldownTimer()
      setActionCooldown(seconds)
      cooldownIntervalRef.current = window.setInterval(() => {
        setActionCooldown((prev) => {
          if (prev <= 1) {
            clearCooldownTimer()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    },
    [clearCooldownTimer],
  )

  const handleActionError = useCallback(
    (error: unknown) => {
      if (toApiError(error).isRateLimited) startCooldown(COOLDOWN_SECONDS)
    },
    [startCooldown],
  )

  useEffect(() => {
    return () => clearCooldownTimer()
  }, [clearCooldownTimer])

  // ── Mutaciones crudas (declaradas temprano: `resetJobScopedState` necesita poder resetear su
  // error/data al arrancar un job nuevo) ────────────────────────────────────────────
  const createPlanRaw = useCreateCollationConversion()
  const executeRaw = useExecuteCollationConversion()
  const cancelRaw = useCancelCollationConversion()

  // Limpia TODO el estado ligado a un job (selección, confirmación, paginación, cooldown de rate
  // limit y el resultado de mutaciones previas) — se llama tanto al crear un plan nuevo como en
  // `reset()`. Unificado en un solo lugar para que un job nuevo no herede el cooldown/error del
  // anterior (mismo motivo que en `database-clones`).
  const resetJobScopedState = useCallback(() => {
    setCheckedTables(new Set())
    setCheckedObjects(new Map())
    setIncludeDatabaseDefaultState(true)
    setForce(false)
    setConfirmTargetName('')
    setSavedConfirmToken(null)
    setSavedTotals(null)
    setItemsPageState(1)
    setActionCooldown(0)
    clearCooldownTimer()
    executeRaw.reset()
    cancelRaw.reset()
  }, [clearCooldownTimer, executeRaw, cancelRaw])

  const createPlan = useWrapMutation<
    CollationConversionSummaryOut,
    { serverId: number; database: string; body: CollationConversionCreate },
    CollationConversionCreate
  >(createPlanRaw, (body) => ({ serverId, database, body }), {
    onSuccess: (summary) => {
      resetJobScopedState()
      setJobId(summary.id)
      setStep('inventory')
    },
    onError: handleActionError,
  })

  // ── Job (resumen + estado, polling) ────────────────────────────────────────────
  const job = useCollationConversion(jobId ?? 0, jobId != null)

  // ── Prellenado del formulario del plan tras reentrar por `?jobId=` o al "Replanear" ─────────
  // Patrón "ajustar estado durante el render" (no un efecto): sin esto, el Paso 1 se vería vacío
  // al reentrar o al reeditar un job fallido/cancelado/expirado. El guard `targetCollation === ''`
  // evita pisar lo que el operador ya haya empezado a escribir para un plan nuevo.
  const [appliedReplanForJobId, setAppliedReplanForJobId] = useState<number | null>(null)
  if (jobId != null && jobId !== appliedReplanForJobId && job.data && targetCollation === '') {
    setAppliedReplanForJobId(jobId)
    setTargetCharset(job.data.target_charset)
    setTargetCollation(job.data.target_collation)
  }

  // ── Paso 2 — inventario y selección ─────────────────────────────────────────────
  const order = useMemo<CollationConversionWizardStep[]>(() => {
    const steps: CollationConversionWizardStep[] = []
    if (presetJobId != null) steps.push('summary')
    steps.push('plan', 'inventory', 'preview', 'monitor')
    return steps
  }, [presetJobId])

  // El inventario se pide desde que se entra a 'inventory' y se mantiene habilitado en los pasos
  // siguientes (preview/monitor): volver atrás a revisar la selección no debe disparar un refetch.
  const objectsEnabled = jobId != null && order.indexOf(step) >= order.indexOf('inventory')
  const objects = useCollationConversionObjects(jobId ?? 0, objectsEnabled)

  const reloadInventory = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.collationConversions.objects(jobId ?? 0) })
  }, [queryClient, jobId])

  const toggleTable = useCallback((name: string) => {
    setCheckedTables((prev) => toggleTableSelection(prev, name))
  }, [])
  const toggleObject = useCallback((ref: CollationObjectRef) => {
    setCheckedObjects((prev) => toggleObjectSelection(prev, ref))
  }, [])

  // Forzado a `false` en modo `columns`: el selector de objetos ni se muestra ahí, así que el
  // estado interno queda congelado (irrelevante) mientras el motor sea PostgreSQL.
  const includeDatabaseDefault = mode === 'columns' ? false : includeDatabaseDefaultState
  const setIncludeDatabaseDefault = useCallback((value: boolean) => {
    setIncludeDatabaseDefaultState(value)
  }, [])

  // ── Preselección automática del inventario (§9.1) ───────────────────────────────
  // Patrón "ajustar estado durante el render": se aplica UNA sola vez por jobId (la comparación
  // `jobId !== preselectedForJobId` ya se resuelve sola al crear un plan nuevo, sin necesitar un
  // reset explícito) y nunca pisa una selección que el operador ya haya tocado a mano, porque tras
  // la primera aplicación la bandera queda fija para ese jobId (p. ej. "recargar inventario" no
  // la reaplica).
  const [preselectedForJobId, setPreselectedForJobId] = useState<number | null>(null)
  if (jobId != null && jobId !== preselectedForJobId && objects.data) {
    setPreselectedForJobId(jobId)
    setCheckedTables(preselectTables(objects.data.tables))
    setCheckedObjects(preselectObjects(objects.data.objects))
  }

  // ── Paso 3 — preview y confirmación ────────────────────────────────────────────
  const previewBody = useMemo(
    () => buildPreviewBody({ checkedTables, checkedObjects, includeDatabaseDefault, mode, force }),
    [checkedTables, checkedObjects, includeDatabaseDefault, mode, force],
  )
  // Cualquier cambio de selección dispara un preview nuevo con un `confirm_token` nuevo — el
  // viejo queda atado a una queryKey vieja y nunca se reutiliza (§4.11: cada cambio de selección
  // exige un preview nuevo).
  const deferredPreviewBody = useDeferredValue(previewBody)
  const preview = useCollationConversionPreview(
    jobId ?? 0,
    deferredPreviewBody,
    jobId != null && step === 'preview',
  )

  // Alcanza con cambiar `force`: como forma parte del body (y por lo tanto de la queryKey de
  // `preview`), React Query dispara solo el fetch nuevo con `force: true` en el próximo render.
  // Un `preview.refetch()` acá apuntaría todavía a la queryKey VIEJA (con `force: false`, el
  // valor de este render) y gastaría un pedido de más contra el rate limit de 10/minute sin
  // lograr nada.
  const refreshPreview = useCallback(() => {
    setForce(true)
  }, [])

  // Guarda el `confirm_token`/totales del ÚLTIMO preview EXITOSO (patrón "ajustar estado durante
  // el render"): `progress` del polling nunca trae totales (§3.2), así que sin esto la barra de
  // avance del monitor no tendría de dónde sacar "de cuántos".
  if (preview.data && preview.data.confirm_token !== savedConfirmToken) {
    setSavedConfirmToken(preview.data.confirm_token)
    setSavedTotals({
      tablesToConvert: preview.data.tables_to_convert,
      objectsToRecreate: preview.data.objects_to_recreate,
    })
  }

  const execute = useWrapMutation<
    CollationConversionSummaryOut,
    { id: number; body: CollationConversionExecuteIn },
    void
  >(
    executeRaw,
    () => ({
      id: jobId ?? 0,
      body: buildExecuteBody({ confirmTargetName, confirmToken: savedConfirmToken ?? '', force }),
    }),
    {
      onSuccess: () => setStep('monitor'),
      onError: handleActionError,
    },
  )

  // ── Paso 4 — progreso y resultado ───────────────────────────────────────────────
  const itemsParams = useMemo(() => ({ page: itemsPage, size: ITEMS_PAGE_SIZE }), [itemsPage])
  const itemsPolling = job.data != null && !COLLATION_CONVERSION_TERMINAL_STATUSES.has(job.data.status)
  const items = useCollationConversionItems(jobId ?? 0, itemsParams, jobId != null && step === 'monitor', itemsPolling)

  const cancel = useWrapMutation<CollationConversionSummaryOut, number, void>(
    cancelRaw,
    () => jobId ?? 0,
    { onError: handleActionError },
  )

  // ── Navegación ──────────────────────────────────────────────────────────────────
  const next = useCallback(() => {
    setStep((current) => {
      const idx = order.indexOf(current)
      return idx >= 0 && idx < order.length - 1 ? order[idx + 1]! : current
    })
  }, [order])
  const back = useCallback(() => {
    setStep((current) => {
      const idx = order.indexOf(current)
      return idx > 0 ? order[idx - 1]! : current
    })
  }, [order])
  const goToStep = useCallback((target: CollationConversionWizardStep) => setStep(target), [])
  const canBack = order.indexOf(step) > 0 && step !== 'monitor'

  const replan = useCallback(() => {
    setStep('plan')
  }, [])

  const reset = useCallback(() => {
    setStep(presetJobId != null ? 'summary' : 'plan')
    setJobId(presetJobId ?? null)
    setTargetCharset(null)
    setTargetCollation('')
    resetJobScopedState()
    createPlanRaw.reset()
  }, [presetJobId, resetJobScopedState, createPlanRaw])

  return {
    serverId,
    serverName,
    database,
    engine,
    mode,

    step,
    order,
    canBack,
    next,
    back,
    goToStep,
    replan,
    reset,

    jobId,
    job,
    targetCharset,
    setTargetCharset,
    targetCollation,
    setTargetCollation,
    createPlan,

    objects,
    reloadInventory,
    checkedTables,
    toggleTable,
    checkedObjects,
    toggleObject,
    includeDatabaseDefault,
    setIncludeDatabaseDefault,

    preview,
    refreshPreview,
    savedConfirmToken,
    savedTotals,
    confirmTargetName,
    setConfirmTargetName,
    force,
    setForce,
    execute,

    itemsPage,
    setItemsPage,
    items,
    cancel,

    actionCooldown,
  }
}
