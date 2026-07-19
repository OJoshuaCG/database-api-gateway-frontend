import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Input, Modal, Switch } from '@/components/ui'
import { useChangeEngineUserPassword } from '../hooks/use-engine-users'

interface ChangeEngineUserPasswordModalProps {
  onClose: () => void
  serverId: number
  username: string
  host?: string | null
  /** Si ya hay fila de inventario, la contraseña siempre se sincroniza y `adopt` no aplica. */
  alreadyAdopted: boolean
}

interface FormValues {
  new_password: string
  adopt: boolean
}

const schema = z.object({
  new_password: z.string().min(1, 'Requerido'),
  adopt: z.boolean(),
})

/** `ALTER USER/ROLE` 🔌 por identidad física. */
export function ChangeEngineUserPasswordModal({
  onClose,
  serverId,
  username,
  host,
  alreadyAdopted,
}: ChangeEngineUserPasswordModalProps) {
  const changePassword = useChangeEngineUserPassword(serverId)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: '', adopt: false },
  })

  const submit = handleSubmit((values) => {
    changePassword.mutate(
      {
        username,
        host: host ?? undefined,
        new_password: values.new_password,
        adopt: values.adopt,
      },
      { onSuccess: onClose },
    )
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Cambiar contraseña"
      description={`${username}${host ? `@${host}` : ''}`}
      size="sm"
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          required
          error={errors.new_password?.message}
          {...register('new_password')}
        />
        {!alreadyAdopted && (
          <Controller
            control={control}
            name="adopt"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Adoptar en el inventario"
                hint="Registra la identidad en server_users con esta contraseña cifrada."
              />
            )}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={changePassword.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" isLoading={changePassword.isPending}>
            Cambiar contraseña 🔌
          </Button>
        </div>
      </form>
    </Modal>
  )
}
