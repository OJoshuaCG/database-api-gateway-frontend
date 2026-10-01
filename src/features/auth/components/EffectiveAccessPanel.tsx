import { useId, useState, type ReactNode } from 'react'
import { Badge, Button, Callout, TrashIcon, type BadgeTone } from '@/components/ui'
import type { CapabilityDescriptor } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import {
  SCOPE_ENFORCEMENT_NOTE,
  groupByModule,
  isDestructive,
  isEnforcedByScopeToday,
  resolveEffectiveAccess,
  sortByRisk,
  summarizeLabels,
  type CapabilityDiff,
} from '../authz-model'
import { CapabilityFlags } from './CapabilityFlags'

/** Un permiso por alcance, con el nombre del destino ya resuelto por quien llama. */
export interface EffectiveAccessGrant {
  scopeType: string
  scopeId: number
  role: string
  /** «Producción», «db-prod-01». Si no se pudo resolver, algo como «Entorno #3». */
  targetLabel: string
}

interface EffectiveAccessPanelProps {
  baseRole: string
  globalCapabilities: readonly string[]
  grants: readonly EffectiveAccessGrant[]
  /** `undefined` = el catálogo no está disponible: el panel lo dice y no calcula nada. */
  catalog: readonly CapabilityDescriptor[] | undefined
  isLoading?: boolean
  /**
   * `admin`: lo que va a quedar al guardar el formulario de accesos de otra persona.
   * `self`: «Mi acceso», de solo lectura.
   */
  mode: 'admin' | 'self'
}

const PROVENANCE: Record<string, { label: string; tone: BadgeTone }> = {
  environment: { label: 'Permiso de entorno', tone: 'info' },
  server: { label: 'Permiso de servidor', tone: 'info' },
}

/**
 * Qué puede hacer una persona y DÓNDE: el rol base, cada permiso por alcance con lo que cambia
 * respecto del base, los cruces entre permisos y las capacidades globales.
 *
 * Todo sale de `resolveEffectiveAccess`, el espejo puro de `app/core/scope.py`. Lleva SIEMPRE la
 * nota de que hoy el recorte por alcance solo se hace cumplir en cuatro rutas: sin ella, el panel
 * prometería una restricción que en la mayoría de las operaciones todavía no existe.
 */
export function EffectiveAccessPanel({
  baseRole,
  globalCapabilities,
  grants,
  catalog,
  isLoading = false,
  mode,
}: EffectiveAccessPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  if (!catalog) {
    return (
      <p className="text-xs text-muted-foreground">
        {isLoading
          ? 'Cargando el catálogo de capacidades…'
          : 'No se pudo cargar el catálogo de capacidades, así que no se puede calcular el acceso efectivo.'}
      </p>
    )
  }

  const access = resolveEffectiveAccess({
    catalog,
    baseRole,
    globalCapabilities,
    grants,
  })
  const label = (ids: readonly string[]) => sortByRisk(ids, catalog).map((row) => row.label)
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const scopeTypeName = (scopeType: string) =>
    scopeType === 'environment' ? 'entorno' : scopeType === 'server' ? 'servidor' : scopeType

  return (
    <div className="flex flex-col gap-3">
      {mode === 'self' && grants.length === 0 && (
        <p className="text-sm text-foreground">
          Tenés el rol <strong>{baseRole}</strong> en todo el gateway, sin permisos por alcance.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        <AccessRow
          rowKey="base"
          badge={<Badge tone="neutral">Rol base</Badge>}
          title={`${baseRole} · ${access.baseCapabilities.length} capacidades`}
          detail="En todo lo que no tenga un permiso propio."
          expanded={expanded.has('base')}
          onToggle={() => toggle('base')}
          catalog={catalog}
          capabilities={access.baseCapabilities}
        />

        {access.grants.map(({ grant, capabilities, diff }, index) => {
          const targetLabel = grants[index]?.targetLabel ?? `#${grant.scopeId}`
          const provenance = PROVENANCE[grant.scopeType] ?? {
            label: `Permiso de ${grant.scopeType}`,
            tone: 'info' as const,
          }
          const key = `grant-${index}`
          return (
            <AccessRow
              key={key}
              rowKey={key}
              badge={<Badge tone={provenance.tone}>{provenance.label}</Badge>}
              title={`${targetLabel} · ${grant.role}`}
              detail={<DiffLine diff={diff} catalog={catalog} label={label} />}
              expanded={expanded.has(key)}
              onToggle={() => toggle(key)}
              catalog={catalog}
              capabilities={capabilities}
              lost={diff.lost}
            />
          )
        })}

        {access.overlaps.map((overlap, index) => {
          const environment = grants.find(
            (grant) =>
              grant.scopeType === 'environment' &&
              grant.scopeId === overlap.environmentGrant.scopeId,
          )
          const server = grants.find(
            (grant) =>
              grant.scopeType === 'server' && grant.scopeId === overlap.serverGrant.scopeId,
          )
          return (
            <li
              key={`overlap-${index}`}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"
            >
              Donde se cruzan {environment?.targetLabel ?? 'el entorno'} y{' '}
              {server?.targetLabel ?? 'el servidor'} rige el más restrictivo:{' '}
              <strong className="text-foreground">{overlap.role}</strong>.
            </li>
          )
        })}

        {access.globals.map((global) => {
          const key = `global-${global.id}`
          return (
            <AccessRow
              key={key}
              rowKey={key}
              badge={<Badge tone="primary">Capacidad global</Badge>}
              title={global.id}
              detail="En todo el gateway, sin importar el rol."
              expanded={expanded.has(key)}
              onToggle={() => toggle(key)}
              catalog={catalog}
              capabilities={global.capabilities}
            />
          )
        })}
      </ul>

      {grants.length > 0 && access.globalAxis.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Valen igual en todos los alcances, porque no dependen de un destino:{' '}
          {summarizeLabels(label(access.globalAxis))}.
        </p>
      )}

      {grants.length > 0 && (
        // `warning` solo cuando un permiso ELEVA por encima del base: ahí el rol más alto rige en
        // todo el gateway fuera de las cuatro rutas, y eso es una escalada real. Si los permisos
        // solo recortan, la nota es informativa.
        <Callout
          tone={access.unionRole !== baseRole ? 'warning' : 'info'}
          title="Dónde se aplica hoy cada permiso por alcance"
        >
          <p>{SCOPE_ENFORCEMENT_NOTE}</p>
          {access.unionRole !== baseRole && (
            <p>
              Por eso, hasta entonces, en esas otras operaciones{' '}
              {mode === 'self' ? 'tenés' : 'tiene'} el rol <strong>{access.unionRole}</strong> en
              todo el gateway, no solo en el{' '}
              {grants
                .filter((grant) => grant.role === access.unionRole)
                .map((grant) => `${scopeTypeName(grant.scopeType)} ${grant.targetLabel}`)
                .join(', ')}
              .
            </p>
          )}
        </Callout>
      )}

      {mode === 'self' && (
        <p className="text-xs text-muted-foreground">
          Si necesitás más acceso, pedíselo a quien administra los accesos.
        </p>
      )}
    </div>
  )
}

function DiffLine({
  diff,
  catalog,
  label,
}: {
  diff: CapabilityDiff
  catalog: readonly CapabilityDescriptor[]
  label: (ids: readonly string[]) => string[]
}) {
  if (diff.gained.length === 0 && diff.lost.length === 0) return <>Igual que el rol base.</>
  const touchesDestructive = sortByRisk([...diff.gained, ...diff.lost], catalog).some(isDestructive)
  // Lo perdido solo se hace cumplir hoy en la capa 2: decir «pierde 5» sin más prometería un
  // recorte que en la mayoría de las operaciones todavía no existe (F-37).
  const enforcedLost = diff.lost.filter(isEnforcedByScopeToday)
  const enforcement =
    enforcedLost.length === diff.lost.length
      ? ''
      : enforcedLost.length > 0
        ? ` (hoy solo se aplica a: ${summarizeLabels(label(enforcedLost))}; el resto todavía no)`
        : ' (hoy todavía no se aplica a ninguna)'
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* El color solo no alcanza para avisar (WCAG 1.4.1): la marca lleva icono y texto. */}
      {touchesDestructive && (
        <Badge tone="error" className="px-2 py-0">
          <TrashIcon className="h-3 w-3" />
          Incluye destructivas
        </Badge>
      )}
      <span className={touchesDestructive ? 'text-error' : 'text-warning'}>
        {diff.gained.length > 0 && (
          <>
            Suma {diff.gained.length}: {summarizeLabels(label(diff.gained))}.{' '}
          </>
        )}
        {diff.lost.length > 0 && (
          <>
            Pierde {diff.lost.length}: {summarizeLabels(label(diff.lost))}
            {enforcement}.
          </>
        )}
      </span>
    </span>
  )
}

