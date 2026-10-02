import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Input, Modal } from '@/components/ui'
import { readonlyCredentialInSchema, type ReadonlyCredentialIn } from '@/lib/contracts'
import { useSetReadonlyCredential } from '../hooks/use-server-mutations'

interface ReadonlyCredentialModalProps {
  open: boolean
  onClose: () => void
  serverId: number
  /** Ya había una credencial: el alta la reemplaza y borra su verificación. */
  replacing: boolean
}

/**
 * `PUT /servers/{id}/readonly-credential` (v30) — alta o reemplazo de la credencial de solo
 * lectura del MCP.
 *
 * La contraseña no sale de este formulario: el backend nunca la devuelve, y al terminar se limpia
 * el campo y se resetea la mutación, que es donde TanStack guarda las `variables` (el hook ya usa
 * `gcTime: 0`). Los `autoComplete` evitan que el navegador ofrezca la contraseña del gateway o la
 * guarde como si lo fuera.
 */
export function ReadonlyCredentialModal({
  open,
  onClose,
  serverId,
  replacing,
}: ReadonlyCredentialModalProps) {
  const save = useSetReadonlyCredential(serverId)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ReadonlyCredentialIn>({
    resolver: zodResolver(readonlyCredentialInSchema),
    defaultValues: { username: '', password: '' },
  })

  const close = () => {
    if (save.isPending) return
    reset()
    save.reset()
    onClose()
  }

  const submit = handleSubmit((values) => {
    save.mutate(values, {
      onSuccess: () => {
        reset()
        save.reset()
        onClose()
      },
    })
  })

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        replacing ? 'Reemplazar credencial de solo lectura' : 'Cargar credencial de solo lectura'
      }
      description="La cuenta del motor con la que el servidor MCP lee el catálogo. Nunca se usa la del administrador."
      size="md"
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Tiene que ser una cuenta <strong>de solo lectura</strong>, creada por el DBA. Después de
          guardarla hay que verificarla: la sonda comprueba en el motor que no pueda escribir, y
          hasta que pase el MCP no la usa.
          {replacing && ' Reemplazarla borra la verificación anterior.'}
        </p>
        <Input
          label="Usuario"
          required
          autoComplete="off"
          spellCheck={false}
          error={errors.username?.message}
          {...register('username')}
        />
        <Input
          label="Contraseña"
          type="password"
          required
          autoComplete="new-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  )
}
