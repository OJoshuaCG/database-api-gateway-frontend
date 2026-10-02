import { useEffect, useId, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Combobox,
  ConfirmDialog,
  IconButton,
  TrashIcon,
  buttonClassName,
} from '@/components/ui'
import {
  EffectiveAccessPanel,
  effectiveAccessRowId,
  globalCapabilityIds,
  globalCapabilityLabel,
  ownerOnlyCapabilityIds,
  SERVER_RESOLUTION_INVENTORY_NOTE,
  SOD_RULE_EXPLANATION,
  sodConflicts,
  sortByRisk,
  summarizeLabels,
  uncoveredSodConflicts,
  useCapabilities,
  useCapabilityCatalog,
  useScopeReadiness,
  useSodReport,
  type EffectiveAccessGrant,
  type SodConflict,
  type SodSourceLabelOptions,
} from '@/features/auth'
import { toApiError } from '@/lib/api/errors'
import { useSelectableEnvironments } from '@/features/environments'
import { useServerOptions } from '@/features/servers/hooks/use-server-options'
import {
  CAPABILITIES,
  GATEWAY_ROLES,
  GATEWAY_USER_ERROR_CODES,
  GLOBAL_CAPABILITIES,
  SCOPE_TYPES,
  isKnownGatewayRole,
  isKnownGlobalCapability,
  type GatewayRole,
  type GatewayUserOut,
  type GlobalCapability,
  type ScopeGrantIn,
  type ScopeType,
  type SodOverrideIn,
} from '@/lib/contracts'
import { GATEWAY_USERS_PATH } from '@/lib/routes'
import { GLOBAL_CEILING_HINT, roleCeilingHint, withinCeiling } from '../grant-ceiling'
import { useCapabilityGrants, useEffectiveAccess } from '../hooks/use-capability-grants'
import { useReplaceGatewayUserAccess } from '../hooks/use-gateway-users'
import { gatewayUserErrorMessage } from '../messages'
import { SELF_ACCESS_NOTE } from '../self-access'
import { CapabilityGrantsSection } from './CapabilityGrantsSection'
import { SodConflictList, SodConflictPanel } from './SodConflictPanel'

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

/**
 * Una fila del formulario: el permiso más un id ESTABLE. Con `key={index}`, quitar la fila de
 * arriba le pasaba a la de abajo el estado interno de sus `Combobox` (lo tipeado, el menú abierto).
 */
interface GrantRow extends ScopeGrantIn {
  rowId: string
}

/** Clave de un permiso, para comparar el formulario contra lo que la persona ya tenía. */
function grantKey(grant: { scope_type: string; scope_id: number; role: string }): string {
  return `${grant.scope_type}:${grant.scope_id}:${grant.role}`
}

/** Huella de un conjunto, sin importar el orden: lo que decide si hay cambios sin guardar. */
function fingerprint(values: readonly string[]): string {
  return [...values].sort().join('|')
}

interface TargetOption {
  id: number
  label: string
}

/**
 * Un 409 `access.sod_conflict` de «Guardar accesos», atado al estado que se intentó guardar
 * (`key`): si el formulario cambia, el rechazo ya no habla de lo que hay en pantalla y deja de
 * mostrarse sin que haga falta limpiarlo en un efecto.
 */
interface SodRejection {
  key: string
  conflicts: SodConflict[]
  reasonMinLength?: number
  maxHours?: number
}

interface GatewayUserAccessEditorProps {
  user: GatewayUserOut
  /**
   * `true` si `user` es la cuenta con la sesión abierta. El backend rechaza que alguien cambie su
   * propio acceso (409 `access.self_modification_forbidden`), así que la pantalla queda de solo
   * lectura con el motivo a la vista. El listado ya no ofrece el enlace para la fila propia; esto
   * cubre la URL escrita a mano.
   */
  isSelf?: boolean
}

/**
 * Editor de accesos — `PUT /{id}/access` (§2.6), el cuerpo de `/gateway-users/:userId/accesos`.
 *
 * **Es un reemplazo TOTAL, y toda la pantalla está construida alrededor de ese hecho.** Los dos
 * campos del endpoint tienen `default_factory=list`: omitir uno equivale a enviarlo vacío, y
 * vacío REVOCA. Por eso el formulario se inicializa con el estado COMPLETO de la persona, muestra
 * siempre las dos secciones —aunque una esté vacía— y envía las dos juntas. Un editor que mostrara
 * solo la sección que el operador vino a tocar destruiría la otra con un 200 y sin un aviso.
 *
 * El estado se inicializa UNA vez desde `user`: quien lo monta le pone `key={user.id}`.
 */