interface AccessRowProps {
  rowKey: string
  badge: ReactNode
  title: string
  detail: ReactNode
  expanded: boolean
  onToggle: () => void
  catalog: readonly CapabilityDescriptor[]
  capabilities: readonly string[]
  /** Lo que se pierde respecto del base: se lista aparte, bajo «Pierde». */
  lost?: readonly string[]
}

function AccessRow({
  rowKey,
  badge,
  title,
  detail,
  expanded,
  onToggle,
  catalog,
  capabilities,
  lost = [],
}: AccessRowProps) {
  const listId = `effective-access-${useId()}-${rowKey}`
  const rows = catalog.filter((row) => capabilities.includes(row.id))
  const lostRows = sortByRisk(lost, catalog)
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            {badge}
            <span className="text-sm font-medium text-foreground">{title}</span>
          </span>
          <span className="text-xs text-muted-foreground">{detail}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={onToggle}
        >
          {expanded ? 'Ocultar capacidades' : 'Ver capacidades'}{' '}
          {/* Hay un botón igual por fila: sin el destino, el lector de pantalla oye tres
              «Ver capacidades» indistinguibles. */}
          <span className="sr-only">de {title}</span>
        </Button>
      </div>
      {/* Siempre en el DOM (con `hidden` al plegar) para que `aria-controls` apunte a algo. */}
      <div
        id={listId}
        hidden={!expanded}
        className="flex flex-col gap-2 border-t border-border pt-2"
      >
        {expanded && (
          <>
            {groupByModule(rows).map((group) => (
              <CapabilityGroup key={group.module} title={group.label} rows={group.rows} />
            ))}
            {lostRows.length > 0 && <CapabilityGroup title="Pierde" rows={lostRows} lost />}
          </>
        )}
      </div>
    </li>
  )
}

function CapabilityGroup({
  title,
  rows,
  lost = false,
}: {
  title: string
  rows: readonly CapabilityDescriptor[]
  lost?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className={cn('text-xs font-semibold', lost ? 'text-warning' : 'text-foreground')}>
        {title}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={cn('text-foreground', lost && 'line-through')}>{row.label}</span>
            <code className="font-mono text-[11px] text-muted-foreground">{row.id}</code>
            <CapabilityFlags capability={row} compact />
          </li>
        ))}
      </ul>
    </div>
  )
}
