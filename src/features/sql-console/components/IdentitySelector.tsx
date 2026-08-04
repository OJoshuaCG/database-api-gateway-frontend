import { useId, useState } from 'react'
import {
  AlertIcon,
  Combobox,
  EyeIcon,
  EyeOffIcon,
  IconButton,
  Input,
  Spinner,
} from '@/components/ui'
import { type ConnectionMode, type EngineType } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { modeOptionsFor, supportsHost, type IdentityDraft } from '../logic'

/**
 * Identidad del inventario del gateway. Es una cuenta concreta, no un nombre: en MySQL/MariaDB
 * `app@localhost` y `app@%` son cuentas SEPARADAS, con contraseñas y privilegios distintos.
 */
export interface StoredUserOption {
  username: string
  /** `null` en PostgreSQL, donde los roles no tienen host. */
  host?: string | null
  /**
   * El gateway fijó su contraseña (la cifró al crearla o rotarla). Si es `false`, el usuario
   * fue *adoptado* y el motor solo guarda un hash irreversible: el modo `stored` responde 409.
   */
  hasPassword: boolean
}

export interface IdentitySelectorProps {
  value: IdentityDraft
  onChange: (next: IdentityDraft) => void
  engine: EngineType | null
  /** Mensaje de `validateIdentity`, o `null` si el borrador está completo. */
  error: string | null
  disabled?: boolean
  storedUsers: StoredUserOption[]
  storedUsersLoading?: boolean
}

/**
 * Al cambiar de modo se limpian los campos que ese modo no usa.
 *
 * No es cosmético: el `confirm_token` se ata a `(hash del SQL, mode, username, role, host)`, así
 * que un `host` que sobrevive a un cambio de modo invalidaría el token entre el preview y el
 * execute.
 *
 * El usuario se conserva al pasar a `provided` porque ese es justo el camino de recuperación
 * cuando el inventario no sirve (404/409), y volver a tipearlo sería castigo gratuito. Al
 * entrar en `stored`, en cambio, se limpia: ahí la identidad se elige de una lista de cuentas
 * reales del inventario, y arrastrar un nombre suelto sin su host dejaría apuntando a una
 * cuenta distinta de la que el admin cree. La contraseña nunca sobrevive a nada.
 */
function draftForMode(current: IdentityDraft, mode: ConnectionMode): IdentityDraft {
  return {
    mode,
    username: mode === 'provided' ? current.username : '',
    host: '',
    password: mode === 'provided' ? current.password : '',
    role: mode === 'impersonate' ? current.role : '',
  }
}

/**
 * Elección de la identidad del motor con la que se ejecuta el SQL. Es la pieza central del
 * módulo: la consola no existe para correr consultas, sino para verificar qué puede hacer un
 * usuario concreto, y esa elección *es* la funcionalidad.
 *
 * Arranca deliberadamente sin nada elegido aunque el schema del backend use `admin` por
 * defecto: preseleccionar la credencial pseudo-root invitaría al error exacto que el módulo
 * existe para evitar. Los modos se presentan como tarjetas con su explicación, y no como un
 * `select`, porque la diferencia entre ellos no se adivina desde la etiqueta.
 */