export function GatewayUserAccessEditor({ user, isSelf = false }: GatewayUserAccessEditorProps) {
  const navigate = useNavigate()
  const replaceAccess = useReplaceGatewayUserAccess(user.id)
  const environments = useSelectableEnvironments()
  const servers = useServerOptions()
  const panelId = useId()
  const nextRowId = useRef(0)
  // Se marca justo antes de salir tras guardar: esa navegación no tiene nada que perder.
  const leavingAfterSave = useRef(false)
  const catalogQuery = useCapabilityCatalog()
  const catalog = catalogQuery.data
  // Techo del ACTOR (quien edita), no de la persona editada: ver `grant-ceiling.ts`.
  const actor = useCapabilities()
  const actorGlobals = new Set(actor.globalCapabilities)
  // `GET …/effective-access` es `access.admin`, que tiene solo `access_admin` (un `security_officer`
  // recibiría un 403 seguro): sin esa capacidad no se pide, y el panel cae al cálculo del navegador.
  const canReadEffectiveAccess = actor.can(CAPABILITIES.accessAdmin)
  const effectiveAccess = useEffectiveAccess(user.id, canReadEffectiveAccess)
  const effectiveHeading = canReadEffectiveAccess ? 'Acceso efectivo' : 'Acceso efectivo al guardar'
  const originalGlobals = new Set(user.global_capabilities)
  const originalGrants = new Set(user.scope_grants.map(grantKey))

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
  const [grants, setGrants] = useState<GrantRow[]>(() =>
    user.scope_grants
      .filter(
        (grant) =>
          isKnownGatewayRole(grant.role) &&
          (SCOPE_TYPES as readonly string[]).includes(grant.scope_type),
      )
      .map((grant, index) => ({
        rowId: `inicial-${index}`,
        scope_type: grant.scope_type as ScopeType,
        scope_id: grant.scope_id,
        role: grant.role as GatewayRole,
      })),
  )
  // Se consulta SOLO cuando hay permisos de alcance en juego: sin ellos la capa 2 no cambia ningún
  // resultado y la llamada sería por nada.
  const readiness = useScopeReadiness(grants.length > 0)
  const unclassifiedServers = (readiness.data?.servers ?? []).filter(
    (server) => server.unclassified > 0,
  )

  /*
   * Cambios sin guardar: se compara el formulario contra lo que la persona tiene, como CONJUNTOS
   * (reordenar no es un cambio). Una fila recién añadida y todavía sin destino cuenta: alguien
   * empezó a otorgar algo.
   */
  const dirty =
    fingerprint(capabilities) !==
      fingerprint(user.global_capabilities.filter(isKnownGlobalCapability)) ||
    fingerprint(grants.map(grantKey)) !==
      fingerprint(
        user.scope_grants
          .filter(
            (grant) =>
              isKnownGatewayRole(grant.role) &&
              (SCOPE_TYPES as readonly string[]).includes(grant.scope_type),
          )
          .map(grantKey),
      )

  // Salir por un enlace de la app con cambios pendientes pide confirmación; cambiar solo el query
  // string o el hash (el enlace «Ver el efecto») no sale de la pantalla.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leavingAfterSave.current && currentLocation.pathname !== nextLocation.pathname,
  )
  // Cerrar la pestaña o recargar no pasa por el router: para eso está `beforeunload`, que el
  // navegador resuelve con su propio diálogo.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const toggleCapability = (capability: GlobalCapability, checked: boolean) => {
    setCapabilities((current) =>
      checked ? [...current, capability] : current.filter((value) => value !== capability),
    )
  }

  /*
   * Cambiar el tipo o el destino puede dejar el rol FUERA de lo que se ofrece: el rol se conservaba
   * por ser el que la persona ya tenía en ESE destino, y en otro destino es un rol nuevo, que el
   * backend mide contra el techo (409 `access.grant_ceiling_exceeded`). Se baja al más alto
   * permitido, así el selector nunca muestra un valor que no está entre sus opciones.
   */
  const updateGrant = (rowId: string, patch: Partial<ScopeGrantIn>) => {
    setGrants((current) =>
      current.map((grant) => {
        if (grant.rowId !== rowId) return grant
        const next = { ...grant, ...patch }
        const allowed = roleOptionsFor(next)
        if (allowed.some((option) => option.value === next.role)) return next
        const highest = allowed[allowed.length - 1]
        return highest ? { ...next, role: highest.value } : next
      }),
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

  /*
   * Separación de deberes (v29 §8): AVISO PREVIO con el espejo de la regla del backend sobre el
   * estado que quedaría al guardar. Decide el servidor: esto solo evita llegar al 409 a ciegas.
   * Entran el rol base (no se edita acá, pero cuenta), los permisos con destino, las globales y las
   * capacidades puntuales VIVAS (pendientes y activas: el backend cuenta las dos al escribir).
   */
  const capabilityGrants = useCapabilityGrants(user.id, { enabled: canReadEffectiveAccess })
  const sodPreview = sodConflicts({
    baseRole: user.gateway_role,
    scopeGrants: grants
      .filter((grant) => grant.scope_id >= 1)
      .map((grant) => ({
        scopeType: grant.scope_type,
        scopeId: grant.scope_id,
        role: grant.role,
      })),
    globalCapabilities: capabilities,
    capabilityGrants: (capabilityGrants.data ?? [])
      .filter((grant) => grant.status === 'pending' || grant.status === 'active')
      .map((grant) => ({
        capability: grant.capability,
        scopeType: grant.scope_type,
        scopeId: grant.scope_id,
      })),
    ownerOnlyCapabilities: catalog ? ownerOnlyCapabilityIds(catalog) : [],
  })
  // Solo se pide el reporte cuando hay algo que contrastar: una excepción viva (heredada u
  // override) cubre la regla y el servidor acepta guardar.
  const sodReport = useSodReport(canReadEffectiveAccess && sodPreview.length > 0)
  const coveredRules = (sodReport.data?.exceptions ?? [])
    .filter((exception) => exception.user.id === user.id)
    .map((exception) => exception.rule)
  const sodUncovered = uncoveredSodConflicts(sodPreview, coveredRules)
  const sodLabels: SodSourceLabelOptions = {
    targetLabel: (scopeType, scopeId) =>
      (SCOPE_TYPES as readonly string[]).includes(scopeType)
        ? targetsFor(scopeType as ScopeType).find((target) => target.id === scopeId)?.label
        : undefined,
    capabilityLabel: (id) => catalog?.find((row) => row.id === id)?.label,
  }

  const accessBody = {
    global_capabilities: capabilities,
    scope_grants: grants.map(({ scope_type, scope_id, role }) => ({
      scope_type,
      scope_id,
      role,
    })),
  }
  const bodyKey = `${fingerprint(accessBody.global_capabilities)}#${fingerprint(accessBody.scope_grants.map(grantKey))}`
  const [sodRejection, setSodRejection] = useState<SodRejection | null>(null)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const activeRejection = sodRejection?.key === bodyKey ? sodRejection : null

  const submit = (override?: SodOverrideIn) => {
    setOverrideError(null)
    replaceAccess.mutate(override ? { ...accessBody, sod_override: override } : accessBody, {
      onSuccess: () => {
        leavingAfterSave.current = true
        void navigate(GATEWAY_USERS_PATH)
      },
      onError: (error) => {
        const apiError = toApiError(error)
        if (apiError.code === GATEWAY_USER_ERROR_CODES.sodConflict) {
          const context = apiError.gatewayUserContext
          setSodRejection({
            key: bodyKey,
            conflicts: context?.sodConflicts ?? [],
            reasonMinLength: context?.sodReasonMinLength,
            maxHours: context?.sodMaxHours,
          })
        } else if (override) {
          // El reenvío con excepción falló por otra cosa (el override inválido, un techo…): se
          // dice junto al botón que se apretó, además del toast.
          setOverrideError(gatewayUserErrorMessage(apiError) ?? apiError.message)
        }
      },
    })
  }

  const sessionsNoteId = `${panelId}-sesiones`
  const sodWarningId = `${panelId}-sod`
  const showSodWarning = sodPreview.length > 0 && !activeRejection && !blocked

  return (
    <div className="flex flex-col gap-6">
      {/* Texto y no `Callout`: es la regla de la pantalla, no una alerta, y con cuatro bandas a
          la vez ninguna se lee. Las bandas quedan para lo que bloquea o sorprende. */}
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">Se guarda el estado completo</strong>, no solo lo que
        cambies: lo que borres de la lista queda revocado al guardar.
      </p>

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
                {unrepresentable.length === 1
                  ? '1 permiso con un tipo o rol'
                  : `${unrepresentable.length} permisos con un tipo o rol`}{' '}
                que esta versión de la interfaz no reconoce
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

      {/* Dos columnas desde `lg`: el formulario a la izquierda y, al lado, lo que va a quedar.
          Debajo de `lg`, una sola columna en el mismo orden de lectura. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {/* ── Separación de funciones: aviso previo ───────────────────────
              Arriba de las globales porque ahí se tilda lo que la dispara. Si el servidor ya
              rechazó este mismo estado, manda su rechazo (más abajo) y este se calla. */}
          {showSodWarning &&
            (sodUncovered.length > 0 ? (
              <Callout
                id={sodWarningId}
                tone="warning"
                title="Esta combinación viola la separación de funciones"
              >
                <p>{SOD_RULE_EXPLANATION}</p>
                <SodConflictList conflicts={sodUncovered} labelOptions={sodLabels} />
                <p className="mt-1">
                  Si guardás así, el servidor lo va a rechazar. Repartí las funciones en cuentas
                  distintas; solo ante un incidente se puede declarar una excepción de emergencia.
                </p>
              </Callout>
            ) : (
              <Callout
                id={sodWarningId}
                tone="info"
                title="Combinación cubierta por una excepción vigente"
              >
                <p>
                  Esta cuenta combina funciones que deberían estar separadas, pero tiene una
                  excepción vigente (heredada o de emergencia) que la cubre, así que el servidor
                  acepta guardar. Lo correcto sigue siendo separarlas.
                </p>
                <SodConflictList conflicts={sodPreview} labelOptions={sodLabels} />
              </Callout>
            ))}

          {/* ── Capacidades globales ─────────────────────────────────────── */}
          <Card>
            <section aria-labelledby={`${panelId}-globales`}>
              <CardHeader>
                <h2 id={`${panelId}-globales`} className="text-base font-semibold text-foreground">
                  Capacidades globales
                </h2>
                <p className="text-sm text-muted-foreground">
                  Valen en todo el gateway, se suman a cualquier rol y no se recortan por alcance.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {GLOBAL_CAPABILITIES.map((capability) => {
                  const checked = capabilities.includes(capability)
                  return (
                    <Checkbox
                      key={capability}
                      label={globalCapabilityLabel(capability)}
                      caption={
                        <code className="font-mono text-[11px] text-muted-foreground">
                          {capability}
                        </code>
                      }
                      hint={globalHint(capability)}
                      checked={checked}
                      disabled={blocked || globalLocked(capability, checked)}
                      onChange={(event) => toggleCapability(capability, event.target.checked)}
                    />
                  )
                })}
              </CardContent>
            </section>
          </Card>

          {/* ── Alcances ─────────────────────────────────────────────────── */}
          <Card>
            <section aria-labelledby={`${panelId}-alcances`}>
              <CardHeader>
                <h2 id={`${panelId}-alcances`} className="text-base font-semibold text-foreground">
                  Permisos por entorno o servidor
                </h2>
                {/*
                  La semántica que más sorprende, y por eso va escrita y no implícita: un permiso
                  de alcance ocupa el lugar del rol base dentro de ese alcance, no se suma. Pero NO
                  se promete más de lo que el servidor cumple: las lecturas y las capacidades
                  globales no se recortan por alcance, y eso lo dice la sección «{effectiveHeading}».
                */}
                <p className="text-sm text-muted-foreground">
                  Dentro de su alcance, el permiso ocupa el lugar del rol base{' '}
                  <Badge tone="neutral">{user.gateway_role}</Badge> — no se suma a él. Si hay dos
                  sobre el mismo destino rige el más restrictivo. En «{effectiveHeading}» se ve qué
                  queda y en qué operaciones se aplica.
                </p>
                {scopeCeilingHint && !blocked && (
                  <p className="text-sm text-muted-foreground">{scopeCeilingHint}</p>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {/*
                  El aviso menos intuitivo de esta pantalla (v23 §8): una base SIN entorno no
                  resuelve al entorno por defecto —ése es el más permisivo— sino al MÁS PROTEGIDO.
                  Así que acotar a alguien a un entorno también le acota el acceso a toda base que
                  nadie clasificó.

                  Sin esto, el administrador otorga un permiso creyendo que amplía cuando recorta,
                  y se entera cuando la persona reporta que perdió acceso a algo que no tiene nada
                  que ver.
                */}
                {grants.length > 0 && readiness.data && !readiness.data.ready && (
                  <Callout
                    tone="warning"
                    title={
                      readiness.data.unclassified_databases === 1
                        ? 'Hay 1 base sin entorno asignado'
                        : `Hay ${readiness.data.unclassified_databases} bases sin entorno asignado`
                    }
                  >
                    <p>
                      Una base sin entorno se trata como el entorno <strong>más protegido</strong>
                      {readiness.data.fallback_environment_slug ? (
                        <>
                          {' '}
                          (
                          <code className="font-mono">
                            {readiness.data.fallback_environment_slug}
                          </code>
                          )
                        </>
                      ) : null}
                      , no como el default. Si acotás el acceso de esta persona a un entorno,
                      también se lo estás acotando sobre esas bases, aunque no tengan nada que ver.
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
                      Se puede guardar igual —el backend lo acepta—, pero conviene clasificarlas
                      primero.
                    </p>
                  </Callout>
                )}

                {/* F-17: aplica aunque el inventario esté «listo», por eso va aparte del aviso de arriba. */}
                {grants.length > 0 && readiness.data?.server_resolution_inventory_only && (
                  <Callout
                    tone="info"
                    title="El entorno de un servidor sale solo de lo inventariado"
                  >
                    <p>
                      {SERVER_RESOLUTION_INVENTORY_NOTE} Si falta alguna, adoptala para que cuente.
                    </p>
                  </Callout>
                )}

                {grants.length === 0 ? (
                  <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
                    Sin permisos de alcance: rige el rol base en todo el gateway.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {grants.map((grant) => {
                      const targets = targetsFor(grant.scope_type)
                      const selected =
                        targets.find((target) => target.id === grant.scope_id) ?? null
                      const roleOptions = roleOptionsFor(grant)
                      return (
                        <li
                          key={grant.rowId}
                          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            <div className="w-full sm:w-36">
                              <Combobox<ScopeTypeOption>
                                items={SCOPE_TYPE_OPTIONS}
                                value={
                                  SCOPE_TYPE_OPTIONS.find(
                                    (option) => option.value === grant.scope_type,
                                  ) ?? null
                                }
                                onChange={(option) => {
                                  // Cambiar el tipo invalida el destino: un id de entorno no
                                  // significa nada como id de servidor. Se limpia para obligar a
                                  // re-elegirlo.
                                  if (!option) return
                                  updateGrant(grant.rowId, {
                                    scope_type: option.value,
                                    scope_id: 0,
                                  })
                                }}
                                itemToString={(option) => option.label}
                                itemToKey={(option) => option.value}
                                label="Tipo"
                                disabled={blocked}
                              />
                            </div>
                            <div className="w-full min-w-0 flex-1">
                              <Combobox<TargetOption>
                                items={targets}
                                value={selected}
                                onChange={(option) =>
                                  updateGrant(grant.rowId, { scope_id: option?.id ?? 0 })
                                }
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
                            <div className="w-full sm:w-36">
                              <Combobox<RoleOption>
                                items={roleOptions}
                                // De `roleOptions` y no de todos: un valor fuera de las opciones
                                // se pintaría como elegido sin poder volver a elegirse.
                                value={
                                  roleOptions.find((option) => option.value === grant.role) ?? null
                                }
                                onChange={(option) => {
                                  if (option) updateGrant(grant.rowId, { role: option.value })
                                }}
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
                                    current.filter((row) => row.rowId !== grant.rowId),
                                  )
                                }
                              />
                            </div>
                          </div>
                          {/* Qué cambia este permiso lo dice UNA vez «Acceso efectivo al
                              guardar», en su fila: repetirlo acá mostraba la misma diferencia dos
                              veces, con colores distintos. En `lg` esa fila está al costado, en
                              pantallas chicas más abajo: el texto no dice «abajo». */}
                          {grant.scope_id >= 1 && (
                            <a
                              href={`#${effectiveAccessRowId(panelId, grant.scope_type, grant.scope_id)}`}
                              className="self-start text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              Ver el efecto al guardar
                            </a>
                          )}
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
                    onClick={() => {
                      nextRowId.current += 1
                      const rowId = `nuevo-${nextRowId.current}`
                      setGrants((current) => [
                        ...current,
                        { rowId, scope_type: 'environment', scope_id: 0, role: 'viewer' },
                      ])
                    }}
                  >
                    Añadir permiso
                  </Button>
                </div>
              </CardContent>
            </section>
          </Card>

          {/* ── Capacidades puntuales ────────────────────────────────────────
              Solo con `access.admin` (el listado es suyo) y con sus propios endpoints: no pasan
              por «Guardar accesos». Quien no la tiene no ve la sección; el panel de
              acceso efectivo ya le avisa que las puntuales no se incluyen. */}
          {canReadEffectiveAccess && (
            <CapabilityGrantsSection
              user={user}
              isSelf={isSelf}
              catalog={catalog}
              isCatalogLoading={catalogQuery.isLoading}
            />
          )}
        </div>

        {/* ── Acceso efectivo ──────────────────────────────────────────────── */}
        <Card className="min-w-0">
          <section aria-labelledby={`${panelId}-efectivo`}>
            <CardHeader>
              <h2 id={`${panelId}-efectivo`} className="text-base font-semibold text-foreground">
                {effectiveHeading}
              </h2>
              <p className="text-sm text-muted-foreground">
                {canReadEffectiveAccess
                  ? `Lo que puede hacer ${user.username} hoy, según el servidor. Si cambiás algo en esta pantalla, abajo ves cómo quedaría.`
                  : `Lo que va a poder hacer ${user.username} con lo que quede en esta pantalla.`}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <EffectiveAccessPanel
                mode="admin"
                baseRole={user.gateway_role}
                globalCapabilities={capabilities}
                grants={effectiveGrants}
                catalog={catalog}
                isLoading={catalogQuery.isLoading}
                serverAccess={
                  canReadEffectiveAccess
                    ? {
                        data: effectiveAccess.data,
                        isLoading: effectiveAccess.isLoading,
                        isError: effectiveAccess.isError,
                        onRetry: () => void effectiveAccess.refetch(),
                      }
                    : undefined
                }
                hasUnsavedChanges={dirty}
                idPrefix={panelId}
              />
              {!canReadEffectiveAccess && (
                <p className="text-xs text-muted-foreground">
                  Las capacidades puntuales no se incluyen acá: solo las ve quien administra los
                  accesos.
                </p>
              )}
            </CardContent>
          </section>
        </Card>
      </div>

      {/* ── Separación de funciones: rechazo del servidor ─────────────────
          Fijo en la pantalla (el toast se va solo) y junto a la barra de guardar, que es lo que se
          acaba de apretar. El reenvío manda EXACTAMENTE este estado más `sod_override`. */}
      {activeRejection && (
        <SodConflictPanel
          key={activeRejection.key}
          conflicts={activeRejection.conflicts}
          labelOptions={sodLabels}
          reasonMinLength={activeRejection.reasonMinLength}
          maxHours={activeRejection.maxHours}
          onResend={submit}
          isPending={replaceAccess.isPending}
          resendError={overrideError}
          resendLabel="Guardar accesos con excepción de emergencia"
        />
      )}

      {/* Barra de acciones fija al pie: en una página larga, «Guardar» no puede quedar tres
          pantallas más abajo. La consecuencia del botón va al lado del botón, leída antes de
          apretarlo. */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-elevated sm:flex-row sm:items-center sm:justify-end">
        <p id={sessionsNoteId} className="text-xs text-muted-foreground sm:mr-auto">
          {blocked
            ? 'Solo lectura: desde esta pantalla no se puede guardar nada para esta cuenta.'
            : 'Al guardar se cierran sus sesiones: va a tener que volver a entrar para que los accesos nuevos tengan efecto.'}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Link
            to={GATEWAY_USERS_PATH}
            className={buttonClassName({ variant: 'ghost' })}
            aria-disabled={replaceAccess.isPending || undefined}
            onClick={(event) => {
              if (replaceAccess.isPending) event.preventDefault()
            }}
          >
            {blocked ? 'Volver al listado' : 'Cancelar'}
          </Link>
          {!blocked && (
            <Button
              type="button"
              onClick={() => submit()}
              isLoading={replaceAccess.isPending}
              disabled={incomplete}
              aria-describedby={
                showSodWarning ? `${sessionsNoteId} ${sodWarningId}` : sessionsNoteId
              }
            >
              Guardar accesos
            </Button>
          )}
        </div>
      </div>

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          open
          onClose={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
          title="¿Salir sin guardar?"
          description={`Los cambios en los accesos de ${user.username} todavía no se guardaron. Si salís ahora se pierden.`}
          confirmLabel="Salir sin guardar"
        />
      )}
    </div>
  )
}
