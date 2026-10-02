import type { ReactNode } from 'react'
import { Badge, Button, ErrorState, Modal, Spinner } from '@/components/ui'
import { ForbiddenState, isAccessForbidden } from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { AUDIT_ERROR_CODES, type AuditLogEntry } from '@/lib/contracts'
import { formatUtcDateTime } from '@/lib/utils/format'
import { auditActorLabel, auditStatus, auditTargetLabel } from '../audit-model'
import { useAuditLogEntry } from '../hooks/use-audit-log'

export interface AuditEntryDetailModalProps {
  entryId: number
  /** La fila de la página en pantalla, si está: el diálogo se pinta sin esperar el `GET`. */
  placeholder?: AuditLogEntry
  onClose: () => void
  /** «Ver todo el request»: filtra la tabla por el `request_id` de esta entrada. */
  onFilterRequest: (requestId: string) => void
}

/**
 * Detalle de una entrada de auditoría (`GET /audit-log/{id}`, v29 §11.4).
 *
 * `detail_json` se muestra **tal cual**, con sangría y en monoespaciada: su forma depende de la
 * acción y la UI no la interpreta (interpretarla sería mantener un esquema por acción que el
 * backend no publica). Si `detail` no era JSON, va el texto guardado. Se monta condicionalmente:
 * cada entrada abre con su estado fresco.
 */
export function AuditEntryDetailModal({
  entryId,
  placeholder,
  onClose,
  onFilterRequest,
}: AuditEntryDetailModalProps) {
  const query = useAuditLogEntry(entryId, placeholder)
  const entry = query.data

  const body = (() => {
    if (entry) return <EntryDetail entry={entry} onFilterRequest={onFilterRequest} />
    if (query.isError) {
      if (isAccessForbidden(query.error)) return <ForbiddenState />
      const apiError = toApiError(query.error)
      return (
        <ErrorState
          error={query.error}
          message={
            apiError.code === AUDIT_ERROR_CODES.notFound
              ? 'Esa entrada de auditoría no existe.'
              : undefined
          }
          onRetry={apiError.status === 404 ? undefined : () => void query.refetch()}
        />
      )
    }
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando la entrada…
      </div>
    )
  })()

  return (
    <Modal
      open
      onClose={onClose}
      title={entry ? `Entrada #${entry.id}` : `Entrada #${entryId}`}
      description={entry ? entry.action : undefined}
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {body}
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{children}</dd>
    </div>
  )
}

function EntryDetail({
  entry,
  onFilterRequest,
}: {
  entry: AuditLogEntry
  onFilterRequest: (requestId: string) => void
}) {
  const status = auditStatus(entry.status)
  const target = auditTargetLabel(entry)
  const isDcl = entry.grantee != null || entry.privilege != null || entry.grantor != null
  const json = entry.detail_json != null ? JSON.stringify(entry.detail_json, null, 2) : null

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Fecha">{formatUtcDateTime(entry.created_at)}</Field>
        <Field label="Estado">
          <Badge tone={status.tone}>{status.label}</Badge>
        </Field>
        <Field label="Actor">{auditActorLabel(entry)}</Field>
        <Field label="Acción">
          <code className="font-mono text-xs">{entry.action}</code>
          {entry.touched_engine && <span className="ml-1">🔌 tocó el motor</span>}
        </Field>
        <Field label="Destino">{target ?? '—'}</Field>
        <Field label="Servidor">{entry.server_id != null ? `#${entry.server_id}` : '—'}</Field>
        <Field label="IP">
          <span className="font-mono text-xs">{entry.ip ?? '—'}</span>
        </Field>
        <Field label="Request ID">
          {entry.request_id ? (
            <span className="flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-xs">{entry.request_id}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onFilterRequest(entry.request_id ?? '')}
              >
                Ver todo el request
              </Button>
            </span>
          ) : (
            '—'
          )}
        </Field>
      </dl>

      {isDcl && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Privilegio del motor</h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Beneficiario">{entry.grantee ?? '—'}</Field>
            <Field label="Privilegio">{entry.privilege ?? '—'}</Field>
            <Field label="Objeto">
              {[entry.object_level, entry.object_name].filter(Boolean).join(' · ') || '—'}
            </Field>
            <Field label="Con GRANT OPTION">
              {entry.with_grant_option == null ? '—' : entry.with_grant_option ? 'Sí' : 'No'}
            </Field>
            <Field label="Ejecutó">{entry.grantor ?? '—'}</Field>
          </dl>
        </section>
      )}

      <details open className="group rounded-lg border border-border">
        <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Detalle {json ? '(JSON)' : ''}
        </summary>
        <div className="border-t border-border p-3">
          {json ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 font-mono text-xs text-foreground">
              {json}
            </pre>
          ) : entry.detail ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 font-mono text-xs text-foreground">
              {entry.detail}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">Esta entrada no guardó detalle.</p>
          )}
        </div>
      </details>
    </div>
  )
}
