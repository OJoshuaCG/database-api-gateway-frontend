import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Callout, Combobox, Input, Modal, Switch, Textarea } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import {
  GATEWAY_EMAIL_MAX,
  GATEWAY_FULL_NAME_MAX,
  GATEWAY_ROLES,
  GATEWAY_USERNAME_MAX,
  GATEWAY_USERNAME_PATTERN,
  GATEWAY_USER_ERROR_CODES,
  isKnownGatewayRole,
  type GatewayRole,
  type GatewayUserCreatedOut,
  type GatewayUserOut,
} from '@/lib/contracts'
import { useCreateGatewayUser, useUpdateGatewayUser } from '../hooks/use-gateway-users'
import { gatewayUserErrorMessage } from '../messages'

/** Qué significa cada rol base, en una línea. Alimenta el `hint` del selector. */
const ROLE_HINTS: Record<GatewayRole, string> = {
  viewer: 'Solo lectura en todo el gateway.',
  operator: 'Puede operar: crear, aplicar y ejecutar.',
  owner: 'Todo lo del operador, más los resultados capturados y la administración de su alcance.',
}

interface RoleOption {
  value: GatewayRole
  label: string
}

const ROLE_OPTIONS: RoleOption[] = GATEWAY_ROLES.map((value) => ({
  value,
  label: `${value} — ${ROLE_HINTS[value]}`,
}))

const emailField = z
  .string()
  .trim()
  .max(GATEWAY_EMAIL_MAX, `Máximo ${GATEWAY_EMAIL_MAX} caracteres`)
  .email('Correo no válido')
  .or(z.literal(''))

const fullNameField = z
  .string()
  .trim()
  .max(GATEWAY_FULL_NAME_MAX, `Máximo ${GATEWAY_FULL_NAME_MAX} caracteres`)

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .max(GATEWAY_USERNAME_MAX, `Máximo ${GATEWAY_USERNAME_MAX} caracteres`)
    .regex(
      GATEWAY_USERNAME_PATTERN,
      'Solo minúsculas, dígitos, punto, guion y guion bajo. Debe empezar y terminar en letra o dígito, y medir 3 caracteres o más.',
    ),
  email: emailField,
  full_name: fullNameField,
  notes: z.string(),
  gateway_role: z.enum(GATEWAY_ROLES),
})
type CreateValues = z.infer<typeof createSchema>

const editSchema = createSchema.omit({ username: true }).extend({ is_active: z.boolean() })
type EditValues = z.infer<typeof editSchema>

interface GatewayUserFormModalProps {
  open: boolean
  onClose: () => void
  /** Ausente = alta; presente = edición. */
  user?: GatewayUserOut
  /** Solo en alta: entrega el usuario recién creado CON su token de invitación. */
  onCreated?: (created: GatewayUserCreatedOut) => void
  /** `username` del administrador con la sesión abierta, para avisar si se está editando a sí mismo. */
  currentUsername?: string | null
}

export function GatewayUserFormModal(props: GatewayUserFormModalProps) {
  // Se remonta por modo para que RHF nazca con los `defaultValues` correctos y el estado del
  // formulario anterior no sobreviva al cambio de usuario editado.
  return props.user ? (
    <EditForm key={`edit-${props.user.id}`} {...props} user={props.user} />
  ) : (
    <CreateForm key="create" {...props} />
  )
}

