import { useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Combobox,
  IconButton,
  Modal,
  TrashIcon,
} from '@/components/ui'
import {
  EffectiveAccessPanel,
  RoleCapabilitySummary,
  globalCapabilityIds,
  sortByRisk,
  summarizeLabels,
  useCapabilities,
  useCapabilityCatalog,
  useScopeReadiness,
  type EffectiveAccessGrant,
} from '@/features/auth'
import { useSelectableEnvironments } from '@/features/environments'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import {
  GATEWAY_ROLES,
  GLOBAL_CAPABILITIES,
  SCOPE_TYPES,
  isKnownGatewayRole,
  isKnownGlobalCapability,
  type GatewayRole,
  type GatewayUserOut,
  type GlobalCapability,
  type ScopeGrantIn,
  type ScopeType,
} from '@/lib/contracts'
import { GLOBAL_CEILING_HINT, roleCeilingHint, withinCeiling } from '../grant-ceiling'
import { useReplaceGatewayUserAccess } from '../hooks/use-gateway-users'
import { SELF_ACCESS_NOTE } from '../self-access'

const SCOPE_TYPE_LABELS: Record<ScopeType, string> = {
  environment: 'Entorno',
  server: 'Servidor',
}

interface ScopeTypeOption {
  value: ScopeType
  label: string
}
const SCOPE_TYPE_OPTIONS: ScopeTypeOption[] = SCOPE_TYPES.map((value) => ({
  value,
  label: SCOPE_TYPE_LABELS[value],
}))

interface RoleOption {
  value: GatewayRole
  label: string
}
const ROLE_OPTIONS: RoleOption[] = GATEWAY_ROLES.map((value) => ({ value, label: value }))

/** Clave de un permiso, para comparar el formulario contra lo que la persona ya tenía. */
function grantKey(grant: { scope_type: string; scope_id: number; role: string }): string {
  return `${grant.scope_type}:${grant.scope_id}:${grant.role}`
}

interface TargetOption {
  id: number
  label: string
}

interface GatewayUserAccessModalProps {
  user: GatewayUserOut
  /**
   * `true` si `user` es la cuenta con la sesión abierta. El backend rechaza que alguien cambie su
   * propio acceso (409 `access.self_modification_forbidden`), así que la pantalla queda de solo
   * lectura con el motivo a la vista. El listado ya no la abre para la fila propia; esto cubre
   * cualquier otro camino.
   */
  isSelf?: boolean
  onClose: () => void
}

/**
 * Editor de accesos — `PUT /{id}/access` (§2.6).
 *
 * **Es un reemplazo TOTAL, y toda la pantalla está construida alrededor de ese hecho.** Los dos
 * campos del endpoint tienen `default_factory=list`: omitir uno equivale a enviarlo vacío, y
 * vacío REVOCA. Por eso el formulario se inicializa con el estado COMPLETO de la persona, muestra
 * siempre las dos secciones —aunque una esté vacía— y envía las dos juntas. Un editor que mostrara
 * solo la sección que el operador vino a tocar destruiría la otra con un 200 y sin un aviso.
 */
