import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge, Button, Input, Modal, Switch } from '@/components/ui'
import { useChangeEngineUserPasswordAllHosts } from '../hooks/use-engine-users'

interface RotatePasswordAllHostsModalProps {
  onClose: () => void
  serverId: number
  username: string
}

interface FormValues {
  new_password: string
  confirm_username: string
  adopt_if_missing: boolean
}

function buildSchema(username: string) {
  return z.object({
    new_password: z.string().min(1, 'Requerido'),
    confirm_username: z
      .string()
      .refine((value) => value === username, `Debe coincidir exactamente con «${username}»`),
    adopt_if_missing: z.boolean(),
  })
}

/**
 * `PATCH /users/password-all-hosts` (§7.4) — `ALTER USER/ROLE` REAL en TODOS los hosts en vivo.
 * Exige reescribir el username exacto (doble intención, patrón `confirmWord`). Fail-tolerant:
 * el desenlace SIEMPRE se pinta por host — un host con `status='error'` conserva la contraseña
 * ANTERIOR en el motor, así que jamás se muestra un "contraseña cambiada" genérico.
 */
export function RotatePasswordAllHostsModal({
  onClose,
  serverId,
  username,
}: RotatePasswordAllHostsModalProps) {
  const rotateAll = useChangeEngineUserPasswordAllHosts(serverId)
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(buildSchema(username)),
    defaultValues: { new_password: '', confirm_username: '', adopt_if_missing: false },
  })

  const confirmMatches = watch('confirm_username') === username

  const submit = handleSubmit((values) => {
    rotateAll.mutate({
      username,
      new_password: values.new_password,
      confirm_username: values.confirm_username,
      adopt_if_missing: values.adopt_if_missing,
    })
  })

  const result = rotateAll.data
  const failed = result ? result.results.filter((item) => item.status === 'error') : []

  return (
    <Modal
      open
      onClose={onClose}
      title="Rotar contraseña en todos los hosts"
      description={`Ejecuta ALTER USER/ROLE en todas las identidades en vivo de «${username}» 🔌.`}
      size="md"
    >
      {result ? (
        <div className="flex flex-col gap-4">
          {failed.length > 0 ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              {failed.length} de {result.total_hosts} host(s) fallaron y{' '}
              <strong>conservan la contraseña anterior</strong> en el motor. Reintenta o rota esas
              identidades individualmente.
            </p>
          ) : (
            <p className="text-sm text-foreground">
              Contraseña rotada en los {result.total_hosts} host(s).
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-1.5 font-semibold">Host</th>
                  <th className="px-3 py-1.5 font-semibold">Resultado</th>
                  <th className="px-3 py-1.5 font-semibold">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((item) => (
                  <tr
                    key={item.host ?? '(sin host)'}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-1.5 font-mono text-xs text-foreground">
                      {item.host ?? '—'}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={item.status === 'rotated' ? 'success' : 'error'}>
                        {item.status === 'rotated' ? 'Rotada' : 'Error'}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {item.status === 'error' ? (
                        <span className="text-error">{item.error ?? 'Error desconocido'}</span>
                      ) : item.adopted ? (
                        <span className="text-muted-foreground">Adoptada al rotar</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            Cambia la contraseña <strong>real</strong> en el motor: las aplicaciones que sigan
            usando la anterior perderán acceso. Para guardar una contraseña ya vigente sin
            cambiarla, usa «Definir contraseña conocida».
          </p>
          <Input
            label="Nueva contraseña"
            type="password"
            autoComplete="new-password"
            required
            error={errors.new_password?.message}
            {...register('new_password')}
          />
          <Input
            label={`Escribe «${username}» para confirmar`}
            autoComplete="off"
            required
            error={errors.confirm_username?.message}
            {...register('confirm_username')}
          />
          <Controller
            control={control}
            name="adopt_if_missing"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Adoptar identidades sin fila de inventario"
                hint="Los hosts rotados que no estén en el inventario se registran con la nueva contraseña cifrada."
              />
            )}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={rotateAll.isPending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="danger"
              isLoading={rotateAll.isPending}
              disabled={!confirmMatches}
            >
              Rotar en todos los hosts 🔌
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
