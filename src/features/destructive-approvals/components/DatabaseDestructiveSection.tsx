import { useState } from 'react'
import { Button, Callout, Card, CardContent } from '@/components/ui'
import {
  useApplyMigrations,
  useRollbackMigration,
} from '@/features/managed-databases/hooks/use-db-migrations'
import { toApiError } from '@/lib/api/errors'
import type { DestructivePlan } from '@/lib/contracts'
import { destructiveApprovalMessage, requiresNewDryRun } from '../messages'
import { DestructiveConfirmDialog } from './DestructiveConfirmDialog'
import { DestructivePlanCard } from './DestructivePlanCard'

type PlanKind = 'apply' | 'rollback'

interface PlannedOperation {
  kind: PlanKind
  plan: DestructivePlan
}

interface DatabaseDestructiveSectionProps {
  databaseId: number
  serverId: number
  environmentId: number | null
  /** Versión actual de la base: es el `confirm_version` del rollback. */
  currentVersion: string | null
  /** Destino del rollback (el mismo campo que usa la tarjeta de rollback). Vacío = solo la última. */
  rollbackTarget: string
  /** Por qué no se puede operar ahora (base sin crear, contabilidad huérfana…); `null` = se puede. */
  blockedReason: string | null
}

/**
 * Camino con confirmación para apply y rollback en entornos que bloquean lo destructivo.
 *
 * El flujo es siempre el mismo y en este orden: PLANIFICAR (dry-run, no toca el motor) → leer el
 * plan destructivo con el estado de aprobación de cada versión → CONFIRMAR re-tipeando el nombre
 * de la base, con step-up → ejecutar mandando el `confirm_token` del dry-run y el nombre.
 *
 * El token vive 300 s y está atado a las aprobaciones exactas del plan. Si venció, o una
 * aprobación se revocó o cambió, el servidor lo rechaza y esta sección vuelve a pedir un dry-run
 * en vez de mostrar un fallo genérico. Nunca se reintenta solo: ejecutar es decisión de la persona.
 */
