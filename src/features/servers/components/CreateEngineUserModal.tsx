import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Input, Modal, Switch, Textarea } from '@/components/ui'
import { HOST_PATTERN, IDENTIFIER_PATTERN } from '@/lib/contracts'
import { useCreateEngineUser } from '../hooks/use-engine-users'

interface CreateEngineUserModalProps {
  onClose: () => void
  serverId: number
  supportsHosts: boolean
  /** Precarga usada al "recrear en el motor" un usuario `orphan` (existe en inventario, no en el motor). */
  prefill?: { username: string; host?: string | null }
}

interface FormValues {
  username: string
  host: string
  password: string
  adopt: boolean
  notes: string
}

const schema = z.object({
  username: z
    .string()
    .min(1, 'Requerido')
    .regex(IDENTIFIER_PATTERN, 'Letra/_ inicial, hasta 63 caracteres alfanuméricos o _'),
  host: z.union([z.string().regex(HOST_PATTERN, 'Host inválido'), z.literal('')]),
  password: z.string().min(1, 'Requerido'),
  adopt: z.boolean(),
  notes: z.string(),
})

/** `CREATE USER` 🔌 por identidad física — funciona esté o no adoptado el resultado. */
export function CreateEngineUserModal({
  onClose,
  serverId,
  supportsHosts,
  prefill,
}: CreateEngineUserModalProps) {
  const create = useCreateEngineUser(serverId)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: prefill?.username ?? '',
      host: prefill?.host ?? '%',
      password: '',
      adopt: false,
      notes: '',
    },
  })

  const submit = handleSubmit((values) => {
    create.mutate(
      {
        username: values.username.trim(),
        host: supportsHosts && values.host.trim() ? values.host.trim() : undefined,
        password: values.password,
        adopt: values.adopt,
        notes: values.notes.trim() ? values.notes.trim() : null,
      },
      { onSuccess: onClose },
    )
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={prefill ? 'Recrear usuario en el motor' : 'Crear usuario en el motor'}
      description={
        prefill
          ? 'La fila de inventario ya existe (drift); esto ejecuta CREATE USER para que vuelva a existir en el motor 🔌.'
          : 'Ejecuta CREATE USER directamente en el servidor destino 🔌.'
      }
      size="md"
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className={supportsHosts ? 'grid gap-4 sm:grid-cols-2' : undefined}>
          <Input
            label="Usuario"
            required
            readOnly={Boolean(prefill)}
            error={errors.username?.message}
            {...register('username')}
          />
          {supportsHosts && (
            <Input
              label="Host"
              hint="«%» = cualquier host."
              readOnly={Boolean(prefill)}
              error={errors.host?.message}
              {...register('host')}
            />
          )}
        </div>
        <Input
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          required
          error={errors.password?.message}
          {...register('password')}
        />
        {prefill ? (
          <p className="text-xs text-muted-foreground">
            Ya existe una fila de inventario para esta identidad (por eso aparecía «huérfana»); no
            hace falta volver a adoptarla.
          </p>
        ) : (
          <Controller
            control={control}
            name="adopt"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Adoptar en el inventario"
                hint="Registra la identidad en server_users y cifra la contraseña (podrás revelarla luego)."
              />
            )}
          />
        )}
        <Textarea label="Notas (opcional)" rows={2} {...register('notes')} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={create.isPending}>
            {prefill ? 'Recrear usuario 🔌' : 'Crear usuario 🔌'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
