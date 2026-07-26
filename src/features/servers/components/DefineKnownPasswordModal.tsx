import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge, Button, Combobox, Input, Modal, Switch } from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import type { DefinePasswordScope, KnownPasswordSetStatus } from '@/lib/contracts'
import { useDefineKnownPassword } from '../hooks/use-engine-users'

interface DefineKnownPasswordModalProps {
  onClose: () => void
  serverId: number
  username: string
  supportsHosts: boolean
  /** Hosts EN VIVO de este username (sin huérfanos), para el alcance "una identidad". */
  hostOptions: string[]
  /** Preselecciona alcance «una identidad» con este host (p. ej. tras adoptarla). */
  defaultHost?: string | null
}

interface FormValues {
  known_password: string
  adopt_if_missing: boolean
}

const schema = z.object({
  known_password: z.string().min(1, 'Requerido'),
  adopt_if_missing: z.boolean(),
})

const RESULT_BADGE: Record<KnownPasswordSetStatus, { tone: BadgeTone; label: string }> = {
  updated: { tone: 'success', label: 'Actualizada' },
  adopted: { tone: 'info', label: 'Adoptada' },
  skipped_not_found: { tone: 'neutral', label: 'Sin fila (omitida)' },
  conflict_needs_overwrite: { tone: 'warning', label: 'Ya tenía contraseña' },
}

/**
 * `POST /users/define-password` (§7.4) — flujo DEFINIR (≠ ROTAR): cifra y guarda una contraseña
 * que el admin YA conoce, sin tocar el motor (nunca `ALTER USER`). El desenlace se pinta por
 * host desde `results[]`; `conflict_needs_overwrite` NO es error — se ofrece reenviar con
 * `overwrite=true` si el admin confirma.
 */
export function DefineKnownPasswordModal({
  onClose,
  serverId,
  username,
  supportsHosts,
  hostOptions,
  defaultHost,
}: DefineKnownPasswordModalProps) {
  // En PostgreSQL no hay hosts: se fija `all_hosts` (opera sobre la única identidad, host null),
  // igual que el resto de operaciones batch — así no hay que serializar un `host` inexistente.
  const [scope, setScope] = useState<DefinePasswordScope>(
    supportsHosts && defaultHost ? 'host' : 'all_hosts',
  )
  const [host, setHost] = useState<string | null>(defaultHost ?? hostOptions[0] ?? null)
  const [hostSubmitAttempted, setHostSubmitAttempted] = useState(false)
  const define = useDefineKnownPassword(serverId)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { known_password: '', adopt_if_missing: false },
  })

  const submit = handleSubmit((values) => {
    if (supportsHosts && scope === 'host' && !host) {
      setHostSubmitAttempted(true)
      return
    }
    define.mutate({
      username,
      scope,
      host: supportsHosts && scope === 'host' ? (host ?? undefined) : undefined,
      known_password: values.known_password,
      adopt_if_missing: values.adopt_if_missing,
    })
  })

  const result = define.data
  const conflicts = result
    ? result.results.filter((item) => item.status === 'conflict_needs_overwrite')
    : []

  const resendWithOverwrite = () => {
    if (!define.variables) return
    define.mutate({ ...define.variables, overwrite: true })
  }

  const warningBox = (
    <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
      El gateway <strong>no verifica</strong> que esta contraseña sea la vigente en el motor: solo
      la cifra y la guarda, sin ejecutar <code>ALTER USER</code>. Si te equivocas, «Revelar
      contraseña» devolverá después un valor incorrecto sin que nadie lo detecte.
    </p>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title="Definir contraseña conocida"
      description={`Guarda cifrada la contraseña actual de «${username}» sin tocar el motor. Para cambiarla de verdad, usa «Rotar contraseña».`}
      size="md"
    >
      {result ? (
        <div className="flex flex-col gap-4">
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
          {conflicts.length > 0 ? (
            <>
              <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                {conflicts.length} identidad(es) ya tenían una contraseña guardada y no se tocaron.
                Sobrescribirlas reemplaza el valor guardado (el motor no se toca); hazlo solo si
                confirmas que esta es la contraseña correcta.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={define.isPending}>
                  Cerrar
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  isLoading={define.isPending}
                  onClick={resendWithOverwrite}
                >
                  Sobrescribir {conflicts.length} identidad(es)
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <Button type="button" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {supportsHosts && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Alcance</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={scope === 'host' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setScope('host')}
                >
                  Una identidad
                </Button>
                <Button
                  type="button"
                  variant={scope === 'all_hosts' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setScope('all_hosts')}
                >
                  Todos los hosts
                </Button>
              </div>
            </div>
          )}
          {supportsHosts && scope === 'host' && (
            <Combobox<string>
              items={hostOptions}
              value={host}
              onChange={(value) => {
                setHost(value)
                setHostSubmitAttempted(false)
              }}
              itemToString={(item) => item}
              itemToKey={(item) => item}
              label="Host"
              hint="«%» es un host real (literal), no un atajo de «todos los hosts»."
              required
              error={!host && hostSubmitAttempted ? 'Selecciona un host' : undefined}
            />
          )}
          <Input
            label="Contraseña conocida"
            type="password"
            autoComplete="new-password"
            required
            error={errors.known_password?.message}
            {...register('known_password')}
          />
          <Controller
            control={control}
            name="adopt_if_missing"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Adoptar identidades sin fila de inventario"
                hint="Crea la fila (adoptada) para los hosts en vivo que aún no estén en el inventario y les guarda esta contraseña."
              />
            )}
          />
          {warningBox}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={define.isPending}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={define.isPending}>
              Guardar contraseña
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
