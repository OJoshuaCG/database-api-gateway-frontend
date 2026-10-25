import { useState } from 'react'
import { Badge, Button, Callout, CodeBlock, Input, Modal, Spinner, Textarea } from '@/components/ui'
import { CapabilityHint, useCapabilityGuard, useStepUp } from '@/features/auth'
import {
  isStaleMigrationDetail,
  useModelMigration,
} from '@/features/database-models/hooks/use-model-migrations'
import { toApiError } from '@/lib/api/errors'
import {
  APPROVAL_REASON_MAX_LENGTH,
  APPROVAL_REASON_MIN_LENGTH,
  CAPABILITIES,
  type DestructiveDirection,
  type DestructiveVersion,
} from '@/lib/contracts'
import { useApproveDestructive } from '../hooks/use-destructive-approvals'
import { destructiveApprovalMessage, directionLabel } from '../messages'

interface ApproveDestructiveDialogProps {
  modelId: number
  version: DestructiveVersion
  /** Con base = aprobación solo para esa base; sin base = para todo el blueprint. */
  managedDatabaseId?: number
  /**
   * Lo que hay que re-tipear para habilitar el envío: el nombre de la base (alcance base) o el del
   * blueprint (alcance blueprint). Es una confirmación SOLO de pantalla: el servidor no la recibe.
   */
  confirmWord: string
  /** Alcance de la capa 2 para la pista de permisos; sin él rige el rol base. */
  guardScope?: { serverId: number | null; environmentId: number | null }
  onClose: () => void
}

/**
 * Aprueba UNA versión en UNA dirección para ejecutarla en entornos protegidos.
 *
 * Qué se firma es el SQL que se ve acá: el diálogo manda `expected_sql_hash` con el hash que tenía
 * la versión cuando se abrió. Si alguien edita el SQL mientras se lee, el servidor responde 409
 * `sql_changed` y no se aprueba nada, así que no se puede firmar un SQL distinto del que se miró.
 *
 * El nombre re-tipeado (`confirmWord`) no viaja: es fricción deliberada de pantalla, porque
 * aprobar es lo que habilita un DROP sobre producción.
 */
export function ApproveDestructiveDialog({
  modelId,
  version,
  managedDatabaseId,
  confirmWord,
  guardScope,
  onClose,
}: ApproveDestructiveDialogProps) {
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')

  const approve = useApproveDestructive(modelId)
  const stepUp = useStepUp()
  const guard = useCapabilityGuard(
    CAPABILITIES.blueprintsApproveDestructive,
    'aprobar migraciones destructivas',
    { scope: guardScope },
  )
  const detail = useModelMigration(modelId, version.version, true)
  const detailReady =
    detail.data !== undefined && !isStaleMigrationDetail(detail.data, version.version)

  const direction = version.direction as DestructiveDirection
  const trimmedReason = reason.trim()
  const reasonValid =
    trimmedReason.length >= APPROVAL_REASON_MIN_LENGTH &&
    trimmedReason.length <= APPROVAL_REASON_MAX_LENGTH
  const typedMatches = typed === confirmWord
  const canSubmit = guard.allowed && reasonValid && typedMatches && !approve.isPending

  const rejection = approve.isError ? toApiError(approve.error) : null
  const rejectionText = rejection
    ? (destructiveApprovalMessage(rejection.code, rejection.selfApprovalRule) ?? rejection.message)
    : null
  const scopeText =
    managedDatabaseId === undefined
      ? 'todas las bases protegidas de este blueprint (incluidas las que se creen después)'
      : 'solo esta base'

  const submit = () => {
    stepUp.withFresh(CAPABILITIES.blueprintsApproveDestructive, () =>
      approve.mutate(
        {
          version: version.version,
          managedDatabaseId,
          input: { direction, expectedSqlHash: version.sql_hash, reason: trimmedReason },
        },
        { onSuccess: onClose },
      ),
    )
  }

  const engineReasons = Object.entries(version.reasons_by_engine)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Aprobar la versión ${version.version} (${directionLabel(version.direction).toLowerCase()})`}
      description={`Habilita ejecutar este SQL destructivo en ${scopeText}.`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={approve.isPending}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={!canSubmit}
            isLoading={approve.isPending}
            aria-describedby={guard.describedBy}
            onClick={submit}
          >
            Aprobar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Callout tone="warning" title="Otra persona tiene que aprobar">
          <p>
            Quien creó la versión o editó su SQL por última vez no puede aprobarla (cuatro ojos). La
            aprobación vale solo para el SQL de abajo: si se edita, hay que aprobar de nuevo.
          </p>
        </Callout>

        {version.author_unknown && (
          <Callout tone="info" title="Autoría incompleta">
            <p>
              No se conoce quién creó o editó esta versión, así que la regla de cuatro ojos no se
              pudo verificar del todo. Queda registrado en la auditoría.
            </p>
          </Callout>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{version.name}</span>
          <Badge tone="neutral">{directionLabel(version.direction)}</Badge>
          <span>
            Creada por <strong>{version.author.username ?? 'desconocido'}</strong> · último editor{' '}
            <strong>{version.last_sql_editor.username ?? 'desconocido'}</strong>
          </span>
        </div>

        {engineReasons.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {engineReasons.map(([engine, reasons]) => (
              <li key={engine}>
                <strong className="text-foreground">{engine}</strong>: {reasons.join(', ')}
              </li>
            ))}
          </ul>
        )}

        {/*
          El SQL que se firma. Se lee del detalle de la migración (los overrides por motor forman
          parte del hash `raw_source_v1`, por eso se muestran los tres si existen).
        */}
        {detail.isLoading || (detail.data !== undefined && !detailReady) ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando el SQL…
          </div>
        ) : detail.isError ? (
          <Callout tone="danger" title="No se pudo cargar el SQL">
            <p>Sin ver el SQL no se puede aprobar. Cerrá el diálogo y reintentá.</p>
          </Callout>
        ) : detail.data ? (
          <div className="flex flex-col gap-3">
            {direction === 'up' ? (
              <>
                <CodeBlock title="SQL (up)" code={detail.data.up_sql} />
                {detail.data.up_sql_mysql && (
                  <CodeBlock title="Override MySQL / MariaDB" code={detail.data.up_sql_mysql} />
                )}
                {detail.data.up_sql_postgresql && (
                  <CodeBlock title="Override PostgreSQL" code={detail.data.up_sql_postgresql} />
                )}
              </>
            ) : (
              <CodeBlock
                title="SQL de reversa (down)"
                code={detail.data.down_sql ?? ''}
                emptyLabel="Esta versión no tiene down_sql."
              />
            )}
          </div>
        ) : null}

        <Textarea
          label="Motivo de la aprobación"
          rows={3}
          maxLength={APPROVAL_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint={`Entre ${APPROVAL_REASON_MIN_LENGTH} y ${APPROVAL_REASON_MAX_LENGTH} caracteres. Queda en la auditoría.`}
          error={
            reason !== '' && !reasonValid
              ? `Escribí al menos ${APPROVAL_REASON_MIN_LENGTH} caracteres.`
              : undefined
          }
        />

        <Input
          label={`Escribí «${confirmWord}» para confirmar`}
          value={typed}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          error={
            typed !== '' && !typedMatches ? `Debe ser exactamente «${confirmWord}».` : undefined
          }
          onChange={(event) => setTyped(event.target.value)}
        />

        <CapabilityHint guard={guard} />

        {rejectionText && (
          <Callout tone="danger" title="No se aprobó la migración">
            <p>{rejectionText}</p>
          </Callout>
        )}
      </div>
    </Modal>
  )
}
