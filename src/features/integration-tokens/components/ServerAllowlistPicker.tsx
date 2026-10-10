import { MultiCombobox } from '@/components/ui'
import { useServers } from '@/features/servers/hooks/use-servers'
import { PAGINATION, type ServerOut } from '@/lib/contracts'

interface ServerAllowlistPickerProps {
  /** Ids de los servidores permitidos. */
  value: number[]
  onChange: (next: number[]) => void
}

/**
 * Servidores sobre los que el token puede operar. Es obligatorio siempre: un token sin servidores
 * no alcanza nada, y el servidor lo rechaza con 422 `server_allowlist_required`.
 *
 * La lista sale de `GET /servers`, que ya viene recortada por el alcance de quien emite: no se
 * ofrece un servidor que el usuario no puede ver. Un id guardado que ya no figura en esa lista
 * (servidor borrado o fuera de alcance) no se muestra y se descarta al tocar el selector.
 */
export function ServerAllowlistPicker({ value, onChange }: ServerAllowlistPickerProps) {
  const servers = useServers({ page: 1, size: PAGINATION.maxSize })
  const availableServers = servers.data?.items ?? []
  const selectedServers = availableServers.filter((server) => value.includes(server.id))

  return (
    <div className="flex flex-col gap-1">
      <MultiCombobox<ServerOut>
        items={availableServers}
        selectedItems={selectedServers}
        onChange={(next) => onChange(next.map((server) => server.id))}
        itemToString={(server) => server.name}
        itemToKey={(server) => server.id}
        label="Servidores permitidos"
        placeholder={servers.isPending ? 'Cargando servidores…' : 'Añadir servidor…'}
      />
      <p className="text-xs text-muted-foreground">
        Obligatorio: el token solo opera sobre estos servidores y sus bases.
      </p>
    </div>
  )
}
