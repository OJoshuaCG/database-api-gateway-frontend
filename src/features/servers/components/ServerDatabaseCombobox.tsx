import { Combobox, Input } from '@/components/ui'
import { useServerDatabases } from '../hooks/use-introspection'

interface ServerDatabaseComboboxProps {
  serverId: number
  value: string
  onChange: (database: string) => void
  label?: string
  hint?: string
  required?: boolean
}

/**
 * Elige UNA base de las que el servidor reporta en vivo 🔌.
 *
 * Nació al quitar los campos de texto libre de las pantallas de permisos: tecleando el nombre no
 * había forma de distinguir «este usuario no tiene permisos ahí» de «me equivoqué al escribir la
 * base», que en una auditoría de permisos son conclusiones opuestas.
 *
 * Si la introspección falla o el motor no devuelve bases, cae a captura manual: un servidor
 * inalcanzable no debe dejar la pantalla sin salida.
 */
export function ServerDatabaseCombobox({
  serverId,
  value,
  onChange,
  label = 'Base de datos',
  hint,
  required = false,
}: ServerDatabaseComboboxProps) {
  const databases = useServerDatabases(serverId, true)
  const options = databases.data ?? []

  if (databases.isLoading) {
    return (
      <Combobox<string>
        items={[]}
        value={null}
        onChange={() => {}}
        itemToString={(item) => item}
        itemToKey={(item) => item}
        label={label}
        placeholder="Cargando bases de datos…"
        isLoading
        required={required}
      />
    )
  }

  if (databases.isError || options.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Input
          label={label}
          hint={hint}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {databases.isError
            ? 'No se pudo consultar las bases del servidor; escribí el nombre a mano.'
            : 'El servidor no reportó bases de datos; escribí el nombre a mano.'}
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => void databases.refetch()}
          >
            Reintentar
          </button>
        </p>
      </div>
    )
  }

  return (
    <Combobox<string>
      items={options}
      value={value ? value : null}
      onChange={(database) => onChange(database ?? '')}
      itemToString={(item) => item}
      itemToKey={(item) => item}
      label={label}
      hint={hint}
      placeholder="Seleccioná una base de datos"
      clearable
      required={required}
    />
  )
}
