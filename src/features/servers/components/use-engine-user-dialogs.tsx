import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EngineUserIdentity, GroupedEngineUser, ServerUserOut } from '@/lib/contracts'
import { serverUserPath } from '@/lib/routes'
import { AdoptUserModal } from '@/features/server-users/components/AdoptUserModal'
import { DeleteServerUserDialog } from '@/features/server-users/components/DeleteServerUserDialog'
import { ServerUserFormModal } from '@/features/server-users/components/ServerUserFormModal'
import { useDeleteServerUser } from '@/features/server-users/hooks/use-server-user-mutations'
import { CreateEngineUserModal } from './CreateEngineUserModal'
import { ChangeEngineUserPasswordModal } from './ChangeEngineUserPasswordModal'
import { DeleteEngineUserDialog } from './DeleteEngineUserDialog'
import { AddEngineUserHostModal } from './AddEngineUserHostModal'
import { RevealEngineUserPasswordModal } from './RevealEngineUserPasswordModal'
import { AdoptAllHostsModal } from './AdoptAllHostsModal'
import { DefineKnownPasswordModal } from './DefineKnownPasswordModal'
import { RotatePasswordAllHostsModal } from './RotatePasswordAllHostsModal'
import { liveHostsOf, type IdentityAction, type UsernameActionId } from './engine-user-actions'

/**
 * El diálogo abierto, si hay uno. Un solo estado y no uno por modal: nunca hay dos abiertos a la
 * vez, y así encadenar («Adoptar» → «Definir contraseña») es reemplazar uno por otro.
 */
type ActiveDialog =
  | { kind: 'create'; prefill?: { username: string; host?: string } }
  | { kind: 'password'; username: string; host?: string; alreadyAdopted: boolean }
  | { kind: 'drop' | 'reveal' | 'adopt'; username: string; host?: string }
  | { kind: 'addHost' | 'adoptAll' | 'rotateAll'; username: string }
  | { kind: 'define'; username: string; defaultHost?: string }
  | { kind: 'edit' | 'removeFromInventory'; record: ServerUserOut }

interface UseEngineUserDialogsOptions {
  serverId: number
  serverName?: string
  supportsHosts: boolean
  /** Usuarios agrupados conocidos por la vista: de ahí salen los hosts vivos de cada username. */
  users: GroupedEngineUser[]
}

/**
 * Ejecuta las acciones de `engine-user-actions` y aloja sus diálogos. Lo usan la tabla del
 * servidor y la ficha del usuario, así que una acción nueva se conecta aquí UNA vez y aparece en
 * las dos (R1). Antes cada vista montaba sus nueve modales a mano, con su propia copia de la
 * limpieza de huérfanos y del cálculo de hosts vivos.
 *
 * `record` es el registro del inventario: solo lo tiene la ficha, y solo lo necesitan las
 * acciones marcadas con `needsRecord`.
 */
