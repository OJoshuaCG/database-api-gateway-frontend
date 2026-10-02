import { useId, useState, type FormEvent } from 'react'
import { Button, Input } from '@/components/ui'
import { AUDIT_ACTOR_TYPES, type AuditActorType, type AuditLogFilters } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import {
  AUDIT_ACTION_PRESETS,
  AUDIT_ACTOR_TYPE_LABELS,
  AUDIT_LIMITS,
  AUDIT_STATUS,
  isInvalidRange,
  localInputToUtc,
  utcToLocalInput,
} from '../audit-model'

/** Clases del `<select>` nativo: no hay un select plano en el inventario compartido. */
const SELECT_CLASSES =
  'h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

/** Los filtros que la barra edita. El resto (`target_type`, `server_id`…) llega solo por URL. */
interface Draft {
  action: string
  actor_type: AuditActorType | ''
  admin_username: string
  status: string
  request_id: string
  /** Hora LOCAL del `datetime-local`; se pasa a UTC al aplicar. */
  from: string
  to: string
}

function draftFrom(filters: AuditLogFilters): Draft {
  return {
    action: filters.action ?? '',
    actor_type: filters.actor_type ?? '',
    admin_username: filters.admin_username ?? '',
    status: filters.status ?? '',
    request_id: filters.request_id ?? '',
    from: utcToLocalInput(filters.from),
    to: utcToLocalInput(filters.to),
  }
}

/** Mezcla el borrador sobre los filtros de la URL: los que la barra no edita se conservan. */
function toFilters(base: AuditLogFilters, draft: Draft): AuditLogFilters {
  const text = (value: string) => value.trim() || undefined
  return {
    ...base,
    action: text(draft.action),
    actor_type: draft.actor_type || undefined,
    admin_username: text(draft.admin_username),
    status: text(draft.status),
    request_id: text(draft.request_id),
    from: localInputToUtc(draft.from),
    to: localInputToUtc(draft.to),
  }
}

export interface AuditFilterBarProps {
  /** Los filtros de la URL. Quien monta la barra le pone `key` con la URL: así se reinicia sola. */
  filters: AuditLogFilters
  onApply: (filters: AuditLogFilters) => void
  onClear: () => void
}

/**
 * Barra de filtros de la auditoría. Edita un borrador local y lo escribe en la URL al aplicar:
 * escribir en la URL por pulsación dispararía un `GET` por letra. El estado se inicializa UNA vez
 * desde la URL; cuando la URL cambia desde afuera (atrás, un preset, «Ver todo el request») el
 * padre la remonta con otra `key`, sin `setState` en efectos.
 */
export function AuditFilterBar({ filters, onApply, onClear }: AuditFilterBarProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(filters))
  const presetsId = useId()
  const statusId = useId()
  const actorTypeId = useId()
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }))

  const next = toFilters(filters, draft)
  const invalidRange = isInvalidRange(next)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!invalidRange) onApply(next)
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Filtros de la auditoría"
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground" id={presetsId}>
          Acciones frecuentes
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={presetsId}>
          {AUDIT_ACTION_PRESETS.map((preset) => {
            const active = draft.action === preset.value
            return (
              <Button
                key={preset.value}
                type="button"
                size="sm"
                variant={active ? 'outline' : 'ghost'}
                aria-pressed={active}
                className={cn(active && 'border-primary text-primary')}
                // Aplica al toque, con lo demás del borrador: un preset que solo rellenara el
                // campo obligaría a un segundo clic para algo que ya se decidió.
                onClick={() => {
                  const value = active ? '' : preset.value
                  set('action', value)
                  onApply(toFilters(filters, { ...draft, action: value }))
                }}
              >
                {preset.label} <code className="font-mono text-xs">{preset.value}</code>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label="Acción"
          value={draft.action}
          maxLength={AUDIT_LIMITS.action}
          placeholder="gateway_user.access_set o access.*"
          hint="Exacta, o prefijo si termina en *."
          onChange={(event) => set('action', event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={actorTypeId} className="text-sm font-medium text-foreground">
            Tipo de actor
          </label>
          <select
            id={actorTypeId}
            value={draft.actor_type}
            onChange={(event) => set('actor_type', event.target.value as AuditActorType | '')}
            className={SELECT_CLASSES}
          >
            <option value="">Todos</option>
            {AUDIT_ACTOR_TYPES.map((type) => (
              <option key={type} value={type}>
                {AUDIT_ACTOR_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Usuario"
          value={draft.admin_username}
          maxLength={AUDIT_LIMITS.username}
          placeholder="ana"
          hint="Username exacto. Un token figura como token:<id público>."
          onChange={(event) => set('admin_username', event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={statusId} className="text-sm font-medium text-foreground">
            Estado
          </label>
          <select
            id={statusId}
            value={draft.status}
            onChange={(event) => set('status', event.target.value)}
            className={SELECT_CLASSES}
          >
            <option value="">Todos</option>
            {Object.entries(AUDIT_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {/* Un estado que llegó por URL y la lista no conoce se conserva como opción. */}
            {draft.status && !(draft.status in AUDIT_STATUS) && (
              <option value={draft.status}>{draft.status}</option>
            )}
          </select>
        </div>
        <Input
          label="Desde"
          type="datetime-local"
          value={draft.from}
          hint="Hora local, inclusive."
          onChange={(event) => set('from', event.target.value)}
        />
        <Input
          label="Hasta"
          type="datetime-local"
          value={draft.to}
          hint={invalidRange ? undefined : 'Hora local, sin incluir.'}
          error={invalidRange ? '«Hasta» tiene que ser posterior a «Desde».' : undefined}
          onChange={(event) => set('to', event.target.value)}
        />
        <Input
          label="Request ID"
          value={draft.request_id}
          maxLength={AUDIT_LIMITS.requestId}
          className="font-mono"
          hint="Todo lo que dejó un mismo request."
          onChange={(event) => set('request_id', event.target.value)}
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClear}>
          Limpiar filtros
        </Button>
        <Button type="submit" disabled={invalidRange}>
          Aplicar filtros
        </Button>
      </div>
    </form>
  )
}