export function IdentitySelector({
  value,
  onChange,
  engine,
  error,
  disabled,
  storedUsers,
  storedUsersLoading,
}: IdentitySelectorProps) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  const baseId = useId()
  const usersListId = `${baseId}-usuarios`
  const passwordId = `${baseId}-password`

  const options = modeOptionsFor(engine)
  const withHost = supportsHost(engine)

  /** Etiqueta de una cuenta: en MySQL/MariaDB el host forma parte de su identidad. */
  const identityOf = (user: StoredUserOption): string =>
    withHost ? `${user.username}@${user.host ?? '%'}` : user.username

  /**
   * Solo se ofrecen las cuentas cuya contraseña fijó el gateway: para el resto el modo
   * `stored` responde 409 sin remedio, así que listarlas sería ofrecer un callejón sin salida.
   * Se cuenta cuántas quedaron fuera para poder explicarlo y empujar a `provided`.
   */
  const usableStoredUsers = storedUsers.filter((user) => user.hasPassword)
  const excludedStoredUsers = storedUsers.length - usableStoredUsers.length

  const selectedStoredUser =
    usableStoredUsers.find(
      (user) =>
        user.username === value.username && (!withHost || (user.host ?? '%') === value.host),
    ) ?? null

  // En `provided` el usuario puede no estar en el inventario, así que el campo acepta texto
  // libre y el inventario es solo un atajo: ahí sí sirve una lista de sugerencias por nombre.
  const usernames = [...new Set(storedUsers.map((user) => user.username))].sort((a, b) =>
    a.localeCompare(b),
  )

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-2 text-sm font-medium text-foreground">
          Usuario del motor con el que ejecutar
        </legend>

        {/* Una columna por modo a partir de `sm`: son 3 (o 4 en PostgreSQL, que añade el rol
            adoptado) y entran en una fila. Tarjetas angostas y altas en vez de anchas y bajas:
            el `hint` es lo que hace elegible la opción, así que necesita alto, no ancho. */}
        <div
          className={cn(
            'grid gap-2',
            options.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3',
          )}
        >
          {options.map((option) => {
            const checked = value.mode === option.mode
            return (
              <label
                key={option.mode}
                className={cn(
                  'flex h-full min-h-28 cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-sm transition-colors',
                  checked
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-primary/10',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="flex items-start gap-2 font-medium text-foreground">
                  <input
                    type="radio"
                    name={`${baseId}-mode`}
                    className="mt-0.5 shrink-0 accent-primary"
                    checked={checked}
                    onChange={() => onChange(draftForMode(value, option.mode))}
                  />
                  <span className="min-w-0">{option.label}</span>
                </span>
                <span className="text-xs leading-snug text-muted-foreground">{option.hint}</span>
              </label>
            )
          })}
        </div>

        {value.mode === null && (
          <p className="text-xs text-muted-foreground">
            Ninguna opción viene marcada a propósito: elegir con qué usuario se ejecuta es la
            pregunta que responde esta consola, y una respuesta por defecto sería la respuesta
            equivocada.
          </p>
        )}

        {value.mode === 'stored' && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            {/* Aquí la identidad se ELIGE, no se escribe: por definición tiene que ser una
                cuenta del inventario con contraseña guardada, así que un campo libre solo
                podía producir 404 y 409. El host viene con la cuenta, que es lo que evita
                apuntar a `app@%` creyendo que es `app@localhost`. */}
            <Combobox<StoredUserOption>
              label="Cuenta del inventario"
              items={usableStoredUsers}
              value={selectedStoredUser}
              onChange={(next) =>
                onChange({
                  ...value,
                  username: next?.username ?? '',
                  host: next ? (next.host ?? (withHost ? '%' : '')) : '',
                })
              }
              itemToString={identityOf}
              itemToKey={identityOf}
              placeholder="Elegí una cuenta"
              isLoading={storedUsersLoading}
              clearable
              required
              hint={
                withHost
                  ? 'Se conecta con la contraseña que el gateway fijó para esa cuenta. El host forma parte de la identidad: «app»@«localhost» y «app»@«%» son cuentas distintas.'
                  : 'Se conecta con la contraseña que el gateway fijó para ese rol.'
              }
            />

            {!storedUsersLoading && usableStoredUsers.length === 0 && (
              <p className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs text-foreground">
                {storedUsers.length === 0
                  ? 'Este servidor no tiene usuarios en el inventario del gateway. Usá «Usuario con contraseña» para probar cualquier usuario del motor.'
                  : 'Ninguna de las cuentas del inventario de este servidor tiene contraseña guardada: fueron adoptadas, y el motor solo conserva un hash irreversible. Usá «Usuario con contraseña».'}
              </p>
            )}

            {excludedStoredUsers > 0 && usableStoredUsers.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {excludedStoredUsers === 1
                  ? 'Se omitió 1 cuenta del inventario sin contraseña guardada (fue adoptada).'
                  : `Se omitieron ${excludedStoredUsers} cuentas del inventario sin contraseña guardada (fueron adoptadas).`}{' '}
                Para esas, usá «Usuario con contraseña».
              </p>
            )}
          </div>
        )}

        {value.mode === 'provided' && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            {/* Acá sí texto libre con sugerencias: el caso más común es probar un usuario que
                el gateway no administra, así que el inventario es un atajo, no un límite. */}
            <Input
              label="Usuario del motor"
              value={value.username}
              onChange={(event) =>
                // Cambiar el usuario vacía la contraseña: conservarla haría fácil mandar la
                // contraseña del usuario A intentando autenticar al B, y esa contraseña quedaría
                // escrita en el log de autenticación fallida de un motor ajeno.
                onChange({ ...value, username: event.target.value, password: '' })
              }
              list={usernames.length > 0 ? usersListId : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder="app_ro"
              required
              hint="Puede ser cualquier usuario del motor, esté o no en el inventario del gateway."
            />
            {usernames.length > 0 && (
              <datalist id={usersListId}>
                {usernames.map((username) => (
                  <option key={username} value={username} />
                ))}
              </datalist>
            )}
            {storedUsersLoading && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="h-3 w-3" /> Cargando los usuarios del inventario…
              </p>
            )}

            {/* No hay campo de host en `provided`: el backend solo lo usa en `stored`, donde
                ahora llega con la cuenta elegida. Pedirlo acá insinuaría que sirve para algo. */}
            <div className="flex flex-col gap-1.5">
              {/* La etiqueta se escribe a mano (y no con la prop `label` del `Input`) para
                    poder poner el botón de mostrar/ocultar en la misma línea. */}
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={passwordId} className="text-sm font-medium text-foreground">
                  Contraseña
                  <span className="ml-0.5 text-error">*</span>
                </label>
                <IconButton
                  label={passwordVisible ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                  icon={passwordVisible ? <EyeOffIcon /> : <EyeIcon />}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                />
              </div>
              <Input
                id={passwordId}
                type={passwordVisible ? 'text' : 'password'}
                value={value.password}
                onChange={(event) => onChange({ ...value, password: event.target.value })}
                // `autoComplete="off"` no sirve acá: los navegadores lo ignoran a propósito en
                // campos de contraseña. Lo que de verdad suprime el gestor es `new-password`,
                // y los atributos `data-*` hacen lo propio con 1Password y LastPass. Sin esto,
                // el hint de abajo («ni en este navegador») sería mentira.
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                // El ojo convierte el campo en `type="text"`, donde el corrector sí actúa.
                spellCheck={false}
                placeholder="••••••••"
                hint="No se guarda en ningún lado — ni en el gateway, ni en el historial, ni en este navegador."
              />
            </div>
          </div>
        )}

        {value.mode === 'impersonate' && (
          <div className="rounded-lg border border-border p-3">
            <Input
              label="Rol a adoptar"
              value={value.role}
              onChange={(event) => onChange({ ...value, role: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              placeholder="reportes_ro"
              required
              hint="Solo PostgreSQL: la sesión hace SET ROLE y reproduce los permisos del rol. Es una herramienta de prueba, no una frontera de seguridad."
            />
          </div>
        )}

        {value.mode === 'admin' && (
          <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 p-3 text-sm text-error">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0">
              Con la credencial pseudo-root los permisos no se prueban: se evitan. La consulta va a
              funcionar aunque el usuario que te interesa no tenga ningún acceso, así que lo que
              veas no dice nada sobre él.
            </p>
          </div>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  )
}
