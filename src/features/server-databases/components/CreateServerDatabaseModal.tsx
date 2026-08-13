import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import {
  Button,
  Combobox,
  IconButton,
  Input,
  Modal,
  RefreshIcon,
  Switch,
  Textarea,
} from '@/components/ui'
import { toApiError, type ApiError } from '@/lib/api/errors'
import { MAX_DATABASE_NAME_LENGTH, type EngineType, type ServerUserOut } from '@/lib/contracts'
import { useServerUserOptions } from '@/features/server-users/hooks/use-server-user-options'
import {
  CharsetCollationSelector,
  engineToFamily,
  type CharsetCollationOverrideOption,
} from '@/features/charset-collation-options'
import { useCreateServerDatabase } from '../hooks/use-server-database-mutations'
import {
  buildCreateBody,
  CREATE_FORM_DEFAULTS,
  engineCopy,
  engineLabel,
  validateNewDatabaseName,
  warnDuplicateDatabaseName,
  type CreateFormValues,
} from '../logic'
import { classifyCreateError, localeHint, REGISTER_LEFTOVER_WARNING } from '../messages'

interface CreateServerDatabaseModalProps {
  open: boolean
  onClose: () => void
  serverId: number
  serverName: string
  engine: EngineType
  /** Nombres físicos ya existentes en el servidor, para el aviso NO bloqueante de duplicado. */
  existingNames: readonly string[]
}

/**
 * Fotografía del envío que falló. Se guarda junto al error porque las dos condiciones que
 * modulan el mensaje (¿había registro en inventario?, ¿se mandó locale?) son las del REQUEST,
 * no las del formulario actual: el admin puede haber tocado los campos después del fallo.
 */
interface CreateFailure {
  error: ApiError
  registered: boolean
  sentCollation: boolean
}

/** Repueble el selector de charset/collation cuando el 422 de catálogo trae alternativas. */
interface CatalogFailure {
  options: CharsetCollationOverrideOption[]
  message: string
  truncated: boolean
}

const NAME_RULES = `Debe empezar con letra o «_» y contener solo letras, dígitos y «_». Sin espacios, guiones, puntos ni acentos. Máx. ${MAX_DATABASE_NAME_LENGTH} caracteres.`

/** El backend no valida el locale: lo delega al motor, que falla con un 500 opaco (§S1). */
const LOCALE_WARNING =
  'El locale debe existir en el sistema operativo del servidor PostgreSQL. Si no existe, la creación falla en el motor y el error llega como error interno (500), no como error de validación.'

const OWNER_HINT =
  'Rol nativo de PostgreSQL que será dueño de la base. Distinto del propietario del inventario.'

/** Con `register=true` el backend ignora `owner` y usa el username del ServerUser elegido. */
const OWNER_IGNORED_NOTE =
  'Al registrar en el inventario, el dueño en el motor será el usuario elegido como propietario.'

const REGISTER_HINT_OFF =
  'Solo se creará en el motor. No quedará registrada en el gateway; podrás adoptarla más tarde.'
const REGISTER_HINT_ON =
  'Además quedará registrada como base gestionada (origen: aprovisionada), apta para blueprints y migraciones.'

/** El 422 de catálogo trunca `allowed` a 50 opciones (§8.3 de la API). */
const CATALOG_TRUNCATED_NOTE = 'Se muestran las primeras 50 opciones; hay más disponibles.'

/**
 * Creación de una base de datos EN EL MOTOR (🔌 `POST /servers/{id}/databases`), con registro
 * opcional en el inventario del gateway.
 *
 * Los errores se muestran EN LÍNEA y anclados al campo culpable: el hook no emite toast de error
 * a propósito, porque un toast genérico perdería la acción de recuperación (§4.2).
 */