export function GatewayUserAccessModal({
  user,
  isSelf = false,
  onClose,
}: GatewayUserAccessModalProps) {
  const replaceAccess = useReplaceGatewayUserAccess(user.id)
  const environments = useSelectableEnvironments()
  const servers = useServerOptions()
  const readiness = useScopeReadiness()
  const catalogQuery = useCapabilityCatalog()
  const catalog = catalogQuery.data
  // Techo del ACTOR (quien edita), no de la persona editada: ver `grant-ceiling.ts`.
  const actor = useCapabilities()
  const actorGlobals = new Set(actor.globalCapabilities)
  const originalGlobals = new Set(user.global_capabilities)
  const originalGrants = new Set(user.scope_grants.map(grantKey))
  const unclassifiedServers = (readiness.data?.servers ?? []).filter(
    (server) => server.unclassified > 0,
  )

  /*
   * Un grant cuyo `scope_type` o `role` esta versión de la SPA no conoce NO se puede representar
   * en el formulario, y como el endpoint reemplaza todo, guardar desde acá lo borraría en
   * silencio. Se detecta antes de dejar tocar nada y se bloquea el guardado: revocar un permiso
   * que nadie pidió revocar es peor que no poder editar desde esta pantalla.
   */
  const unrepresentable = user.scope_grants.filter(
    (grant) =>
      !isKnownGatewayRole(grant.role) ||
      !(SCOPE_TYPES as readonly string[]).includes(grant.scope_type),
  )
  const unknownCapabilities = user.global_capabilities.filter(
    (cap) => !isKnownGlobalCapability(cap),
  )
  const unrepresentableState = unrepresentable.length > 0 || unknownCapabilities.length > 0
  const blocked = isSelf || unrepresentableState

  const [capabilities, setCapabilities] = useState<GlobalCapability[]>(() =>
    user.global_capabilities.filter(isKnownGlobalCapability),
  )
  const [grants, setGrants] = useState<ScopeGrantIn[]>(() =>
    user.scope_grants
      .filter(
        (grant) =>
          isKnownGatewayRole(grant.role) &&
          (SCOPE_TYPES as readonly string[]).includes(grant.scope_type),
      )
      .map((grant) => ({
        scope_type: grant.scope_type as ScopeType,
        scope_id: grant.scope_id,
        role: grant.role as GatewayRole,
      })),
  )

  const toggleCapability = (capability: GlobalCapability, checked: boolean) => {
    setCapabilities((current) =>
      checked ? [...current, capability] : current.filter((value) => value !== capability),
    )
  }

  const updateGrant = (index: number, patch: Partial<ScopeGrantIn>) => {
    setGrants((current) =>
      current.map((grant, position) => (position === index ? { ...grant, ...patch } : grant)),
    )
  }

  const targetsFor = (scopeType: ScopeType): TargetOption[] =>
    scopeType === 'environment'
      ? environments.selectable.map((env) => ({ id: env.id, label: env.name }))
      : (servers.data ?? []).map((server) => ({ id: server.id, label: server.name }))

  /*
   * Los roles que se ofrecen en un permiso: hasta el techo del actor, MÁS el que ese permiso ya
   * tenía si se está conservando tal cual (el backend solo mide lo que se agrega). Ofrecer uno por
   * encima del techo sería llevar al administrador hasta un 409 al guardar.
   */
  const roleOptionsFor = (grant: ScopeGrantIn): RoleOption[] =>
    ROLE_OPTIONS.filter(
      (option) =>
        withinCeiling(option.value, actor.role) ||
        originalGrants.has(grantKey({ ...grant, role: option.value })),
    )
  const scopeCeilingHint = roleCeilingHint(GATEWAY_ROLES, actor.role, 'scope')

  const targetLabel = (grant: ScopeGrantIn): string => {
    const found = targetsFor(grant.scope_type).find((target) => target.id === grant.scope_id)
    if (found) return found.label
    if (grant.scope_id < 1) return `${SCOPE_TYPE_LABELS[grant.scope_type]} sin elegir`
    return `${SCOPE_TYPE_LABELS[grant.scope_type]} #${grant.scope_id}`
  }
  const effectiveGrants: EffectiveAccessGrant[] = grants
    .filter((grant) => grant.scope_id >= 1)
    .map((grant) => ({
      scopeType: grant.scope_type,
      scopeId: grant.scope_id,
      role: grant.role,
      targetLabel: targetLabel(grant),
    }))

  /** Qué suma una capacidad global, leído del catálogo; sin catálogo no se inventa nada. */
  const globalHint = (capability: GlobalCapability): string => {
    const reason =
      !actorGlobals.has(capability) && !originalGlobals.has(capability) && actor.role !== null
        ? ` ${GLOBAL_CEILING_HINT}`
        : ''
    if (!catalog) return `No se pudo cargar qué incluye.${reason}`
    const ids = globalCapabilityIds(catalog, capability)
    const labels = sortByRisk(ids, catalog).map((row) => row.label)
    return `Suma ${ids.length}: ${summarizeLabels(labels, ids.length)}.${reason}`
  }
  // Una global que el actor no tiene solo se puede QUITAR (si la persona ya la tenía), nunca
  // poner. Con roles desconocidos (`actor.role === null`) no hay techo que aplicar.
  const globalLocked = (capability: GlobalCapability, checked: boolean): boolean =>
    actor.role !== null &&
    !actorGlobals.has(capability) &&
    !originalGlobals.has(capability) &&
    !checked

  // `scope_id` 0 es el centinela de "fila sin destino elegido": el contrato exige >= 1, así que no
  // colisiona con ningún id real y mantiene el guardado deshabilitado hasta que se complete.
  const incomplete = grants.some((grant) => grant.scope_id < 1)

  const submit = () => {
    replaceAccess.mutate(
      { global_capabilities: capabilities, scope_grants: grants },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!replaceAccess.isPending) onClose()
      }}
      title={`Accesos de ${user.username}`}
      description="Capacidades globales y permisos por entorno o servidor."
      size="lg"
    >
      <div className="flex flex-col gap-5">
        <Callout tone="warning" title="Se guarda el estado completo, no solo lo que cambies">
          Esta pantalla reemplaza <strong>todos</strong> los accesos de la persona por lo que quede
          acá. Lo que borres de la lista queda revocado al guardar.
        </Callout>

        {isSelf && (
          <Callout tone="info" title="Es tu propia cuenta">
            {SELF_ACCESS_NOTE}
          </Callout>
        )}

        {unrepresentableState && (
          <Callout tone="danger" title="No se puede editar desde esta pantalla">
            <p>
              Esta cuenta tiene{' '}
              {unrepresentable.length > 0 && (
                <>
                  {unrepresentable.length} permiso(s) con un tipo o rol que esta versión de la
                  interfaz no reconoce
                  {unknownCapabilities.length > 0 ? ' y ' : ''}
                </>
              )}
              {unknownCapabilities.length > 0 && (
                <>capacidades globales desconocidas ({unknownCapabilities.join(', ')})</>
              )}
              . Como este endpoint reemplaza todo, guardar desde acá los borraría.
            </p>
            <p className="mt-1">
              Actualizá la interfaz, o ajustá estos accesos por API, antes de editarlos.
            </p>
          </Callout>
        )}

        {/* ── Capacidades globales ─────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">Capacidades globales</h3>
            <p className="text-xs text-muted-foreground">
              Valen en todo el gateway, se suman a cualquier rol y no se recortan por alcance.
            </p>
          </div>
          {GLOBAL_CAPABILITIES.map((capability) => {
            const checked = capabilities.includes(capability)
            return (
              <Checkbox
                key={capability}
                label={capability}
                hint={globalHint(capability)}
                checked={checked}
                disabled={blocked || globalLocked(capability, checked)}
                onChange={(event) => toggleCapability(capability, event.target.checked)}
              />
            )
          })}
        </section>

        {/* ── Alcances ─────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">
              Permisos por entorno o servidor
            </h3>
            {/*
              La semántica que más sorprende, y por eso va escrita y no implícita: un permiso de
              alcance ocupa el lugar del rol base dentro de ese alcance, no se suma. Pero NO se
              promete más de lo que el servidor cumple: hoy esa regla solo se hace cumplir en
              cuatro rutas, y eso lo dice la sección «Acceso efectivo al guardar» de abajo.
            */}
            <p className="text-xs text-muted-foreground">
              Dentro de su alcance, el permiso ocupa el lugar del rol base{' '}
              <Badge tone="neutral">{user.gateway_role}</Badge> — no se suma a él. Si hay dos sobre
              el mismo destino rige el más restrictivo. Abajo, en «Acceso efectivo al guardar», se
              ve qué queda y en qué operaciones se aplica hoy.
            </p>
            {scopeCeilingHint && !blocked && (
              <p className="text-xs text-muted-foreground">{scopeCeilingHint}</p>
            )}
          </div>

          {/*
            El aviso menos intuitivo de esta pantalla (v23 §8): una base SIN entorno no resuelve al
            entorno por defecto —ése es el más permisivo— sino al MÁS PROTEGIDO. Así que acotar a
            alguien a un entorno también le acota el acceso a toda base que nadie clasificó.

            Sin esto, el administrador otorga un permiso creyendo que amplía cuando recorta, y se
            entera cuando la persona reporta que perdió acceso a algo que no tiene nada que ver.

            Se consulta SOLO cuando hay permisos de alcance en juego: sin ellos la capa 2 no cambia
            ningún resultado y la llamada sería por nada.
          */}
          {grants.length > 0 && readiness.data && !readiness.data.ready && (
            <Callout
              tone="warning"
              title={`Hay ${readiness.data.unclassified_databases} base(s) sin entorno asignado`}
            >
              <p>
                Una base sin entorno se trata como el entorno <strong>más protegido</strong>
                {readiness.data.fallback_environment_slug ? (
                  <>
                    {' '}
                    (<code className="font-mono">{readiness.data.fallback_environment_slug}</code>)
                  </>
                ) : null}
                , no como el default. Si acotás el acceso de esta persona a un entorno, también se
                lo estás acotando sobre esas bases, aunque no tengan nada que ver.
              </p>
              {unclassifiedServers.length > 0 && (
                <p className="mt-1">
                  Servidores con bases sin clasificar:{' '}
                  {unclassifiedServers
                    .map((server) => `${server.server_name} (${server.unclassified})`)
                    .join(', ')}
                  .
                </p>
              )}
              <p className="mt-1">
                Se puede guardar igual —el backend lo acepta—, pero conviene clasificarlas primero.
              </p>
            </Callout>
          )}

          {grants.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              Sin permisos de alcance: rige el rol base en todo el gateway.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {grants.map((grant, index) => {
                const targets = targetsFor(grant.scope_type)
                const selected = targets.find((target) => target.id === grant.scope_id) ?? null
                const roleOptions = roleOptionsFor(grant)
                return (
                  <li
                    key={index}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="w-full sm:w-40">
                        <Combobox<ScopeTypeOption>
                          items={SCOPE_TYPE_OPTIONS}
                          value={
                            SCOPE_TYPE_OPTIONS.find(
                              (option) => option.value === grant.scope_type,
                            ) ?? null
                          }
                          onChange={(option) => {
                            // Cambiar el tipo invalida el destino: un id de entorno no significa
                            // nada como id de servidor. Se limpia para obligar a re-elegirlo.
                            if (!option) return
                            updateGrant(index, { scope_type: option.value, scope_id: 0 })
                          }}
                          itemToString={(option) => option.label}
                          itemToKey={(option) => option.value}
                          label="Tipo"
                          disabled={blocked}
                        />
                      </div>
                      <div className="w-full flex-1">
                        <Combobox<TargetOption>
                          items={targets}
                          value={selected}
                          onChange={(option) => updateGrant(index, { scope_id: option?.id ?? 0 })}
                          itemToString={(option) => option.label}
                          itemToKey={(option) => option.id}
                          label={SCOPE_TYPE_LABELS[grant.scope_type]}
                          placeholder="Elegí un destino"
                          disabled={blocked}
                          isLoading={
                            grant.scope_type === 'environment'
                              ? environments.isPending
                              : servers.isPending
                          }
                          error={grant.scope_id < 1 ? 'Falta elegir el destino' : undefined}
                        />
                      </div>
                      <div className="w-full sm:w-40">
                        <Combobox<RoleOption>
                          items={roleOptions}
                          value={ROLE_OPTIONS.find((option) => option.value === grant.role) ?? null}
                          onChange={(option) =>
                            updateGrant(index, { role: option?.value ?? 'viewer' })
                          }
                          itemToString={(option) => option.label}
                          itemToKey={(option) => option.value}
                          label="Rol en ese alcance"
                          disabled={blocked}
                        />
                      </div>
                      <div className="shrink-0 pb-1">
                        <IconButton
                          type="button"
                          label="Quitar este permiso"
                          icon={<TrashIcon />}
                          variant="danger-soft"
                          size="icon-sm"
                          disabled={blocked}
                          onClick={() =>
                            setGrants((current) =>
                              current.filter((_, position) => position !== index),
                            )
                          }
                        />
                      </div>
                    </div>
                    {/* Qué cambia este permiso respecto del rol base: es lo que decide si
                        conviene otorgarlo, y no se puede leer del nombre del rol. */}
                    <RoleCapabilitySummary
                      role={grant.role}
                      compareTo={user.gateway_role}
                      catalog={catalog}
                      isLoading={catalogQuery.isLoading}
                    />
                  </li>
                )
              })}
            </ul>
          )}

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={blocked}
              onClick={() =>
                setGrants((current) => [
                  ...current,
                  { scope_type: 'environment', scope_id: 0, role: 'viewer' },
                ])
              }
            >
              Añadir permiso
            </Button>
          </div>
        </section>

        {/* ── Acceso efectivo ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">Acceso efectivo al guardar</h3>
            <p className="text-xs text-muted-foreground">
              Lo que va a poder hacer {user.username} con lo que quede en esta pantalla.
            </p>
          </div>
          <EffectiveAccessPanel
            mode="admin"
            baseRole={user.gateway_role}
            globalCapabilities={capabilities}
            grants={effectiveGrants}
            catalog={catalog}
            isLoading={catalogQuery.isLoading}
          />
        </section>

        <Callout tone="info" title="Al guardar se cierran sus sesiones">
          La persona va a tener que iniciar sesión otra vez para que los accesos nuevos tengan
          efecto.
        </Callout>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={replaceAccess.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={submit}
            isLoading={replaceAccess.isPending}
            disabled={blocked || incomplete}
          >
            Guardar accesos
          </Button>
        </div>
      </div>
    </Modal>
  )
}
