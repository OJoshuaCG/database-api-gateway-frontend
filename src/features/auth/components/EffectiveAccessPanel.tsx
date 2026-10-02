import { useId, useState, type ReactNode } from 'react'
import { Badge, Button, Callout, TrashIcon, type BadgeTone } from '@/components/ui'
import type {
  CapabilityDescriptor,
  EffectiveAccess as ServerEffectiveAccess,
} from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { useEnvironmentOptions } from '@/features/environments/hooks/use-environment-options'
import {
  SCOPE_ENFORCEMENT_NOTE,
  capabilityGrantsFromServer,
  effectiveAccessRowId,
  globalCapabilityLabel,
  groupByModule,
  groupProvenance,
  isDestructive,
  lostEnforcementNote,
  mostProtectedEnvironmentId,
  provenanceFromServer,
  provenanceLabel,
  resolveEffectiveAccess,
  sortByRisk,
  summarizeLabels,
  type CapabilityDiff,
  type CapabilityGrantInput,
  type ProvenanceGroup,
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

/**
 * Lo que el servidor dice que la persona puede hacer HOY (`GET /gateway-users/{id}/effective-access`),
 * con la forma mínima de una consulta de TanStack Query: el panel no hace la llamada (la feature
 * `auth` no puede importar los hooks de `gateway-users`), solo la pinta.
 */
export interface ServerAccessState {
  data: ServerEffectiveAccess | undefined
  isLoading: boolean
  isError: boolean
  onRetry?: () => void
}

interface EffectiveAccessPanelProps {
  baseRole: string
  globalCapabilities: readonly string[]
  grants: readonly EffectiveAccessGrant[]
  /**
   * Capacidades puntuales de la persona, para el cálculo del navegador (`self`: las de
   * `/auth/me`). Con `serverAccess` no hace falta: salen de la respuesta del servidor.
   */
  capabilityGrants?: readonly CapabilityGrantInput[]
  /**
   * Lo que rige hoy, según el servidor, que es la AUTORIDAD: con esto el panel lo muestra con su
   * procedencia. Sin esto el panel solo calcula en el navegador (`self`, o quien no es
   * `access_admin` y no puede leer el acceso efectivo).
   */
  serverAccess?: ServerAccessState
  /**
   * Con `serverAccess`: el formulario tiene cambios sin guardar. Solo entonces se agrega, debajo,
   * la «Vista previa: así quedaría al guardar», calculada en el navegador y rotulada como tal.
   */
  hasUnsavedChanges?: boolean
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

const scopeTypeName = (scopeType: string | null) =>
  scopeType === 'environment' ? 'entorno' : scopeType === 'server' ? 'servidor' : (scopeType ?? '')

/** «Entorno #3» cuando el nombre no llegó (el destino se borró, o la lista todavía no cargó). */
const fallbackTargetName = (scopeType: string | null, scopeId: number | null) =>
  `${scopeType === 'server' ? 'Servidor' : 'Entorno'} #${scopeId ?? '?'}`

/**
 * Qué puede hacer una persona y DÓNDE: el rol base, cada permiso por alcance con lo que cambia
 * respecto del base, los cruces entre permisos, las capacidades puntuales y las globales.
 *
 * Dos fuentes, y no se mezclan:
 *
 * - **`serverAccess`** es lo que rige HOY, tal como lo calcula el servidor, con la fuente de cada
 *   capacidad (por rol, rol por alcance, global, puntual). Es la autoridad.
 * - **El cálculo del navegador** (`resolveEffectiveAccess`, el espejo puro de
 *   `app/core/scope.py` y `capability_resolution.py`) es lo único que puede decir cómo QUEDARÍA lo
 *   que todavía no se guardó. Con `serverAccess` solo se muestra bajo «Vista previa: así quedaría
 *   al guardar», cuando hay cambios; sin `serverAccess` es todo lo que hay.
 *
 * Lleva SIEMPRE la nota de dónde se aplica el recorte por alcance: sin ella, el panel prometería
 * una restricción que las lecturas y las capacidades globales no tienen.
 */
export function EffectiveAccessPanel({
  baseRole,
  globalCapabilities,
  grants,
  capabilityGrants,
  serverAccess,
  hasUnsavedChanges = false,
  catalog,
  isLoading = false,
  mode,
  idPrefix,
}: EffectiveAccessPanelProps) {
  const previewId = useId()
  if (!catalog) {
    return (
      <p className="text-xs text-muted-foreground">
        {isLoading
          ? 'Cargando el catálogo de capacidades…'
          : 'No se pudo cargar el catálogo de capacidades, así que no se puede calcular el acceso efectivo.'}
      </p>
    )
  }

  if (!serverAccess) {
    return (
      <MirrorAccess
        baseRole={baseRole}
        globalCapabilities={globalCapabilities}
        grants={grants}
        capabilityGrants={capabilityGrants ?? []}
        catalog={catalog}
        mode={mode}
        idPrefix={idPrefix}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        {hasUnsavedChanges && (
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">Rige hoy</h3>
            <p className="text-xs text-muted-foreground">Según el servidor.</p>
          </div>
        )}
        <ServerAccessView
          state={serverAccess}
          catalog={catalog}
          idPrefix={hasUnsavedChanges ? undefined : idPrefix}
        />
      </section>

      {hasUnsavedChanges && (
        <section
          aria-labelledby={`${previewId}-vista-previa`}
          className="flex flex-col gap-3 border-t border-border pt-4"
        >
          <div className="flex flex-col gap-0.5">
            <h3 id={`${previewId}-vista-previa`} className="text-sm font-semibold text-foreground">
              Vista previa: así quedaría al guardar
            </h3>
            <p className="text-xs text-muted-foreground">
              Calculada en este navegador con lo que hay en pantalla; todavía no rige.
            </p>
          </div>
          <MirrorAccess
            baseRole={baseRole}
            globalCapabilities={globalCapabilities}
            grants={grants}
            capabilityGrants={
              capabilityGrants ??
              (serverAccess.data ? capabilityGrantsFromServer(serverAccess.data) : [])
            }
            catalog={catalog}
            mode={mode}
            idPrefix={idPrefix}
          />
        </section>
      )}
    </div>
  )
}

interface ServerAccessViewProps {
  state: ServerAccessState
  catalog: readonly CapabilityDescriptor[]
  idPrefix?: string
}

/**
 * Lo que rige hoy según el servidor, una fila por FUENTE: el rol base, cada rol por alcance, las
 * globales y cada capacidad puntual (con su alcance por nombre y sus lecturas implícitas). Todo
 * viene de la respuesta: acá no se calcula nada, solo se agrupa y se rotula.
 */
function ServerAccessView({ state, catalog, idPrefix }: ServerAccessViewProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (state.isLoading) {
    return <p className="text-xs text-muted-foreground">Cargando el acceso efectivo…</p>
  }
  const access = state.data
  if (state.isError || !access) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          No se pudo leer el acceso efectivo desde el servidor.
        </p>
        {state.onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={state.onRetry}>
            Reintentar
          </Button>
        )}
      </div>
    )
  }

  const groups = groupProvenance(provenanceFromServer(access), catalog)
  const label = (ids: readonly string[]) => sortByRisk(ids, catalog).map((row) => row.label)
  // Nombres de destino: los de `scope_roles` y los de cada fila con alcance.
  const names = new Map<string, string>()
  for (const row of access.scope_roles) {
    if (row.scope_name) names.set(`${row.scope_type}:${row.scope_id}`, row.scope_name)
  }
  for (const row of access.capabilities) {
    if (row.scope_name && row.scope_type && row.scope_id != null) {
      names.set(`${row.scope_type}:${row.scope_id}`, row.scope_name)
    }
  }
  const targetName = (scopeType: string | null, scopeId: number | null) =>
    names.get(`${scopeType}:${scopeId}`) ?? fallbackTargetName(scopeType, scopeId)
  const labelOf = (id: string) => catalog.find((row) => row.id === id)?.label ?? id

  const renderGroup = (group: ProvenanceGroup) => {
    const badge = (tone: BadgeTone) => <Badge tone={tone}>{provenanceLabel(group.kind)}</Badge>
    const common = {
      rowKey: group.key,
      expanded: expanded.has(group.key),
      onToggle: () => toggle(group.key),
      catalog,
      capabilities: group.capabilities,
    }
    if (group.kind === 'role') {
      return (
        <AccessRow
          key={group.key}
          {...common}
          badge={badge('neutral')}
          title={`${access.base_role ?? 'sin rol'} · ${group.capabilities.length} capacidades`}
          detail="En todo lo que no tenga un permiso propio."
        />
      )
    }
    if (group.kind === 'scoped_role') {
      const scopeRole = access.scope_roles.find(
        (row) => row.scope_type === group.scopeType && row.scope_id === group.scopeId,
      )
      return (
        <AccessRow
          key={group.key}
          {...common}
          id={
            idPrefix && group.scopeType && group.scopeId != null
              ? effectiveAccessRowId(idPrefix, group.scopeType, group.scopeId)
              : undefined
          }
          badge={badge('info')}
          title={`${targetName(group.scopeType, group.scopeId)} · ${scopeRole?.role ?? 'rol'}`}
          detail={`Rige solo en este ${scopeTypeName(group.scopeType)}.`}
        />
      )
    }
    if (group.kind === 'global') {
      return (
        <AccessRow
          key={group.key}
          {...common}
          badge={badge('primary')}
          title={`${access.global_capabilities.map(globalCapabilityLabel).join(' y ')} · ${access.global_capabilities.join(', ')}`}
          detail="En todo el gateway, sin importar el rol."
        />
      )
    }
    if (group.kind === 'capability_grant') {
      const implied = group.capabilities.filter((id) => id in group.impliedBy)
      return (
        <AccessRow
          key={group.key}
          {...common}
          badge={
            <>
              {badge('warning')}
              {group.inert && <Badge tone="neutral">Inactiva</Badge>}
            </>
          }
          title={`${labelOf(group.grantCapability ?? '')} · ${targetName(group.scopeType, group.scopeId)}`}
          detail={
            group.inert
              ? 'Sin efecto mientras la cuenta esté desactivada.'
              : `Solo en este ${scopeTypeName(group.scopeType)}${
                  implied.length > 0
                    ? `. Trae implícita la lectura: ${summarizeLabels(label(implied))}`
                    : ''
                }.`
          }
          notes={Object.fromEntries(
            Object.entries(group.impliedBy).map(([id, by]) => [
              id,
              `lectura implícita de «${labelOf(by)}»`,
            ]),
          )}
        />
      )
    }
    return (
      <AccessRow
        key={group.key}
        {...common}
        badge={badge('neutral')}
        title={`${group.capabilities.length} capacidades`}
        detail="Fuente que esta versión no reconoce."
      />
    )
  }

  const hasInert = groups.some((group) => group.inert)
  return (
    <div className="flex flex-col gap-3">
      {!access.active && hasInert && (
        <p className="text-xs text-muted-foreground">
          La cuenta está desactivada: sus capacidades puntuales se conservan, pero no tienen efecto.
        </p>
      )}
      <ul className="flex flex-col gap-2">{groups.map(renderGroup)}</ul>
      {access.scope_roles.length > 0 && (
        <p className="text-xs text-muted-foreground">{SCOPE_ENFORCEMENT_NOTE}</p>
      )}
    </div>
  )
}

