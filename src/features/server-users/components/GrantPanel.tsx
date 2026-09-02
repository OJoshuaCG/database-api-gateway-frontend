import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  EmptyState,
  ErrorState,
  Input,
  RadioCardGroup,
  Spinner,
  Switch,
} from '@/components/ui'
import type {
  EngineType,
  GrantLevel,
  ObjectMapping,
  PermissionProfileOut,
  ServerUserOut,
} from '@/lib/contracts'
import { PrivilegeMultiSelect, grantLevelsForEngine } from '@/features/privileges'
import {
  profileCompatibility,
  profilesApplicableTo,
  usePermissionProfileOptions,
} from '@/features/permission-profiles'
import { useCheckGrantable } from '@/features/servers/hooks/use-grantable'
import {
  useApplyProfile,
  useApplyProfileToDatabases,
  useGrantPrivilegesToDatabases,
  useRevokePrivilegesFromDatabases,
} from '../hooks/use-user-grants'
import { DatabaseMultiSelect } from './DatabaseMultiSelect'
import { GrantOutcomes } from './GrantOutcomes'
import {
  BULK_CHUNK_SIZE,
  EMPTY_OBJECT_DRAFT,
  buildObjectRef,
  gatePrivilegesIn,
  levelNeedsDatabase,
  missingObjectFields,
  outcomeRowsFromBulk,
  outcomeRowsFromFanOut,
  type GrantObjectDraft,
  type GrantOutcomeRow,
} from './grant-logic'
import { LEVELS_WITH_SCHEMA, LEVELS_WITH_TABLE, ROUTINE_KINDS } from './grant-object-levels'

/** Las tres operaciones de la pantalla. Cada una tiene consecuencias distintas, y por eso se eligen
 *  explícitamente en vez de esconderse tras un toggle: revocar no es «otorgar al revés», y aplicar
 *  un perfil nunca revoca (v21 §11). */
type Mode = 'grant' | 'revoke' | 'profile'

const MODE_OPTIONS = [
  {
    value: 'grant' as const,
    label: 'Otorgar privilegios',
    hint: 'Elegís nivel y privilegios a mano, y se otorgan sobre cada base marcada.',
  },
  {
    value: 'revoke' as const,
    label: 'Revocar privilegios',
    hint: 'Quita privilegios ya otorgados sobre cada base marcada.',
  },
  {
    value: 'profile' as const,
    label: 'Aplicar un perfil',
    hint: 'Una plantilla ya guardada. Solo agrega privilegios: nunca revoca.',
  },
]

interface GrantPanelProps {
  user: ServerUserOut
  engine: EngineType | null
}

/**
 * Otorgar y revocar permisos de un usuario 🔌 — una sola superficie para las dos vías que antes
 * vivían en pestañas separadas («Otorgar / revocar» y «Aplicar perfil»).
 *
 * Estaban partidas por su endpoint, no por lo que el operador quiere hacer: en las dos elige un
 * destino y aplica permisos, así que tenerlas aparte obligaba a saber de antemano cuál de las dos
 * pantallas resolvía su caso. Acá la elección es la primera pregunta del formulario y el resto
 * —bases destino, revisión y resultados— es común.
 *
 * El cambio que más se nota es el destino: **ya no se teclea el nombre de la base**. Sale de la
 * lista en vivo del servidor (adoptadas o no) y admite varias a la vez, que es lo que el contrato
 * v21 habilitó con el bulk de perfiles (§11) y lo que el fan-out cubre para los privilegios
 * sueltos, donde no existe un endpoint en lote (§12).
 */