// ── Alta ───────────────────────────────────────────────────────────────────────
function CreateForm({ open, onClose, onCreated }: GatewayUserFormModalProps) {
  const create = useCreateGatewayUser()
  const [usernameConflict, setUsernameConflict] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    setFocus,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { username: '', email: '', full_name: '', notes: '', gateway_role: 'viewer' },
  })

  const submit = (values: CreateValues) => {
    setUsernameConflict(null)
    create.mutate(
      {
        username: values.username,
        email: values.email || undefined,
        full_name: values.full_name || undefined,
        notes: values.notes || undefined,
        gateway_role: values.gateway_role,
      },
      {
        onSuccess: (created) => onCreated?.(created),
        onError: (error) => {
          const apiError = toApiError(error)
          if (apiError.code === GATEWAY_USER_ERROR_CODES.usernameTaken) {
            setUsernameConflict('Ya existe un usuario con ese nombre.')
            setFocus('username')
          }
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo usuario del gateway"
      description="Una identidad que se autentica contra el gateway. No es un usuario del motor de base de datos."
      size="lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(submit)(event)}>
        {/*
          El alta NO pide contraseña, y hay que decir por qué: si quien crea la cuenta tipeara la
          credencial inicial, conocería una contraseña funcional de esa identidad y toda fila de
          auditoría atribuida a esa persona sería repudiable.
        */}
        <Callout tone="info" title="La contraseña la elige la persona, no vos">
          Al crear la cuenta se genera un <strong>token de invitación</strong> que vas a ver una
          sola vez. Se lo entregás por el canal que corresponda y ella misma fija su contraseña. Así
          ninguna acción auditada queda atribuida a alguien cuya credencial conoció otro.
        </Callout>

        <Input
          label="Nombre de usuario"
          required
          autoFocus
          maxLength={GATEWAY_USERNAME_MAX}
          className="font-mono"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          hint="Minúsculas, dígitos, punto, guion y guion bajo. No se puede cambiar después."
          error={usernameConflict ?? errors.username?.message}
          {...register('username')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Correo"
            type="email"
            maxLength={GATEWAY_EMAIL_MAX}
            autoComplete="off"
            hint="Conviene ponerlo aunque la API no lo exija: si se omite, el servidor guarda una dirección sintética que no recibe correo."
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Nombre completo"
            maxLength={GATEWAY_FULL_NAME_MAX}
            autoComplete="off"
            error={errors.full_name?.message}
            {...register('full_name')}
          />
        </div>

        <Controller
          control={control}
          name="gateway_role"
          render={({ field }) => (
            <Combobox<RoleOption>
              items={ROLE_OPTIONS}
              value={ROLE_OPTIONS.find((option) => option.value === field.value) ?? null}
              onChange={(option) => field.onChange(option?.value ?? 'viewer')}
              itemToString={(option) => option.label}
              itemToKey={(option) => option.value}
              label="Rol base"
              required
              hint="Se puede acotar o ampliar por entorno y por servidor desde «Accesos», una vez creada la cuenta."
              error={errors.gateway_role?.message}
            />
          )}
        />

        <Textarea
          label="Notas (solo escritura)"
          rows={2}
          hint="La API las acepta pero NO las devuelve, así que no vas a poder volver a leerlas desde acá."
          error={errors.notes?.message}
          {...register('notes')}
        />

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={create.isPending}>
            Crear y generar invitación
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Edición ────────────────────────────────────────────────────────────────────
function EditForm({
  open,
  onClose,
  user,
  currentUsername,
}: GatewayUserFormModalProps & { user: GatewayUserOut }) {
  const update = useUpdateGatewayUser(user.id)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      email: user.email ?? '',
      full_name: user.full_name ?? '',
      // Arranca SIEMPRE vacío, nunca con el valor leído: `notes` no viene en la respuesta, así que
      // "el valor leído" no existe. Precargarlo con '' y reenviarlo borraría lo que hubiera.
      notes: '',
      gateway_role: isKnownGatewayRole(user.gateway_role) ? user.gateway_role : 'viewer',
      is_active: user.is_active,
    },
  })

  const nextRole = watch('gateway_role')
  const nextActive = watch('is_active')
  const editingSelf = currentUsername != null && currentUsername === user.username
  // Solo estos dos cambios tachan las sesiones de la persona (§2.5). Cambiar el correo o el
  // nombre no, y avisar ahí sería ruido que entrena a ignorar el aviso cuando importa.
  const invalidatesSessions = nextRole !== user.gateway_role || nextActive !== user.is_active

  const submit = (values: EditValues) => {
    setFormError(null)
    update.mutate(
      {
        email: values.email || undefined,
        full_name: values.full_name || undefined,
        // Solo se manda si el operador escribió algo AHORA. Mandarlo vacío perdería en silencio
        // lo que hubiera guardado, porque no hay forma de leerlo para comparar.
        notes: values.notes ? values.notes : undefined,
        gateway_role: values.gateway_role,
        is_active: values.is_active,
      },
      {
        onSuccess: onClose,
        onError: (error) => {
          const apiError = toApiError(error)
          setFormError(gatewayUserErrorMessage(apiError) ?? apiError.message)
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Editar ${user.username}`}
      description="Los accesos por entorno y por servidor se editan aparte, en «Accesos»."
      size="lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(submit)(event)}>
        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
          >
            {formError}
          </p>
        )}

        {/*
          El campo va deshabilitado CON el motivo, no escondido: ofrecerlo como editable y fallar
          después es peor que no ofrecerlo, y quitarlo sin explicación deja la pregunta abierta.
        */}
        <Input
          label="Nombre de usuario"
          value={user.username}
          disabled
          readOnly
          className="font-mono"
          hint="No se puede cambiar. Es la identidad que queda escrita en la auditoría, y el registro la guarda sin referencia: renombrarla reescribiría el significado de todas las filas viejas."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Correo"
            type="email"
            maxLength={GATEWAY_EMAIL_MAX}
            autoComplete="off"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Nombre completo"
            maxLength={GATEWAY_FULL_NAME_MAX}
            autoComplete="off"
            error={errors.full_name?.message}
            {...register('full_name')}
          />
        </div>

        <Controller
          control={control}
          name="gateway_role"
          render={({ field }) => (
            <Combobox<RoleOption>
              items={ROLE_OPTIONS}
              value={ROLE_OPTIONS.find((option) => option.value === field.value) ?? null}
              onChange={(option) => field.onChange(option?.value ?? 'viewer')}
              itemToString={(option) => option.label}
              itemToKey={(option) => option.value}
              label="Rol base"
              required
              error={errors.gateway_role?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Cuenta activa"
              hint="Desactivarla impide iniciar sesión y corta las sesiones abiertas. No borra nada."
            />
          )}
        />

        <Textarea
          label="Notas (solo escritura)"
          rows={2}
          hint="La API acepta notas pero no las devuelve, así que este campo empieza vacío a propósito: se envía solo si escribís algo ahora, y dejarlo vacío NO borra lo que hubiera."
          error={errors.notes?.message}
          {...register('notes')}
        />

        {invalidatesSessions && (
          <Callout
            tone={editingSelf ? 'danger' : 'warning'}
            title={
              editingSelf
                ? 'Te estás editando a vos mismo: vas a volver al login'
                : 'Esto cierra las sesiones abiertas de esta persona'
            }
          >
            {editingSelf
              ? 'Cambiar tu propio rol o desactivarte tacha tus sesiones. Vas a tener que iniciar sesión otra vez, y si te quitás permisos puede que ya no puedas volver acá.'
              : 'Cambiar el rol o el estado de la cuenta invalida sus sesiones: va a tener que iniciar sesión de nuevo.'}
          </Callout>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={update.isPending}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Modal>
  )
}
