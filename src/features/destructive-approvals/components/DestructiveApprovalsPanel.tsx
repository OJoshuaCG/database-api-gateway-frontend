import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Spinner,
} from '@/components/ui'
import { useCapabilityGuard } from '@/features/auth'
import { CAPABILITIES, type DestructiveApproval, type DestructiveVersion } from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils/format'
import { useDestructiveVersions } from '../hooks/use-destructive-approvals'
import { DESTRUCTIVE_APPROVALS_ANCHOR_ID } from '../anchors'
import { approvalStatusLabel, approvalStatusTone, directionLabel } from '../messages'
import { ApproveDestructiveDialog } from './ApproveDestructiveDialog'
import { RevokeApprovalDialog } from './RevokeApprovalDialog'

/** La base sobre la que se evalúa y a la que se limita la aprobación (alcance `database`). */
export interface DestructiveApprovalsDatabase {
  id: number
  name: string
  serverId: number
  environmentId: number | null
}

interface DestructiveApprovalsPanelProps {
  modelId: number
  modelName?: string
  /**
   * Con base: el estado se evalúa PARA ella y aprobar vale solo para ella (alcance `database`).
   * Sin base: aprobar vale para todas las bases protegidas del blueprint (alcance `blueprint`).
   */
  database?: DestructiveApprovalsDatabase
}

/**
 * Versiones destructivas del blueprint con su estado de aprobación, y desde acá se aprueba y se
 * revoca.
 *
 * Una migración destructiva no corre en un entorno protegido hasta que una SEGUNDA persona la
 * aprueba. La aprobación está atada al SQL: editarlo la deja vencida (`stale_hash`) y pide aprobar
 * de nuevo. «Aprobada» acá es informativa, no un permiso para ejecutar: ejecutar sigue pidiendo
 * `blueprints.apply_destructive`, el re-tipeo del nombre y un token de confirmación.
 *
 * El botón «Aprobar» NO se renderiza sin `blueprints.approve_destructive` (no se deshabilita): un
 * control que nunca va a funcionar para esta persona solo la invita a pedir un acceso que quizá no
 * le corresponde, y la regla de cuatro ojos ya hace que muchos no puedan aprobar sus propias
 * versiones.
 */
export function DestructiveApprovalsPanel({
  modelId,
  modelName,
  database,
}: DestructiveApprovalsPanelProps) {
  const versions = useDestructiveVersions(modelId, database?.id ?? null)
  const approveGuard = useCapabilityGuard(
    CAPABILITIES.blueprintsApproveDestructive,
    'aprobar migraciones destructivas',
    {
      scope: database
        ? { serverId: database.serverId, environmentId: database.environmentId }
        : undefined,
    },
  )
  const [approving, setApproving] = useState<DestructiveVersion | null>(null)
  const [revoking, setRevoking] = useState<DestructiveApproval | null>(null)

  const confirmWord = database?.name ?? modelName ?? ''
  const rows = versions.data ?? []

  return (
    <Card id={DESTRUCTIVE_APPROVALS_ANCHOR_ID}>
      <CardHeader>
        <CardTitle>Aprobaciones de migraciones destructivas</CardTitle>
        <CardDescription>
          {database
            ? `Versiones con SQL destructivo (DROP, TRUNCATE…) y su estado para «${database.name}». Aprobar acá vale solo para esta base.`
            : 'Versiones con SQL destructivo (DROP, TRUNCATE…). Aprobar acá vale para todas las bases protegidas del blueprint, incluidas las que se creen después.'}{' '}
          Los entornos protegidos no las ejecutan hasta que una segunda persona las aprueba.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {versions.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Cargando versiones destructivas…
          </div>
        ) : versions.isError ? (
          <ErrorState
            error={versions.error}
            title="No se pudieron cargar las versiones destructivas"
            onRetry={() => void versions.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ninguna versión de este blueprint tiene SQL destructivo: no hay nada que aprobar.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => (
              <VersionRow
                key={`${row.migration_id}-${row.direction}`}
                row={row}
                canApprove={approveGuard.allowed}
                onApprove={() => setApproving(row)}
                onRevoke={setRevoking}
              />
            ))}
          </ul>
        )}
      </CardContent>

      {approving && (
        <ApproveDestructiveDialog
          key={`${approving.migration_id}-${approving.direction}`}
          modelId={modelId}
          version={approving}
          managedDatabaseId={database?.id}
          confirmWord={confirmWord}
          guardScope={
            database
              ? { serverId: database.serverId, environmentId: database.environmentId }
              : undefined
          }
          onClose={() => setApproving(null)}
        />
      )}
      {revoking && (
        <RevokeApprovalDialog
          key={revoking.id}
          modelId={modelId}
          approval={revoking}
          onClose={() => setRevoking(null)}
        />
      )}
    </Card>
  )
}

interface VersionRowProps {
  row: DestructiveVersion
  canApprove: boolean
  onApprove: () => void
  onRevoke: (approval: DestructiveApproval) => void
}

function VersionRow({ row, canApprove, onApprove, onRevoke }: VersionRowProps) {
  const liveApprovals = row.approvals.filter((approval) => approval.is_live)
  const reasons = Object.entries(row.reasons_by_engine)
  // Una aprobación vigente solo cubre si el hash coincide: con `approved` ya no hace falta
  // aprobar; con cualquier otro estado sí (primera vez, revocada o SQL cambiado).
  const needsApproval = row.approval_status !== 'approved'

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{row.version}</code>
          <span className="text-sm font-medium text-foreground">{row.name}</span>
          <Badge tone="neutral">{directionLabel(row.direction)}</Badge>
          <Badge tone={approvalStatusTone(row.approval_status)}>
            {approvalStatusLabel(row.approval_status)}
          </Badge>
        </div>
        {canApprove && needsApproval && (
          <Button size="sm" variant="outline" onClick={onApprove}>
            {row.approval_status === 'stale_hash' ? 'Aprobar de nuevo…' : 'Aprobar…'}
          </Button>
        )}
      </div>

      {reasons.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {reasons.map(([engine, list]) => `${engine}: ${list.join(', ')}`).join(' · ')}
        </p>
      )}

      {row.approval_status === 'stale_hash' && (
        <p className="text-xs text-error">
          El SQL cambió después de aprobarse: esa aprobación ya no vale y hay que aprobar de nuevo.
        </p>
      )}
      {row.approval_status === 'revoked' && (
        <p className="text-xs text-muted-foreground">
          La aprobación se revocó: la ejecución sigue bloqueada hasta aprobarla de nuevo.
        </p>
      )}

      {liveApprovals.map((approval) => (
        <div
          key={approval.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
        >
          <span>
            Aprobada por{' '}
            <strong className="text-foreground">
              {approval.approved_by.username ?? 'desconocido'}
            </strong>{' '}
            el {formatDateTime(approval.approved_at)} ·{' '}
            {approval.scope === 'blueprint' ? 'todo el blueprint' : 'una base'}
            {approval.execution_count > 0
              ? ` · ejecutada ${approval.execution_count} vez/veces`
              : ''}
            {approval.author_unknown ? ' · autoría incompleta' : ''}
          </span>
          <Button size="sm" variant="ghost" onClick={() => onRevoke(approval)}>
            Revocar…
          </Button>
        </div>
      ))}
    </li>
  )
}