export function CreateServerDatabaseModal({
  open,
  onClose,
  serverId,
  serverName,
  engine,
  existingNames,
}: CreateServerDatabaseModalProps) {
  const copy = engineCopy(engine)
  const isPostgres = engine === 'postgresql'
  const create = useCreateServerDatabase(serverId)
  const [failure, setFailure] = useState<CreateFailure | null>(null)
  const [catalogFailure, setCatalogFailure] = useState<CatalogFailure | null>(null)

  const uid = useId()
  const nameId = `${uid}-name`
  const nameRulesId = `${uid}-name-rules`

  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setError,
    watch,
  } = useForm<CreateFormValues>({ defaultValues: CREATE_FORM_DEFAULTS })

  const name = watch('name')
  const charsetCollation = watch('charsetCollation')
  const hasCollation = charsetCollation != null && charsetCollation.collation != null
  const registerInventory = watch('register')

  // Carga DIFERIDA: con el interruptor apagado no se piden usuarios que nadie va a elegir.
  const owners = useServerUserOptions(registerInventory ? serverId : null)
  const ownerItems = owners.data ?? []
  const hasNoOwners = owners.data !== undefined && ownerItems.length === 0

  const isPending = create.isPending
  const duplicateWarning = warnDuplicateDatabaseName(name, existingNames)

  const failureInfo = failure ? classifyCreateError(failure.error) : null
  const failureLocaleHint = failure
    ? localeHint(failure.error, isPostgres, failure.sentCollation)
    : undefined
  // El `X-Request-ID` solo se ofrece donde sirve para soporte: fallos del lado del servidor.
  const supportCode = failure && failure.error.status >= 500 ? failure.error.requestId : undefined
  const showFailureBlock =
    failure !== null &&
    failureInfo !== null &&
    (failureInfo.field === null || failure.registered || supportCode !== undefined)

  const handleClose = () => {
    reset(CREATE_FORM_DEFAULTS)
    setFailure(null)
    setCatalogFailure(null)
    onClose()
  }

  const submit = (values: CreateFormValues) => {
    setFailure(null)
    setCatalogFailure(null)
    create.mutate(buildCreateBody(values, engine), {
      // El toast de éxito lo emite el hook; aquí solo se cierra y se limpia el formulario.
      onSuccess: () => {
        handleClose()
      },
      onError: (err) => {
        const apiError = toApiError(err)
        // El 422 de catálogo se resuelve ANTES de clasificar name/ownerId: no es un error de esos
        // dos campos, sino de la combinación charset/collation contra el catálogo del gateway.
        if (apiError.charsetRejected) {
          setCatalogFailure({
            options: apiError.charsetRejected.allowed,
            message: apiError.message,
            truncated: apiError.charsetRejected.truncated,
          })
          return
        }
        const info = classifyCreateError(apiError)
        const detail = info.hint ? `${apiError.message} ${info.hint}` : apiError.message
        if (info.field === 'name') setError('name', { message: detail })
        if (info.field === 'ownerId') {
          setError('ownerId', { message: detail })
          // El propietario dejó de ser válido: sin recargar, el admin reelegiría lo mismo.
          if (info.reloadOwners) void owners.refetch()
        }
        setFailure({
          error: apiError,
          registered: values.register,
          sentCollation:
            values.charsetCollation != null && values.charsetCollation.collation != null,
        })
      },
    })
  }

  return (
    <Modal
      open={open}
      // Mientras corre la creación el modal no se cierra: la operación toca el motor real y
      // cerrar dejaría al admin sin saber en qué acabó.
      onClose={isPending ? () => undefined : handleClose}
      title="Crear base de datos"
      description={`Se ejecutará CREATE DATABASE en «${serverName}» (${engineLabel(engine)}).`}
      size="lg"
    >
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-6" noValidate>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Identificación</h3>
          <Input
            id={nameId}
            label="Nombre de la base de datos"
            required
            className="font-mono"
            maxLength={MAX_DATABASE_NAME_LENGTH}
            autoComplete="off"
            spellCheck={false}
            disabled={isPending}
            error={errors.name?.message}
            // Las reglas quedan SIEMPRE visibles (no como `hint`, que el error ocultaría), así
            // que se enlazan a mano sin perder el anuncio del error.
            aria-describedby={errors.name ? `${nameId}-error ${nameRulesId}` : nameRulesId}
            {...register('name', {
              validate: (value) => validateNewDatabaseName(engine, value),
            })}
          />
          <div className="flex items-start justify-between gap-3">
            <p id={nameRulesId} className="text-xs text-muted-foreground">
              {NAME_RULES}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {name.length}/{MAX_DATABASE_NAME_LENGTH}
            </span>
          </div>
          {duplicateWarning && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs text-foreground">
              {duplicateWarning}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-foreground">Configuración del motor</h3>
          <div className="flex flex-col gap-1.5">
            <Controller
              control={control}
              name="charsetCollation"
              render={({ field }) => (
                <CharsetCollationSelector
                  engineFamily={engineToFamily(engine)}
                  value={field.value}
                  onChange={field.onChange}
                  label={copy.combinedLabel}
                  overrideOptions={catalogFailure?.options}
                  disabled={isPending}
                />
              )}
            />
            {catalogFailure && (
              <div className="rounded-lg border border-error/30 bg-error/5 p-2 text-xs text-foreground">
                <p>{catalogFailure.message}</p>
                {catalogFailure.truncated && (
                  <p className="text-muted-foreground">{CATALOG_TRUNCATED_NOTE}</p>
                )}
              </div>
            )}
          </div>

          {isPostgres && hasCollation && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
              {LOCALE_WARNING}
            </p>
          )}

          {copy.showOwner && (
            <div className="flex flex-col gap-1.5">
              <Input
                label="Owner (rol del motor)"
                hint={OWNER_HINT}
                autoComplete="off"
                disabled={isPending || registerInventory}
                {...register('owner')}
              />
              {registerInventory && (
                <p className="text-xs text-muted-foreground">{OWNER_IGNORED_NOTE}</p>
              )}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-foreground">Inventario del gateway</h3>
          <Controller
            control={control}
            name="register"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Registrar también en el inventario"
                hint={field.value ? REGISTER_HINT_ON : REGISTER_HINT_OFF}
                disabled={isPending}
              />
            )}
          />

          {registerInventory && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Controller
                  control={control}
                  name="ownerId"
                  rules={{
                    validate: (value, values) =>
                      values.register && value === null
                        ? 'Elegí un propietario para registrar la base en el inventario.'
                        : undefined,
                  }}
                  render={({ field, fieldState }) => (
                    <Combobox<ServerUserOut>
                      items={ownerItems}
                      value={ownerItems.find((user) => user.id === field.value) ?? null}
                      onChange={(user) => field.onChange(user?.id ?? null)}
                      itemToString={(user) =>
                        user.host ? `${user.username}@${user.host}` : user.username
                      }
                      itemToKey={(user) => user.id}
                      label="Propietario (usuario del servidor)"
                      placeholder="Elegí un usuario de este servidor"
                      hint="Requerido para registrar. No recibe privilegios automáticamente."
                      isLoading={owners.isFetching}
                      disabled={isPending}
                      error={fieldState.error?.message}
                      required
                    />
                  )}
                />
                {hasNoOwners && (
                  <p className="text-xs text-muted-foreground">
                    Este servidor no tiene usuarios en el inventario.{' '}
                    <Link to="/server-users" className="text-primary underline">
                      Crear usuario →
                    </Link>
                  </p>
                )}
              </div>

              <Textarea
                label="Notas"
                rows={2}
                hint="Solo se guarda si registrás la base en el inventario."
                disabled={isPending}
                {...register('notes')}
              />
            </div>
          )}
        </section>

        {showFailureBlock && failure && failureInfo && (
          <div className="flex flex-col gap-2 rounded-card border border-error/30 bg-error/5 p-3 text-xs">
            {failureInfo.field === null && (
              <p className="font-medium text-error">{failure.error.message}</p>
            )}
            {failureInfo.field === null && failureInfo.hint && (
              <p className="text-muted-foreground">{failureInfo.hint}</p>
            )}
            {failureLocaleHint && <p className="text-muted-foreground">{failureLocaleHint}</p>}

            {failureInfo.retryable && (
              <div className="flex flex-wrap items-center gap-2">
                <IconButton
                  type="button"
                  label="Reintentar"
                  icon={<RefreshIcon />}
                  variant="outline"
                  size="icon-sm"
                  disabled={isPending}
                  onClick={() => void handleSubmit(submit)()}
                />
                <span className="text-muted-foreground">
                  Si vuelve a fallar, probá la conexión de «{serverName}» desde la pantalla de
                  servidores.
                </span>
              </div>
            )}

            {failure.registered && (
              <p className="text-foreground">
                {REGISTER_LEFTOVER_WARNING}{' '}
                <Link to="/managed-databases" className="text-primary underline">
                  Revisar bases gestionadas →
                </Link>
              </p>
            )}

            {supportCode && (
              <p className="text-muted-foreground">Código de soporte: {supportCode}</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isPending}>
            {isPending ? 'Creando base de datos…' : 'Crear base de datos 🔌'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
