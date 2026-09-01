import { useCallback, useMemo, useState } from 'react'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import { useReconcile } from '@/features/servers/hooks/use-reconcile'
import type {
  CloneCopyIntent,
  CloneDataOnExisting,
  CloneTargetMode,
  ReconcileDatabaseItem,
} from '@/lib/contracts'
import type { CloneObjectType } from '@/lib/contracts'
import { useCloneBatch, useCloneBatchItems, useCloneBatchRetryCandidates } from '../hooks/use-clone-batches'
import {
  useCancelCloneBatch,
  useCreateCloneBatch,
  useExecuteCloneBatch,
  useRetryCloneBatch,
} from '../hooks/use-clone-batch-actions'
import {
  applyAffixToRows,
  buildCreateBatchBody,
  clonableDatabases,
  duplicateTargetNames,
  INITIAL_BATCH_PLAN,
  patchRow,
  rowsNeedingDataOnly,
  setAllRows,
  toggleRow,
  type BatchPlanState,
  type BatchRowDraft,
} from './logic'
import { CLONE_BATCH_TERMINAL_STATUSES } from '@/lib/contracts'

export type BatchStep = 'plan' | 'databases' | 'confirm' | 'monitor'

const STEP_ORDER: BatchStep[] = ['plan', 'databases', 'confirm', 'monitor']