interface MirrorAccessProps {
  baseRole: string
  globalCapabilities: readonly string[]
  grants: readonly EffectiveAccessGrant[]
  capabilityGrants: readonly CapabilityGrantInput[]
  catalog: readonly CapabilityDescriptor[]
  mode: 'admin' | 'self'
  idPrefix?: string
}

/** El cálculo del navegador: rol base, permisos por alcance con su diferencia, cruces y globales. */
function MirrorAccess({
  baseRole,
  globalCapabilities,
  grants,
  capabilityGrants,
  catalog,
  mode,
  idPrefix,
}: MirrorAccessProps) {
  // Las filas se pliegan y despliegan por su DESTINO (`grant:<tipo>:<id>`), no por su posición:
  // quitar un permiso de arriba no puede dejar desplegado el de abajo, que pasó a ocupar su índice.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // Solo para nombrar el entorno al que caen las bases sin clasificar, y solo si importa.
  const hasEnvironmentGrant = grants.some((grant) => grant.scopeType === 'environment')
  const environments = useEnvironmentOptions(hasEnvironmentGrant)

  const access = resolveEffectiveAccess({
    catalog,
    baseRole,
    globalCapabilities,
    grants,
    capabilityGrants,
  })
  const label = (ids: readonly string[]) => sortByRisk(ids, catalog).map((row) => row.label)
  const labelOf = (id: string) => catalog.find((row) => row.id === id)?.label ?? id
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
  // Solicitudes que todavía no conceden nada: solo las trae `/auth/me` (`self`).
  const pending = capabilityGrants.filter((grant) => grant.status === 'pending')

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

        {access.capabilityGrants.map(({ grant, capabilities, implied }) => {
          const key = `puntual:${grant.grantId ?? `${grant.capability}@${grant.scopeType}:${grant.scopeId}`}`
          const target = grant.targetLabel ?? fallbackTargetName(grant.scopeType, grant.scopeId)
          return (
            <AccessRow
              key={key}
              rowKey={key}
              badge={
                <>
                  <Badge tone="warning">{provenanceLabel('capability_grant')}</Badge>
                  {grant.inert && <Badge tone="neutral">Inactiva</Badge>}
                </>
              }
              title={`${labelOf(grant.capability)} · ${target}`}
              detail={
                grant.inert
                  ? 'Sin efecto mientras la cuenta esté desactivada.'
                  : `Solo en este ${scopeTypeName(grant.scopeType)}${
                      implied.length > 0
                        ? `. Trae implícita la lectura: ${summarizeLabels(label(implied))}`
                        : ''
                    }.`
              }
              expanded={expanded.has(key)}
              onToggle={() => toggle(key)}
              catalog={catalog}
              capabilities={capabilities}
              notes={Object.fromEntries(
                implied.map((id) => [id, `lectura implícita de «${labelOf(grant.capability)}»`]),
              )}
            />
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

      {mode === 'self' && pending.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {pending.length === 1
            ? 'Tenés 1 solicitud de capacidad puntual pendiente de aprobación'
            : `Tenés ${pending.length} solicitudes de capacidad puntual pendientes de aprobación`}
          : {summarizeLabels(pending.map((grant) => labelOf(grant.capability)))}. No conceden nada
          hasta que otra persona las apruebe.
        </p>
      )}

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
  /** Una nota corta por capacidad («lectura implícita de …»), junto a su etiqueta. */
  notes?: Readonly<Record<string, string>>
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
  notes,
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
              <CapabilityGroup
                key={group.module}
                title={group.label}
                rows={group.rows}
                notes={notes}
              />
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
  notes,
}: {
  title: string
  rows: readonly CapabilityDescriptor[]
  lost?: boolean
  notes?: Readonly<Record<string, string>>
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
            {notes?.[row.id] && <span className="text-muted-foreground">{notes[row.id]}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