export function GrantPanel({ user, engine }: GrantPanelProps) {
  const isPg = engine === 'postgresql'
  const levelOptions = grantLevelsForEngine(engine)

  const [mode, setModeState] = useState<Mode>('grant')
  const [level, setLevel] = useState<GrantLevel>('database')
  const [draft, setDraft] = useState<GrantObjectDraft>(EMPTY_OBJECT_DRAFT)
  const [privileges, setPrivileges] = useState<string[]>([])
  const [withGrantOption, setWithGrantOption] = useState(false)
  const [cascade, setCascade] = useState(false)
  const [confirmGrantee, setConfirmGrantee] = useState('')
  const [profile, setProfile] = useState<PermissionProfileOut | null>(null)
  const [databases, setDatabases] = useState<string[]>([])
  const [gateAcknowledged, setGateAcknowledged] = useState(false)

  const profiles = usePermissionProfileOptions()
  const grantable = useCheckGrantable(user.server_id)
  const grantFanOut = useGrantPrivilegesToDatabases(user.id, user.server_id)
  const revokeFanOut = useRevokePrivilegesFromDatabases(user.id, user.server_id)
  const applyBulk = useApplyProfileToDatabases(user.id, user.server_id)
  const applyGlobal = useApplyProfile(user.id, user.server_id)

  /** Cambiar de operación tira los resultados anteriores: son de otra cosa y confundirían. */
  function setMode(next: Mode) {
    setModeState(next)
    setGateAcknowledged(false)
    grantFanOut.reset()
    revokeFanOut.reset()
    applyBulk.reset()
    applyGlobal.reset()
    grantable.reset()
  }

  const isProfileMode = mode === 'profile'
  const isRevoke = mode === 'revoke'

  const applicableProfiles = useMemo(
    () => profilesApplicableTo(profiles.data ?? [], engine),
    [profiles.data, engine],
  )

  /** Niveles del perfil que sí cuelgan de una base: definen qué campos de objeto pedir. */
  const profileObjectLevels = useMemo(
    () => (profile?.items ?? []).map((item) => item.level).filter(levelNeedsDatabase),
    [profile],
  )

  const activeLevels = isProfileMode ? profileObjectLevels : [level]
  const needsDatabase = activeLevels.length > 0
  const showSchema = isPg && activeLevels.some((item) => LEVELS_WITH_SCHEMA.includes(item))
  const showTable = activeLevels.some((item) => LEVELS_WITH_TABLE.includes(item))
  const showColumns = activeLevels.includes('column')
  const showSequence = activeLevels.includes('sequence')
  const showRoutine = activeLevels.includes('routine')

  /** Niveles del perfil que se van a omitir porque su objeto está incompleto (v21 §9). */
  const incompleteLevels = useMemo(() => {
    if (!isProfileMode) return []
    return profileObjectLevels
      .map((item) => ({ level: item, missing: missingObjectFields(item, draft) }))
      .filter((entry) => entry.missing.length > 0)
  }, [isProfileMode, profileObjectLevels, draft])

  const missingForLevel = isProfileMode ? [] : missingObjectFields(level, draft)

  const gatePrivileges = isProfileMode
    ? (profile?.items ?? []).filter((item) => item.requires_confirmation).map((item) => item.level)
    : gatePrivilegesIn(privileges)
  const needsGateConfirmation = gatePrivileges.length > 0 || (mode === 'grant' && withGrantOption)

  const cascadeNeedsConfirm = isRevoke && cascade && confirmGrantee !== user.username
  const isPending =
    grantFanOut.isPending || revokeFanOut.isPending || applyBulk.isPending || applyGlobal.isPending

  const blockingReason = (() => {
    if (isProfileMode && !profile) return 'Elegí un perfil de permisos.'
    if (
      isProfileMode &&
      profileObjectLevels.length > 0 &&
      incompleteLevels.length === profileObjectLevels.length
    ) {
      return 'Ningún nivel del perfil tiene su objeto completo: no se aplicaría ningún permiso.'
    }
    if (!isProfileMode && privileges.length === 0) return 'Seleccioná al menos un privilegio.'
    if (!isProfileMode && missingForLevel.length > 0) {
      return `Falta indicar: ${missingForLevel.join(', ')}.`
    }
    if (needsDatabase && databases.length === 0) return 'Marcá al menos una base de datos.'
    if (needsGateConfirmation && !gateAcknowledged) {
      return 'Confirmá que entendés el alcance de los privilegios sensibles.'
    }
    if (cascadeNeedsConfirm) return `Escribí «${user.username}» para confirmar el CASCADE.`
    return undefined
  })()

  function updateDraft(patch: Partial<GrantObjectDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }))
  }

  /** Destinos de la operación: una entrada por base, o una sola sin base si el nivel es global. */
  const targets = needsDatabase ? databases : ['(global)']

  function handleSubmit() {
    if (blockingReason) return

    if (mode === 'grant') {
      grantFanOut.mutate(
        targets.map((database) => ({
          label: database,
          body: {
            level,
            object_ref: buildObjectRef(level, draft, needsDatabase ? database : undefined, isPg),
            privileges,
            with_grant_option: withGrantOption,
          },
        })),
      )
      return
    }

    if (mode === 'revoke') {
      revokeFanOut.mutate({
        items: targets.map((database) => ({
          label: database,
          body: {
            level,
            object_ref: buildObjectRef(level, draft, needsDatabase ? database : undefined, isPg),
            privileges,
            cascade: cascade || undefined,
          },
        })),
        confirmGrantee: cascade ? confirmGrantee : undefined,
      })
      return
    }

    if (!profile) return
    const incomplete = new Set(incompleteLevels.map((entry) => entry.level))
    const objectMappings: ObjectMapping[] = profile.items
      .filter((item) => !incomplete.has(item.level))
      .map((item) => {
        if (!levelNeedsDatabase(item.level)) return { level: item.level, object_ref: {} }
        // El `database` del `object_ref` lo sobrescribe el backend con la base de la iteración
        // (v21 §11): mandarlo sería redundante y daría a entender que este mapeo apunta a una.
        return { level: item.level, object_ref: buildObjectRef(item.level, draft, undefined, isPg) }
      })

    if (!needsDatabase) {
      applyGlobal.mutate({ profileId: profile.id, body: { object_mappings: objectMappings } })
      return
    }
    applyBulk.mutate({ profileId: profile.id, databases, objectMappings })
  }

  const outcomeRows: GrantOutcomeRow[] = (() => {
    if (grantFanOut.data) return outcomeRowsFromFanOut(grantFanOut.data)
    if (revokeFanOut.data) return outcomeRowsFromFanOut(revokeFanOut.data)
    if (applyBulk.data) return outcomeRowsFromBulk(applyBulk.data.results)
    if (applyGlobal.data) {
      return [
        {
          label: '(global)',
          ok: applyGlobal.data.errors.length === 0,
          detail: `${applyGlobal.data.grants_applied} grant(s)`,
          skippedLevels:
            applyGlobal.data.skipped_levels.length > 0
              ? applyGlobal.data.skipped_levels
              : undefined,
          errors: applyGlobal.data.errors.length > 0 ? applyGlobal.data.errors : undefined,
        },
      ]
    }
    return []
  })()

  const batches = Math.ceil(databases.length / BULK_CHUNK_SIZE)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1 · Qué querés hacer</CardTitle>
          <CardDescription>
            Las tres operaciones tocan el motor real 🔌 y no se deshacen solas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RadioCardGroup
            title="Operación"
            options={MODE_OPTIONS}
            value={mode}
            onChange={setMode}
            columns={3}
          />

          {isProfileMode ? (
            <ProfileFields
              profiles={applicableProfiles}
              isLoading={profiles.isLoading}
              isError={profiles.isError}
              error={profiles.error}
              onRetry={() => void profiles.refetch()}
              engine={engine}
              value={profile}
              onChange={(next) => {
                setProfile(next)
                setGateAcknowledged(false)
              }}
            />
          ) : (
            <div className="w-full sm:max-w-xs">
              <Combobox
                items={levelOptions}
                value={levelOptions.find((option) => option.value === level) ?? null}
                onChange={(option) => setLevel(option?.value ?? 'database')}
                itemToString={(option) => option.label}
                itemToKey={(option) => option.value}
                label="Nivel"
              />
            </div>
          )}

          {(showSchema || showTable || showColumns || showSequence || showRoutine) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {showSchema && (
                <Input
                  label="Esquema"
                  hint="PostgreSQL; default «public»."
                  value={draft.schema}
                  onChange={(event) => updateDraft({ schema: event.target.value })}
                />
              )}
              {showTable && (
                <Input
                  label="Tabla"
                  hint={
                    isProfileMode || databases.length > 1
                      ? 'El mismo nombre en cada base marcada.'
                      : undefined
                  }
                  value={draft.table}
                  onChange={(event) => updateDraft({ table: event.target.value })}
                />
              )}
              {showColumns && (
                <Input
                  label="Columnas"
                  hint="Separadas por coma."
                  value={draft.columns}
                  onChange={(event) => updateDraft({ columns: event.target.value })}
                />
              )}
              {showSequence && (
                <Input
                  label="Secuencia"
                  value={draft.sequence}
                  onChange={(event) => updateDraft({ sequence: event.target.value })}
                />
              )}
              {showRoutine && (
                <>
                  <Combobox
                    items={ROUTINE_KINDS}
                    value={draft.routineKind}
                    onChange={(value) => updateDraft({ routineKind: value ?? 'FUNCTION' })}
                    itemToString={(value) => value}
                    itemToKey={(value) => value}
                    label="Tipo de rutina"
                  />
                  <Input
                    label="Nombre de la rutina"
                    value={draft.routineName}
                    onChange={(event) => updateDraft({ routineName: event.target.value })}
                  />
                </>
              )}
            </div>
          )}

          {!isProfileMode && (
            <PrivilegeMultiSelect
              engine={engine}
              value={privileges}
              onChange={(next) => {
                setPrivileges(next)
                // Cambiar la selección cambia qué privilegios sensibles hay: la confirmación
                // anterior era sobre otra cosa, y arrastrarla la volvería un trámite.
                setGateAcknowledged(false)
              }}
            />
          )}

          {isProfileMode && incompleteLevels.length > 0 && (
            <Callout tone="warning" title="Estos niveles del perfil no se van a aplicar">
              <ul className="list-inside list-disc">
                {incompleteLevels.map((entry) => (
                  <li key={entry.level}>
                    <code>{entry.level}</code> — falta {entry.missing.join(', ')}
                  </li>
                ))}
              </ul>
              <p>
                Se omiten a propósito: un mapeo incompleto no es un destino válido. Completá el
                objeto o asumí que ese nivel queda fuera.
              </p>
            </Callout>
          )}

          {mode === 'grant' && (
            <div className="flex flex-col gap-3">
              <Switch
                checked={withGrantOption}
                onCheckedChange={(checked) => {
                  setWithGrantOption(checked)
                  setGateAcknowledged(false)
                }}
                label="WITH GRANT OPTION"
                hint="Permite al usuario re-delegar estos privilegios. Cuenta como privilegio sensible."
              />
              <GrantableCheck
                disabled={privileges.length === 0}
                sample={needsDatabase ? databases[0] : '(global)'}
                isPending={grantable.isPending}
                canGrant={grantable.data?.can_grant}
                onCheck={() =>
                  grantable.mutate({
                    level,
                    object_ref: buildObjectRef(level, draft, databases[0], isPg),
                    privileges,
                  })
                }
              />
            </div>
          )}

          {isRevoke && isPg && (
            <div className="flex flex-col gap-3">
              <Switch
                checked={cascade}
                onCheckedChange={setCascade}
                label="CASCADE (PostgreSQL)"
                hint="Revoca también los privilegios re-delegados. Exige confirmar el usuario."
              />
              {cascade && (
                <Input
                  label={`Escribí «${user.username}» para confirmar el CASCADE`}
                  value={confirmGrantee}
                  onChange={(event) => setConfirmGrantee(event.target.value)}
                  autoComplete="off"
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · Sobre qué bases</CardTitle>
          <CardDescription>
            {isProfileMode
              ? 'El perfil se aplica igual en cada base marcada: el mismo esquema relativo en todas.'
              : 'Los mismos privilegios, una llamada por base marcada.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsDatabase ? (
            <DatabaseMultiSelect
              serverId={user.server_id}
              selected={databases}
              onChange={setDatabases}
              disabled={isPending}
            />
          ) : (
            <Callout tone="info" title="Esta operación no cuelga de ninguna base">
              {isProfileMode
                ? 'Todos los items del perfil son de nivel global: se aplican al servidor entero.'
                : 'El nivel «global» aplica al servidor entero, no a una base concreta.'}
            </Callout>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3 · Revisar y aplicar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Summary
            mode={mode}
            username={user.username}
            level={level}
            privileges={privileges}
            profileName={profile?.name}
            targets={targets}
            needsDatabase={needsDatabase}
          />

          {isProfileMode && (
            <Callout tone="info" title="Aplicar un perfil es una foto, no una suscripción">
              No queda ninguna relación viva entre este usuario y el perfil: si mañana editás el
              perfil, lo ya otorgado <strong>no</strong> se re-sincroniza.
            </Callout>
          )}

          {needsGateConfirmation && (
            <Callout tone="warning" title="Privilegios sensibles">
              <p>
                {isProfileMode
                  ? `Estos niveles del perfil piden confirmación: ${gatePrivileges.join(', ')}.`
                  : gatePrivileges.length > 0
                    ? `Seleccionaste privilegios de escalada: ${gatePrivileges.join(', ')}.`
                    : 'Vas a permitir que el usuario re-delegue estos privilegios.'}{' '}
                La operación queda auditada antes de ejecutarse.
              </p>
              <Checkbox
                label="Entiendo el alcance y quiero continuar"
                checked={gateAcknowledged}
                onChange={(event) => setGateAcknowledged(event.target.checked)}
              />
            </Callout>
          )}

          {isProfileMode && batches > 1 && (
            <Callout tone="info" title={`Se enviará en ${batches} tandas de ${BULK_CHUNK_SIZE}`}>
              El endpoint acepta hasta 100 bases pero está limitado a 5 llamadas por minuto, y cada
              permiso abre su propia conexión al motor. Partirlo evita que el lote se corte a mitad.
            </Callout>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {blockingReason && <p className="text-xs text-muted-foreground">{blockingReason}</p>}
            <Button
              type="button"
              variant={isRevoke ? 'danger' : 'primary'}
              onClick={handleSubmit}
              disabled={Boolean(blockingReason)}
              isLoading={isPending}
            >
              {isRevoke
                ? `Revocar en ${targets.length} destino(s) 🔌`
                : isProfileMode
                  ? `Aplicar perfil en ${targets.length} destino(s) 🔌`
                  : `Otorgar en ${targets.length} destino(s) 🔌`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <GrantOutcomes title="Resultado por destino" rows={outcomeRows} />
    </div>
  )
}

/** Frase de revisión: qué, a quién y dónde, antes de tocar el motor. */
function Summary({
  mode,
  username,
  level,
  privileges,
  profileName,
  targets,
  needsDatabase,
}: {
  mode: Mode
  username: string
  level: GrantLevel
  privileges: string[]
  profileName?: string
  targets: string[]
  needsDatabase: boolean
}) {
  const verb = mode === 'revoke' ? 'Revocar' : mode === 'profile' ? 'Aplicar' : 'Otorgar'
  const what =
    mode === 'profile'
      ? `el perfil «${profileName ?? '—'}»`
      : privileges.length > 0
        ? `${privileges.join(', ')} a nivel ${level}`
        : '(sin privilegios seleccionados)'
  const where = needsDatabase
    ? targets.length === 0
      ? '(ninguna base marcada)'
      : `${targets.length} base(s): ${targets.slice(0, 6).join(', ')}${targets.length > 6 ? `, +${targets.length - 6}` : ''}`
    : 'todo el servidor (nivel global)'

  return (
    <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground">
      {verb} <strong>{what}</strong> a <strong>{username}</strong> sobre {where}.
    </p>
  )
}

/**
 * Pre-chequeo de delegación (§6): comprueba si la credencial pseudo-root del gateway puede
 * delegar esos privilegios. Se corre sobre **una** base de muestra y así se dice: `can_grant`
 * depende del objeto, y comprobar las 100 marcadas costaría 100 conexiones al motor para una
 * comprobación que el backend repite igual antes de cada grant.
 */
function GrantableCheck({
  disabled,
  sample,
  isPending,
  canGrant,
  onCheck,
}: {
  disabled: boolean
  sample: string | undefined
  isPending: boolean
  canGrant: boolean | undefined
  onCheck: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        isLoading={isPending}
        disabled={disabled || !sample}
        onClick={onCheck}
      >
        Comprobar delegación
      </Button>
      {canGrant != null && (
        <Badge tone={canGrant ? 'success' : 'error'}>
          {canGrant ? 'El gateway puede delegar' : 'El gateway NO puede delegar'}
          {sample ? ` · comprobado sobre ${sample}` : ''}
        </Badge>
      )}
    </div>
  )
}

/** Selector de perfil + su plantilla, con el aviso de compatibilidad por familia de motor (§10). */
function ProfileFields({
  profiles,
  isLoading,
  isError,
  error,
  onRetry,
  engine,
  value,
  onChange,
}: {
  profiles: PermissionProfileOut[]
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  engine: EngineType | null
  value: PermissionProfileOut | null
  onChange: (profile: PermissionProfileOut | null) => void
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando perfiles…
      </div>
    )
  }
  if (isError) return <ErrorState error={error} onRetry={onRetry} />
  if (profiles.length === 0) {
    return (
      <EmptyState
        title="No hay perfiles aplicables a este motor"
        description="Creá un perfil de permisos para este motor (o para uno de su misma familia) en «Perfiles de permisos»."
      />
    )
  }

  const compatibility = value && engine ? profileCompatibility(value.engine, engine) : undefined

  return (
    <div className="flex flex-col gap-3">
      <Combobox<PermissionProfileOut>
        items={profiles}
        value={value}
        onChange={onChange}
        itemToString={(option) =>
          `${option.name} · ${option.engine} (${option.items.length} item/s)`
        }
        itemToKey={(option) => option.id}
        label="Perfil de permisos"
        placeholder="Seleccioná un perfil…"
        clearable
      />

      {compatibility === 'same-family' && (
        <Callout
          tone="warning"
          title={`El perfil es de ${value?.engine}, el servidor es ${engine}`}
        >
          Son de la misma familia, así que el gateway lo valida{' '}
          <strong>privilegio por privilegio</strong> contra el catálogo del motor real y lo aplica
          si todos existen ahí. Si alguno no existe, la operación se rechaza entera y te dice
          cuáles.
        </Callout>
      )}

      {value && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {value.items.map((item) => (
            <li key={item.level} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Badge tone="info">{item.level}</Badge>
              <span className="text-sm text-foreground">{item.privileges.join(', ')}</span>
              {item.requires_confirmation && <Badge tone="warning">pide confirmación</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
