import { useId, useState } from 'react'
import { AlertIcon, EyeIcon, EyeOffIcon, IconButton, Input, Spinner } from '@/components/ui'
import { type ConnectionMode, type EngineType } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { modeOptionsFor, supportsHost, type IdentityDraft } from '../logic'

/** Usuario del inventario ofrecido como sugerencia. `host` solo existe en MySQL/MariaDB. */
export interface StoredUserOption {
  username: string
  host?: string | null
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
 * execute. El usuario SÍ se conserva entre `stored` y `provided` porque pasar de uno a otro es
 * justo la ruta de recuperación cuando el usuario no está en el inventario, y volver a tipearlo
 * sería castigo gratuito. La contraseña nunca sobrevive a nada: se vuelve a pedir.
 */
function draftForMode(current: IdentityDraft, mode: ConnectionMode): IdentityDraft {
  const keepsUsername = mode === 'stored' || mode === 'provided'
  return {
    mode,
    username: keepsUsername ? current.username : '',
    host: mode === 'stored' ? current.host : '',
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
  const hostsListId = `${baseId}-hosts`
  const passwordId = `${baseId}-password`

  const options = modeOptionsFor(engine)
  const withHost = supportsHost(engine)

  // Un mismo usuario puede tener varias cuentas (una por host): en la lista de usuarios se
  // ofrece una sola vez, y los hosts se sugieren aparte según el usuario ya escrito.
  const usernames = [...new Set(storedUsers.map((user) => user.username))].sort((a, b) =>
    a.localeCompare(b),
  )
  const hostsForUser = [
    ...new Set(
      storedUsers
        .filter((user) => user.username === value.username.trim() && user.host)
        .map((user) => user.host as string),
    ),
  ].sort((a, b) => a.localeCompare(b))

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-2 text-sm font-medium text-foreground">
          Usuario del motor con el que ejecutar
        </legend>

        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const checked = value.mode === option.mode
            return (
              <label
                key={option.mode}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
                  checked
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-primary/10',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <input
                    type="radio"
                    name={`${baseId}-mode`}
                    className="accent-primary"
                    checked={checked}
                    onChange={() => onChange(draftForMode(value, option.mode))}
                  />
                  {option.label}
                </span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
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

        {(value.mode === 'stored' || value.mode === 'provided') && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            {/* Lista de sugerencias en vez de un `Combobox`: en `provided` el usuario que se
                quiere probar puede no estar en el inventario, así que el campo tiene que
                aceptar texto libre y el inventario ser solo un atajo. */}
            <Input
              label="Usuario del motor"
              value={value.username}
              onChange={(event) =>
                // En `provided`, cambiar el usuario vacía la contraseña: conservarla haría fácil
                // mandar la contraseña del usuario A intentando autenticar al B, y esa contraseña
                // quedaría escrita en el log de autenticación fallida de un motor ajeno.
                onChange(
                  value.mode === 'provided'
                    ? { ...value, username: event.target.value, password: '' }
                    : { ...value, username: event.target.value },
                )
              }
              list={usernames.length > 0 ? usersListId : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder="app_ro"
              required
              hint={
                value.mode === 'stored'
                  ? 'Se conecta con la contraseña que el gateway fijó al crear o rotar este usuario.'
                  : 'Puede ser cualquier usuario del motor, esté o no en el inventario del gateway.'
              }
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

            {value.mode === 'stored' && withHost && (
              <>
                <Input
                  label="Host de la cuenta"
                  value={value.host}
                  onChange={(event) => onChange({ ...value, host: event.target.value })}
                  list={hostsForUser.length > 0 ? hostsListId : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="%"
                  hint="En MySQL/MariaDB «app»@«localhost» y «app»@«%» son cuentas distintas, con permisos distintos. Si lo dejás vacío se usa «%»."
                />
                {hostsForUser.length > 0 && (
                  <datalist id={hostsListId}>
                    {hostsForUser.map((host) => (
                      <option key={host} value={host} />
                    ))}
                  </datalist>
                )}
              </>
            )}

            {value.mode === 'provided' && (
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
            )}
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
