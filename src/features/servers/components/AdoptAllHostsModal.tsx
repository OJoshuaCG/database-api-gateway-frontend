import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge, Button, Input, Modal, Textarea } from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import type { BatchAdoptStatus } from '@/lib/contracts'
import { useAdoptAllHosts } from '../hooks/use-engine-users'

interface AdoptAllHostsModalProps {
  onClose: () => void
  serverId: number
  username: string
  supportsHosts: boolean
}

interface FormValues {
  known_password: string
  notes: string
}

const schema = z.object({
  known_password: z.string(),
  notes: z.string(),
})

const RESULT_BADGE: Record<BatchAdoptStatus, { tone: BadgeTone; label: string }> = {
  adopted: { tone: 'success', label: 'Adoptada' },
  already_adopted: { tone: 'neutral', label: 'Ya adoptada' },
}

/**
 * `POST /users/adopt-all-hosts` (§7.4) — adopta TODAS las identidades en vivo de un username de
 * una sola llamada (nunca `CREATE USER`). Fail-tolerant: el modal no se cierra al terminar, sino
 * que pinta el desenlace por host desde `results[]` (`already_adopted` NO es error).
 */
export function AdoptAllHostsModal({
  onClose,
  serverId,
  username,
  supportsHosts,
}: AdoptAllHostsModalProps) {
  const adoptAll = useAdoptAllHosts(serverId)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { known_password: '', notes: '' },
  })

  const submit = handleSubmit((values) => {
    adoptAll.mutate({
      username,
      known_password: values.known_password.trim() ? values.known_password : undefined,
      notes: values.notes.trim() ? values.notes.trim() : null,
    })
  })

  const result = adoptAll.data

  return (
    <Modal
      open
      onClose={onClose}
      title="Adoptar todos los hosts"
      description={
        supportsHosts
          ? `Registra en el inventario todas las identidades en vivo de «${username}», sin ejecutar CREATE USER.`
          : `Registra en el inventario la identidad en vivo de «${username}», sin ejecutar CREATE USER.`
      }
      size="md"
    >
      {result ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-foreground">
            {result.adopted} de {result.total_hosts} identidad(es) adoptada(s) ahora
            {result.total_hosts - result.adopted > 0
              ? '; el resto ya estaba en el inventario.'
              : '.'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-1.5 font-semibold">Host</th>
                  <th className="px-3 py-1.5 font-semibold">Resultado</th>
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
                      <Badge tone={RESULT_BADGE[item.status].tone}>
                        {RESULT_BADGE[item.status].label}
                      </Badge>
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
          <Input
            label="Contraseña conocida (opcional)"
            type="password"
            autoComplete="new-password"
            hint="Si la indicas, se cifra y guarda en TODAS las identidades sin ejecutar ALTER USER — el motor no se toca y el gateway no verifica que sea la vigente."
            error={errors.known_password?.message}
            {...register('known_password')}
          />
          <Textarea label="Notas (opcional)" rows={2} {...register('notes')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={adoptAll.isPending}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={adoptAll.isPending}>
              {supportsHosts ? 'Adoptar todos los hosts 🔌' : 'Adoptar usuario 🔌'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