export function DatabaseDestructiveSection({
  databaseId,
  serverId,
  environmentId,
  currentVersion,
  rollbackTarget,
  blockedReason,
}: DatabaseDestructiveSectionProps) {
  const apply = useApplyMigrations(databaseId)
  const rollback = useRollbackMigration(databaseId)
  const [operation, setOperation] = useState<PlannedOperation | null>(null)
  // `null` = todavía no se planificó; `true` = se planificó y el servidor no pidió nada especial.
  const [noPlanKind, setNoPlanKind] = useState<PlanKind | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Qué operación se estaba haciendo: tras un rechazo el plan se descarta y «volver a planificar»
  // tiene que repetir la MISMA operación, no otra.
  const [lastKind, setLastKind] = useState<PlanKind>('apply')
  const [rejectionCode, setRejectionCode] = useState<string | null>(null)
  const [rejectionText, setRejectionText] = useState<string | null>(null)

  const isBusy = apply.isPending || rollback.isPending
  const trimmedTarget = rollbackTarget.trim()

  const resetOutcome = () => {
    setOperation(null)
    setNoPlanKind(null)
    setConfirming(false)
    setRejectionCode(null)
    setRejectionText(null)
  }

  const rememberRejection = (error: unknown) => {
    const apiError = toApiError(error)
    setRejectionCode(apiError.code ?? null)
    setRejectionText(
      destructiveApprovalMessage(apiError.code, apiError.selfApprovalRule) ?? apiError.message,
    )
    // Token vencido o inválido: el plan que se ve ya no sirve para ejecutar.
    if (requiresNewDryRun(apiError.code)) setOperation(null)
  }

  const planApply = () => {
    resetOutcome()
    setLastKind('apply')
    apply.mutate(
      { dryRun: true },
      {
        onSuccess: (result) => {
          if (result.destructive_plan) {
            setOperation({ kind: 'apply', plan: result.destructive_plan })
          } else {
            setNoPlanKind('apply')
          }
        },
      },
    )
  }

  const planRollback = () => {
    resetOutcome()
    setLastKind('rollback')
    rollback.mutate(
      { dryRun: true, targetVersion: trimmedTarget || undefined },
      {
        onSuccess: (result) => {
          if (result.destructive_plan) {
            setOperation({ kind: 'rollback', plan: result.destructive_plan })
          } else {
            setNoPlanKind('rollback')
          }
        },
      },
    )
  }

  const execute = () => {
    if (operation === null) return
    const { kind, plan } = operation
    const confirmToken = plan.confirm_token ?? undefined
    const confirmName = plan.confirm_name_expected
    const onSuccess = () => resetOutcome()
    const onError = (error: unknown) => {
      setConfirming(false)
      rememberRejection(error)
    }
    if (kind === 'apply') {
      apply.mutate({ dryRun: false, confirmToken, confirmName }, { onSuccess, onError })
    } else {
      rollback.mutate(
        {
          dryRun: false,
          confirmVersion: currentVersion ?? undefined,
          targetVersion: trimmedTarget || undefined,
          confirmToken,
          confirmName,
        },
        { onSuccess, onError },
      )
    }
  }

  const canExecute =
    operation !== null &&
    operation.plan.all_approved &&
    operation.plan.executor_allowed &&
    Boolean(operation.plan.confirm_token) &&
    blockedReason === null

  return (
    <Card className="border-warning/40">
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Migraciones destructivas en entornos protegidos
        </h2>
        <p className="text-xs text-muted-foreground">
          Si el entorno de esta base bloquea lo destructivo, apply y rollback exigen aprobación de
          una segunda persona. Planificá primero: el plan no toca el motor y muestra qué falta.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            isLoading={apply.isPending && apply.variables?.dryRun === true}
            disabled={isBusy || blockedReason !== null}
            onClick={planApply}
          >
            Planificar apply
          </Button>
          <Button
            variant="outline"
            size="sm"
            isLoading={rollback.isPending && rollback.variables?.dryRun === true}
            disabled={isBusy || blockedReason !== null || currentVersion === null}
            onClick={planRollback}
          >
            Planificar rollback
          </Button>
        </div>
        {blockedReason && <p className="text-xs text-error">{blockedReason}</p>}

        {noPlanKind && (
          <p className="text-xs text-muted-foreground">
            El servidor no pide aprobación para este {noPlanKind === 'apply' ? 'apply' : 'rollback'}
            : el entorno no bloquea lo destructivo o no hay versiones destructivas en juego. Se
            ejecuta con los botones de siempre.
          </p>
        )}

        {operation && (
          <>
            <DestructivePlanCard plan={operation.plan} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={!canExecute || isBusy}
                onClick={() => setConfirming(true)}
              >
                {operation.kind === 'apply'
                  ? 'Aplicar con confirmación…'
                  : 'Revertir con confirmación…'}
              </Button>
              <span className="text-xs text-muted-foreground">
                La confirmación vale 5 minutos desde que planificaste.
              </span>
            </div>
          </>
        )}

        {rejectionText && (
          <Callout
            tone="danger"
            title={
              requiresNewDryRun(rejectionCode)
                ? 'Hay que volver a planificar'
                : 'No se ejecutó la migración'
            }
          >
            <p>{rejectionText}</p>
            {requiresNewDryRun(rejectionCode) && (
              <p className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={lastKind === 'rollback' ? planRollback : planApply}
                >
                  Volver a planificar
                </Button>
              </p>
            )}
          </Callout>
        )}
      </CardContent>

      {confirming && operation && (
        <DestructiveConfirmDialog
          title={
            operation.kind === 'apply'
              ? 'Aplicar migraciones destructivas'
              : 'Revertir migraciones destructivas'
          }
          description={`Se va a ejecutar SQL destructivo sobre «${operation.plan.confirm_name_expected}». No se puede deshacer.`}
          confirmWord={operation.plan.confirm_name_expected}
          confirmLabel={operation.kind === 'apply' ? 'Aplicar' : 'Revertir'}
          isLoading={isBusy}
          guardScope={{ serverId, environmentId }}
          onConfirm={execute}
          onClose={() => setConfirming(false)}
        >
          <DestructivePlanCard plan={operation.plan} hasApprovalsPanel={false} />
        </DestructiveConfirmDialog>
      )}
    </Card>
  )
}