export function useCloneBatchWizard(
  presetBatchId?: number,
  /**
   * Se llama cuando el lote ya está ENCOLADO, para que la página navegue a la dirección propia
   * del lote. Sin esto el id vivía solo en este estado y salirse de la vista lo volvía
   * inalcanzable — y un lote, que corre sus bases en serie durante mucho tiempo, es justamente
   * la operación donde más probable es irse.
   */
  onExecuted?: (batchId: number) => void,
) {
  const [step, setStep] = useState<BatchStep>(presetBatchId != null ? 'monitor' : 'plan')
  const [batchId, setBatchId] = useState<number | null>(presetBatchId ?? null)
  const [plan, setPlan] = useState<BatchPlanState>(INITIAL_BATCH_PLAN)
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [confirmServerName, setConfirmServerName] = useState('')
  const [itemsPage, setItemsPage] = useState(1)
  const itemsSize = 25

  const serverOptions = useServerOptions()
  const serverById = useMemo(() => {
    const map = new Map<number, { id: number; name: string; engine: string }>()
    for (const server of serverOptions.data ?? []) map.set(server.id, server)
    return map
  }, [serverOptions.data])

  // Bases vivas de cada lado. `useReconcile` ya distingue adoptadas de crudas y descarta las
  // `orphan` (en el inventario pero ya no en el motor), que no hay nada que clonar.
  const sourceReconcile = useReconcile(plan.sourceServerId ?? 0, plan.sourceServerId != null)
  const targetReconcile = useReconcile(plan.targetServerId ?? 0, plan.targetServerId != null)

  const sourceDatabases = useMemo(
    () => clonableDatabases(sourceReconcile.data?.databases ?? []),
    [sourceReconcile.data],
  )
  /** Nombres que YA existen en el destino: alimenta el chip por fila. */
  const targetNames = useMemo(
    () => new Set((targetReconcile.data?.databases ?? []).map((db) => db.name)),
    [targetReconcile.data],
  )

  // ── Setters del plan ────────────────────────────────────────────────────────────
  const setSourceServerId = useCallback((id: number | null) => {
    // Cambiar de origen invalida las filas: son bases de OTRO servidor.
    setPlan((prev) => ({ ...prev, sourceServerId: id, rows: new Map() }))
  }, [])
  const setTargetServerId = useCallback((id: number | null) => {
    setPlan((prev) => ({ ...prev, targetServerId: id }))
  }, [])
  const setCopyIntent = useCallback((value: CloneCopyIntent) => {
    setPlan((prev) => ({ ...prev, copyIntent: value }))
  }, [])
  const setDataOnExisting = useCallback((value: CloneDataOnExisting) => {
    setPlan((prev) => ({ ...prev, dataOnExisting: value }))
  }, [])
  const setRuleTypes = useCallback((types: CloneObjectType[]) => {
    setPlan((prev) => ({ ...prev, rule: { ...prev.rule, types } }))
  }, [])
  const setRuleIncludePatterns = useCallback((value: string) => {
    setPlan((prev) => ({ ...prev, rule: { ...prev.rule, includePatterns: value } }))
  }, [])
  const setRuleExcludePatterns = useCallback((value: string) => {
    setPlan((prev) => ({ ...prev, rule: { ...prev.rule, excludePatterns: value } }))
  }, [])

  const toggleDatabase = useCallback((item: ReconcileDatabaseItem) => {
    setPlan((prev) => ({ ...prev, rows: toggleRow(prev.rows, item) }))
  }, [])
  const selectAll = useCallback(
    (selected: boolean) => {
      setPlan((prev) => ({ ...prev, rows: setAllRows(prev.rows, sourceDatabases, selected) }))
    },
    [sourceDatabases],
  )
  const setRowTargetName = useCallback((key: string, name: string) => {
    setPlan((prev) => ({ ...prev, rows: patchRow(prev.rows, key, { targetDatabaseName: name }) }))
  }, [])
  const setRowTargetMode = useCallback((key: string, mode: CloneTargetMode) => {
    setPlan((prev) => ({ ...prev, rows: patchRow(prev.rows, key, { targetMode: mode }) }))
  }, [])
  const applyAffix = useCallback(() => {
    setPlan((prev) => ({ ...prev, rows: applyAffixToRows(prev.rows, { prefix, suffix }) }))
  }, [prefix, suffix])

  // ── Validación en vivo ──────────────────────────────────────────────────────────
  const duplicates = useMemo(() => duplicateTargetNames(plan.rows), [plan.rows])
  const needDataOnly = useMemo(
    () => rowsNeedingDataOnly(plan.rows, plan.copyIntent),
    [plan.rows, plan.copyIntent],
  )
  const createBody = useMemo(() => buildCreateBatchBody(plan), [plan])

  // ── Mutaciones ──────────────────────────────────────────────────────────────────
  const createBatch = useCreateCloneBatch()
  const execute = useExecuteCloneBatch(batchId ?? 0)
  const cancel = useCancelCloneBatch(batchId ?? 0)
  const retry = useRetryCloneBatch(batchId ?? 0)

  const submitPlan = useCallback(() => {
    if (!createBody) return
    createBatch.mutate(createBody, {
      onSuccess: (batch) => {
        setBatchId(batch.id)
        setConfirmServerName('')
        setItemsPage(1)
        setStep('confirm')
      },
    })
  }, [createBody, createBatch])

  // ── Lote en curso ───────────────────────────────────────────────────────────────
  const batch = useCloneBatch(batchId ?? 0, batchId != null)
  const polling = batch.data != null && !CLONE_BATCH_TERMINAL_STATUSES.has(batch.data.status)
  const itemsParams = useMemo(() => ({ page: itemsPage, size: itemsSize }), [itemsPage])
  const items = useCloneBatchItems(batchId ?? 0, itemsParams, batchId != null, polling)
  // Solo con el lote TERMINADO: antes, "qué se puede reintentar" no tiene respuesta estable, y
  // además el endpoint consulta el estado vivo del servidor destino.
  const retryCandidates = useCloneBatchRetryCandidates(
    batchId ?? 0,
    batchId != null && batch.data != null && CLONE_BATCH_TERMINAL_STATUSES.has(batch.data.status),
  )

  const targetServerName = plan.targetServerId
    ? (serverById.get(plan.targetServerId)?.name ?? '')
    : ''
  const confirmMatches =
    confirmServerName.trim().length > 0 && confirmServerName.trim() === targetServerName

  const submitExecute = useCallback(() => {
    if (!batch.data || !confirmMatches) return
    execute.mutate(
      { confirm_server_name: confirmServerName.trim(), confirm_token: batch.data.confirm_token },
      {
        onSuccess: () => {
          if (onExecuted && batchId != null) onExecuted(batchId)
          else setStep('monitor')
        },
      },
    )
  }, [batch.data, confirmMatches, confirmServerName, execute, onExecuted, batchId])

  const submitRetry = useCallback(() => {
    retry.mutate(undefined, {
      onSuccess: (nuevo) => {
        // El lote de reintento también tiene dirección propia: vuelve a pedir confirmación,
        // así que el operador tiene que poder volver a él si se va de la vista.
        if (onExecuted) {
          onExecuted(nuevo.id)
          return
        }
        setBatchId(nuevo.id)
        setConfirmServerName('')
        setItemsPage(1)
        setStep('confirm')
      },
    })
  }, [retry, onExecuted])

  const reset = useCallback(() => {
    setStep('plan')
    setBatchId(null)
    setPlan(INITIAL_BATCH_PLAN)
    setPrefix('')
    setSuffix('')
    setConfirmServerName('')
    setItemsPage(1)
    createBatch.reset()
    execute.reset()
  }, [createBatch, execute])

  const goToStep = useCallback((target: BatchStep) => setStep(target), [])

  return {
    step,
    order: STEP_ORDER,
    goToStep,

    plan,
    setSourceServerId,
    setTargetServerId,
    setCopyIntent,
    setDataOnExisting,
    setRuleTypes,
    setRuleIncludePatterns,
    setRuleExcludePatterns,

    serverOptions,
    sourceReconcile,
    targetReconcile,
    sourceDatabases,
    targetNames,
    targetServerName,

    toggleDatabase,
    selectAll,
    setRowTargetName,
    setRowTargetMode,
    prefix,
    setPrefix,
    suffix,
    setSuffix,
    applyAffix,

    duplicates,
    needDataOnly,
    createBody,
    createBatch,
    submitPlan,

    batchId,
    batch,
    items,
    itemsPage,
    itemsSize,
    setItemsPage,
    retryCandidates,

    confirmServerName,
    setConfirmServerName,
    confirmMatches,
    execute,
    submitExecute,
    cancel,
    retry,
    submitRetry,
    reset,
  }
}

export type CloneBatchWizard = ReturnType<typeof useCloneBatchWizard>
export type { BatchRowDraft }
