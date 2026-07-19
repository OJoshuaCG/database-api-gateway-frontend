import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Combobox, Input, Modal, Switch, Textarea } from '@/components/ui'
import { HOST_PATTERN } from '@/lib/contracts'
import { useAddEngineUserHost } from '../hooks/use-engine-users'

interface AddEngineUserHostModalProps {
  onClose: () => void
  serverId: number
  username: string
  /** Hosts existentes de este username, para elegir la cuenta origen a clonar. */
  sourceHostOptions: string[]
  defaultSourceHost?: string
}

interface FormValues {
  new_host: string
  reuse_password: boolean
  new_password: string
  copy_grants: boolean
  adopt: boolean
  notes: string
}

const schema = z
  .object({
    new_host: z.string().min(1, 'Requerido').regex(HOST_PATTERN, 'Host inválido (`%` = wildcard)'),
    reuse_password: z.boolean(),
    new_password: z.string(),
    copy_grants: z.boolean(),
    adopt: z.boolean(),
    notes: z.string(),
  })
  .superRefine((values, ctx) => {
    if (!values.reuse_password && values.new_password.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['new_password'],
        message: 'Requerido si no reutilizas la contraseña.',
      })
    }
  })

/** `POST /users/add-host` 🔌 — clona una cuenta MySQL/MariaDB a un nuevo host. */
export function AddEngineUserHostModal({
  onClose,
  serverId,
  username,
  sourceHostOptions,
  defaultSourceHost,
}: AddEngineUserHostModalProps) {
  const [sourceHost, setSourceHost] = useState<string | null>(
    defaultSourceHost ?? sourceHostOptions[0] ?? null,
  )
  const [sourceSubmitAttempted, setSourceSubmitAttempted] = useState(false)
  const addHost = useAddEngineUserHost(serverId)
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      new_host: '',
      reuse_password: true,
      new_password: '',
      copy_grants: false,
      adopt: false,
      notes: '',
    },
  })

  const reusePassword = watch('reuse_password')
  const copyGrants = watch('copy_grants')

  const submit = handleSubmit((values) => {
    if (!sourceHost) {
      setSourceSubmitAttempted(true)
      return
    }
    addHost.mutate(
      {
        username,
        source_host: sourceHost,
        new_host: values.new_host.trim(),
        reuse_password: values.reuse_password,
        new_password: values.reuse_password ? null : values.new_password,
        copy_grants: values.copy_grants,
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
      title="Agregar host"
      description={`Clona la cuenta «${username}» a un nuevo host (solo MySQL/MariaDB) 🔌.`}
      size="md"
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Combobox<string>
          items={sourceHostOptions}
          value={sourceHost}
          onChange={(host) => {
            setSourceHost(host)
            setSourceSubmitAttempted(false)
          }}
          itemToString={(item) => item}
          itemToKey={(item) => item}
          label="Cuenta origen (host)"
          hint="La cuenta desde la que se clona la contraseña y, opcionalmente, los permisos."
          required
          error={!sourceHost && sourceSubmitAttempted ? 'Selecciona una cuenta origen' : undefined}
        />
        <Input
          label="Nuevo host"
          hint="«%» = cualquier host."
          required
          error={errors.new_host?.message}
          {...register('new_host')}
        />
        <Controller
          control={control}
          name="reuse_password"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Reutilizar la contraseña de la cuenta origen"
              hint="Copia el hash del motor (SHOW CREATE USER); el gateway nunca ve la contraseña en claro."
            />
          )}
        />
        {!reusePassword && (
          <Input
            label="Nueva contraseña"
            type="password"
            autoComplete="new-password"
            required
            error={errors.new_password?.message}
            {...register('new_password')}
          />
        )}
        <Controller
          control={control}
          name="copy_grants"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Copiar permisos de la cuenta origen"
              hint="Best-effort: un fallo no revierte la creación del host. Replica fielmente privilegios globales y WITH GRANT OPTION — evalúa el riesgo de sobre-aprovisionamiento."
            />
          )}
        />
        {copyGrants && (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            Se replicarán privilegios globales (p. ej. <code>ALL ON *.*</code>, <code>SUPER</code>)
            y <code>WITH GRANT OPTION</code> tal como los tenga la cuenta origen.
          </p>
        )}
        <Controller
          control={control}
          name="adopt"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Adoptar el nuevo host en el inventario"
            />
          )}
        />
        <Textarea label="Notas (opcional)" rows={2} {...register('notes')} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={addHost.isPending}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={addHost.isPending} disabled={!sourceHost}>
            Agregar host 🔌
          </Button>
        </div>
      </form>
    </Modal>
  )
}