export function useEngineUserDialogs({
  serverId,
  serverName,
  supportsHosts,
  users,
}: UseEngineUserDialogsOptions) {
  const navigate = useNavigate()
  const [active, setActive] = useState<ActiveDialog | null>(null)
  const [cleanupId, setCleanupId] = useState<number | null>(null)
  const deleteServerUser = useDeleteServerUser()
  const close = () => setActive(null)

  const hostOptionsOf = (username: string): string[] => {
    const user = users.find((candidate) => candidate.username === username)
    return user ? liveHostsOf(user) : []
  }

  /**
   * Quita del inventario una identidad huérfana, sin diálogo: ya no existe en el motor, así que
   * no hay nada físico que perder ni `DROP` que ofrecer. La invalidación de la vista agrupada la
   * hace la propia mutación.
   */
  const removeOrphan = (serverUserId: number) => {
    setCleanupId(serverUserId)
    deleteServerUser.mutate(
      { id: serverUserId, serverId, dropRemote: false },
      { onSettled: () => setCleanupId(null) },
    )
  }

  const runIdentityAction = (
    action: IdentityAction,
    username: string,
    identity: EngineUserIdentity,
    record?: ServerUserOut,
  ) => {
    const host = identity.host ?? undefined
    switch (action.id) {
      case 'viewGrants':
        void navigate(serverUserPath(serverId, username, host, 'grants'))
        return
      case 'adopt':
        setActive({ kind: 'adopt', username, host })
        return
      case 'reveal':
        setActive({ kind: 'reveal', username, host })
        return
      case 'rotatePassword':
        setActive({
          kind: 'password',
          username,
          host,
          alreadyAdopted: identity.status === 'adopted',
        })
        return
      case 'dropFromEngine':
        setActive({ kind: 'drop', username, host })
        return
      case 'recreate':
        setActive({ kind: 'create', prefill: { username, host } })
        return
      case 'edit':
        if (record) setActive({ kind: 'edit', record })
        return
      case 'removeFromInventory':
        if (action.needsRecord) {
          if (record) setActive({ kind: 'removeFromInventory', record })
        } else if (identity.server_user_id != null) {
          removeOrphan(identity.server_user_id)
        }
        return
    }
  }

  /** `currentHost`: la identidad que se está mirando, si hay una — preselecciona su alcance. */
  const runUsernameAction = (id: UsernameActionId, username: string, currentHost?: string) => {
    switch (id) {
      case 'addHost':
        setActive({ kind: 'addHost', username })
        return
      case 'adoptAllHosts':
        setActive({ kind: 'adoptAll', username })
        return
      case 'definePassword':
        setActive({ kind: 'define', username, defaultHost: currentHost })
        return
      case 'rotateAllHosts':
        setActive({ kind: 'rotateAll', username })
        return
    }
  }

  const openCreate = () => setActive({ kind: 'create' })

  /** Id de inventario de la huérfana que se está quitando, para el spinner de su botón. */
  const isRemovingOrphan = (identity: EngineUserIdentity) =>
    identity.server_user_id != null && cleanupId === identity.server_user_id

  let dialogs: ReactNode = null
  if (active) {
    switch (active.kind) {
      case 'create':
        dialogs = (
          <CreateEngineUserModal
            onClose={close}
            serverId={serverId}
            supportsHosts={supportsHosts}
            prefill={active.prefill}
          />
        )
        break
      case 'password':
        dialogs = (
          <ChangeEngineUserPasswordModal
            onClose={close}
            serverId={serverId}
            username={active.username}
            host={active.host}
            alreadyAdopted={active.alreadyAdopted}
          />
        )
        break
      case 'drop':
        dialogs = (
          <DeleteEngineUserDialog
            onClose={close}
            serverId={serverId}
            username={active.username}
            host={active.host}
          />
        )
        break
      case 'reveal':
        dialogs = (
          <RevealEngineUserPasswordModal
            onClose={close}
            serverId={serverId}
            username={active.username}
            host={active.host}
          />
        )
        break
      case 'adopt': {
        const { username, host } = active
        dialogs = (
          <AdoptUserModal
            open
            onClose={close}
            serverId={serverId}
            username={username}
            host={host}
            // La identidad nace sin contraseña: encadena con «Definir contraseña conocida».
            onDefinePassword={() => setActive({ kind: 'define', username, defaultHost: host })}
          />
        )
        break
      }
      case 'addHost': {
        const liveHosts = hostOptionsOf(active.username)
        dialogs = (
          <AddEngineUserHostModal
            onClose={close}
            serverId={serverId}
            username={active.username}
            sourceHostOptions={liveHosts}
            defaultSourceHost={liveHosts[0]}
          />
        )
        break
      }
      case 'adoptAll':
        dialogs = (
          <AdoptAllHostsModal
            onClose={close}
            serverId={serverId}
            username={active.username}
            supportsHosts={supportsHosts}
          />
        )
        break
      case 'define':
        dialogs = (
          <DefineKnownPasswordModal
            onClose={close}
            serverId={serverId}
            username={active.username}
            supportsHosts={supportsHosts}
            hostOptions={hostOptionsOf(active.username)}
            defaultHost={active.defaultHost}
          />
        )
        break
      case 'rotateAll':
        dialogs = (
          <RotatePasswordAllHostsModal
            onClose={close}
            serverId={serverId}
            username={active.username}
          />
        )
        break
      case 'edit':
        dialogs = (
          <ServerUserFormModal open onClose={close} user={active.record} serverName={serverName} />
        )
        break
      case 'removeFromInventory':
        dialogs = <DeleteServerUserDialog user={active.record} onClose={close} />
        break
    }
  }

  return { runIdentityAction, runUsernameAction, openCreate, isRemovingOrphan, dialogs }
}
