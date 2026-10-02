import { useId, useState, type ReactNode } from 'react'
import { Badge, Button, Callout, TrashIcon, type BadgeTone } from '@/components/ui'
import type { CapabilityDescriptor } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { useEnvironmentOptions } from '@/features/environments/hooks/use-environment-options'
import {
  SCOPE_ENFORCEMENT_NOTE,
  effectiveAccessRowId,
  globalCapabilityLabel,
  groupByModule,
  isDestructive,
  lostEnforcementNote,
  mostProtectedEnvironmentId,
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
  /**
   * Prefijo para los `id` de las filas de permisos (`effectiveAccessRowId`), para que quien llama
   * pueda enlazar a la fila de un permiso («Ver el efecto abajo»). Sin él las filas no llevan `id`.
   */
  idPrefix?: string
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
 * nota de dónde se aplica el recorte por alcance: sin ella, el panel prometería una restricción
 * que las lecturas y las capacidades globales no tienen.
 */
export function EffectiveAccessPanel({
  baseRole,
  globalCapabilities,
  grants,
  catalog,
  isLoading = false,
  mode,
  idPrefix,
}: EffectiveAccessPanelProps) {
  // Las filas se pliegan y despliegan por su DESTINO (`grant:<tipo>:<id>`), no por su posición:
  // quitar un permiso de arriba no puede dejar desplegado el de abajo, que pasó a ocupar su índice.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // Solo para nombrar el entorno al que caen las bases sin clasificar, y solo si importa.
  const hasEnvironmentGrant = grants.some((grant) => grant.scopeType === 'environment')
  const environments = useEnvironmentOptions(hasEnvironmentGrant)

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

  const fallbackId = mostProtectedEnvironmentId(environments.data ?? [])
  const fallbackName = environments.data?.find((env) => env.id === fallbackId)?.name ?? null
  const baseDetail = hasEnvironmentGrant
    ? `En todo lo que no tenga un permiso propio. Ojo: una base sin entorno no cae acá, cuenta como el entorno más protegido${
        fallbackName ? ` («${fallbackName}»)` : ''
      } y sigue el permiso que haya sobre él.`
    : 'En todo lo que no tenga un permiso propio.'
  // Una clave por destino; si el mismo destino aparece dos veces, la segunda lleva sufijo.
  const seenKeys = new Map<string, number>()
  const grantKey = (scopeType: string, scopeId: number) => {
    const key = `grant:${scopeType}:${scopeId}`
    const count = seenKeys.get(key) ?? 0
    seenKeys.set(key, count + 1)
    return count === 0 ? key : `${key}#${count}`
  }

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
          detail={baseDetail}
          expanded={expanded.has('base')}
          onToggle={() => toggle('base')}
          catalog={catalog}
          capabilities={access.baseCapabilities}
        />

        {access.grants.map(({ grant, capabilities, diff }) => {
          // Por referencia: `resolveEffectiveAccess` descarta los permisos que el backend no
          // carga, así que la posición no coincide con la de `grants`.
          const targetLabel =
            grants.find((candidate) => candidate === grant)?.targetLabel ?? `#${grant.scopeId}`
          const provenance = PROVENANCE[grant.scopeType] ?? {
            label: `Permiso de ${grant.scopeType}`,
            tone: 'info' as const,
          }
          const key = grantKey(grant.scopeType, grant.scopeId)
          return (
            <AccessRow
              key={key}
              rowKey={key}
              id={
                idPrefix && !key.includes('#')
                  ? effectiveAccessRowId(idPrefix, grant.scopeType, grant.scopeId)
                  : undefined
              }
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
              title={`${globalCapabilityLabel(global.id)} · ${global.id}`}
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
        // todo el gateway en lo que no se recorta por alcance, y eso es una escalada real. Si los permisos
        // solo recortan, la nota es informativa.
        <Callout
          tone={access.unionRole !== baseRole ? 'warning' : 'info'}
          title="Dónde se aplica cada permiso por alcance"
        >
          <p>{SCOPE_ENFORCEMENT_NOTE}</p>
          {access.unionRole !== baseRole && (
            <p>
              Por eso, en esas otras operaciones (lecturas y capacidades globales){' '}
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
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <DestructiveMarks diff={diff} catalog={catalog} />
      {diff.gained.length > 0 && (
        <span className={gainsDestructive(diff, catalog) ? 'text-error' : 'text-warning'}>
          Suma {diff.gained.length}: {summarizeLabels(label(diff.gained))}.
        </span>
      )}
      {diff.lost.length > 0 && (
        <span className="text-muted-foreground">
          Pierde {diff.lost.length}: {summarizeLabels(label(diff.lost))}
          {lostEnforcementNote(diff.lost, label, catalog)}.
        </span>
      )}
    </span>
  )
}

function gainsDestructive(diff: CapabilityDiff, catalog: readonly CapabilityDescriptor[]) {
  return sortByRisk(diff.gained, catalog).some(isDestructive)
}

/**
 * Las dos marcas de una diferencia que toca destructivas, con icono y texto (el color solo no
 * alcanza, WCAG 1.4.1): **sumar** una destructiva es el riesgo (rojo); **quitarla** es un recorte,
 * y va en neutro para no gritar lo mismo que la escalada.
 */
export function DestructiveMarks({
  diff,
  catalog,
}: {
  diff: CapabilityDiff
  catalog: readonly CapabilityDescriptor[]
}) {
  const gains = gainsDestructive(diff, catalog)
  const loses = sortByRisk(diff.lost, catalog).some(isDestructive)
  if (!gains && !loses) return null
  return (
    <>
      {gains && (
        <Badge tone="error" className="px-2 py-0">
          <TrashIcon className="h-3 w-3" />
          Suma destructivas
        </Badge>
      )}
      {loses && (
        <Badge tone="neutral" className="px-2 py-0">
          <TrashIcon className="h-3 w-3" />
          Quita destructivas
        </Badge>
      )}
    </>
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
  /** `id` del `<li>`, para que se pueda enlazar a la fila. */
  id?: string
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
  id,
}: AccessRowProps) {
  const listId = `effective-access-${useId()}-${rowKey}`
  const rows = catalog.filter((row) => capabilities.includes(row.id))
  const lostRows = sortByRisk(lost, catalog)
  return (
    <li
      id={id}
      className="flex scroll-mt-4 flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2"
    >
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
      <p
        className={cn('text-xs font-semibold', lost ? 'text-muted-foreground' : 'text-foreground')}
      >
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
