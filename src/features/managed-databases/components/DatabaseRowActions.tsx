import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  CloneIcon,
  CompareIcon,
  ListRemoveIcon,
  PencilIcon,
  RowActionButton,
  TrashIcon,
  type ButtonVariant,
} from '@/components/ui'
import { useCapabilities } from '@/features/auth'
import { cn } from '@/lib/utils'
import { CAPABILITIES, type ManagedDatabaseOut, type ServerOut } from '@/lib/contracts'
import { serverDatabasePath } from '@/lib/routes'
import { DropDatabaseDialog } from '@/features/server-databases/components/DropDatabaseDialog'
import {
  allowsEngineDropOnRemove,
  DATABASE_ACTION_LABELS,
  DESTRUCTIVE_ACTIONS,
  DETAIL_TAB_ACTIONS,
  DOMAIN_ACTIONS,
  getDatabaseActions,
  type DatabaseActionId,
  type DatabaseActionSurface,
  type DatabaseState,
} from '../database-actions'
import { AdoptDatabaseModal } from './AdoptDatabaseModal'
import { DeleteManagedDatabaseDialog } from './DeleteManagedDatabaseDialog'
import { ManagedDatabaseFormModal } from './ManagedDatabaseFormModal'
import { ProvisionDatabaseDialog } from './ProvisionDatabaseDialog'
import { ReassignOwnerModal } from './ReassignOwnerModal'

/**
 * Acciones de una base de datos: las filas de los listados y la cabecera de su ficha.
 *
 * **Las reglas** (el porqué completo está en `database-actions.ts`, que es donde se deciden):
 *
 * - **R1. La ficha tiene TODAS las acciones.** Una fila solo puede ofrecer acciones que también
 *   estén en la ficha. Una acción en una fila y no en la ficha es un bug. (Con un límite
 *   documentado en `database-actions.ts`: la fila del inventario no conoce la presencia física.)
 * - **R2. Qué acciones hay depende del ESTADO de la base y de las capacidades**, no de qué lista
 *   la muestra. La misma base gestionada tiene la misma fila en cualquier listado.
 * - **R5. Una acción destructiva se nombra por su consecuencia.** «Quitar del inventario» (deja
 *   la base en el motor; icono de lista) y «Eliminar del motor 🔌» (DROP DATABASE; papelera) no
 *   comparten ni etiqueta ni icono. Antes las dos eran «Eliminar» con la misma papelera roja.
 * - **R4. Las variantes de contexto se declaran**: `surface` es una unión cerrada. En la fila del
 *   inventario la destructiva es «Quitar del inventario»; en la física, «Eliminar del motor»; la
 *   ficha tiene las dos.
 *
 * Paridad sumando, no restando: las filas conservan los atajos que ya tenían (Migraciones,
 * Reasignar…) aunque también estén en la ficha. Quitar un atajo que el operador usa es el mismo
 * problema que faltar, en la otra dirección.
 *
 * **Cómo se amplía:** una acción nueva es su id y su etiqueta en `database-actions.ts` (y en qué
 * estados aparece), más su presentación y su diálogo o destino AQUÍ. Ninguna página toca nada:
 * todas pintan `DatabaseRowActions`/`DatabaseHeaderActions` y montan una vez `DatabaseActionDialogs`.
 *
 * Los diálogos se montan una vez por página y no dentro de cada fila por dos motivos: `DataTable`
 * pinta cada celda dos veces (tabla y tarjeta bajo `md`), y una mutación que saca la fila del
 * listado filtrado (aprovisionar desde «Pendiente», adoptar desde «No gestionadas») desmontaría
 * el diálogo a mitad de su desenlace.
 */

/** La base sobre la que se actúa. `state` lo deriva quien la muestra con `resolveDatabaseState`. */
export interface DatabaseActionTarget {
  serverId: number
  /** Nombre físico en el motor: su identidad real. */
  name: string
  /** Registro del inventario; `null` si no está registrada (o no se sabe todavía). */
  managed: ManagedDatabaseOut | null
  state: DatabaseState
}

/** Acciones que abren un diálogo en vez de navegar. */
type DialogActionId = Exclude<DatabaseActionId, 'migrations' | 'compare' | 'clone' | 'export'>

export interface PendingDatabaseAction {
  action: DialogActionId
  target: DatabaseActionTarget
  /** Desde dónde se pidió: el diálogo de quitar del inventario cambia según la superficie. */
  surface: DatabaseActionSurface
}

/** Grupo de la cabecera de la ficha. Las filas no agrupan: ordenan por zonas (`rowZone`). */
type HeaderGroup = 'state' | 'operate' | 'record' | 'destructive'

interface ActionPresentation {
  icon?: ReactNode
  /**
   * Cómo va en la fila. `icon` solo para lo que se repite Y se reconoce sin texto (editar,
   * eliminar, y comparar/clonar, que llevan el mismo icono que su entrada del menú lateral);
   * las acciones de dominio conservan el texto.
   */
  row: 'icon' | 'text'
  /**
   * El icono de la fila lleva además su texto en la tarjeta de `< md`, donde no hay tooltip.
   * Para los iconos que NO están en la lista de universales de `CLAUDE.md`: sin texto, en táctil
   * «Quitar del inventario» y «Eliminar del motor» son dos botones rojos que solo se distinguen
   * por la forma del dibujo.
   */
  cardText?: boolean
  /** Texto más corto para la fila, cuando la etiqueta completa la alargaría en cada base. */
  rowText?: string
  group: HeaderGroup
}

const PRESENTATION: Record<DatabaseActionId, ActionPresentation> = {
  provision: { row: 'text', group: 'state' },
  recreate: { row: 'text', group: 'state' },
  adopt: { row: 'text', group: 'state' },
  edit: { icon: <PencilIcon />, row: 'icon', group: 'record' },
  reassign: { row: 'text', rowText: 'Reasignar', group: 'record' },
  // En la ficha es una pestaña (`DETAIL_TAB_ACTIONS`): su grupo no llega a pintarse.
  migrations: { row: 'text', group: 'operate' },
  compare: { icon: <CompareIcon />, row: 'icon', cardText: true, group: 'operate' },
  clone: { icon: <CloneIcon />, row: 'icon', cardText: true, group: 'operate' },
  export: { row: 'text', group: 'operate' },
  'remove-from-inventory': {
    icon: <ListRemoveIcon />,
    row: 'icon',
    cardText: true,
    group: 'destructive',
  },
  'drop-from-engine': { icon: <TrashIcon />, row: 'icon', group: 'destructive' },
}

/** Grupos de la cabecera, en orden, con el nombre que anuncia el lector de pantalla. */
const HEADER_GROUPS: { id: HeaderGroup; label: string }[] = [
  { id: 'state', label: 'Estado' },
  { id: 'operate', label: 'Operar' },
  { id: 'record', label: 'Registro' },
  { id: 'destructive', label: 'Destructivas' },
]

/**
 * Zona de una acción en la fila: `[dominio con texto] [atajos con texto] [iconos] · [destructiva]`.
 * Sin zonas, la fila de una base activa intercalaba icono, texto, texto, icono, icono, texto e
 * icono, y el ojo no encontraba un patrón para saber dónde buscar.
 */
function rowZone(action: DatabaseActionId): number {
  if (DOMAIN_ACTIONS.has(action)) return 0
  if (DESTRUCTIVE_ACTIONS.has(action)) return 3
  return PRESENTATION[action].row === 'text' ? 1 : 2
}

/**
 * Rojo solo en dos intensidades: `danger-soft` para todo botón destructivo que ABRE un diálogo,
 * en fila o en la cabecera; `danger` queda para la confirmación final dentro del diálogo.
 */
function variantOf(action: DatabaseActionId, surface: DatabaseActionSurface): ButtonVariant {
  if (DESTRUCTIVE_ACTIONS.has(action)) return 'danger-soft'
  if (DOMAIN_ACTIONS.has(action)) return surface === 'detail' ? 'primary' : 'outline'
  return surface === 'detail' ? 'outline' : 'ghost'
}

/** Resuelve la acción: navega a su pantalla o pide abrir su diálogo. */
function useRunAction(
  onAction: (pending: PendingDatabaseAction) => void,
  surface: DatabaseActionSurface,
) {
  const navigate = useNavigate()
  return (action: DatabaseActionId, target: DatabaseActionTarget) => {
    const managedId = target.managed?.id
    switch (action) {
      case 'migrations':
        void navigate(serverDatabasePath(target.serverId, target.name, 'migrations'))
        return
      case 'compare':
        if (managedId !== undefined) {
          void navigate(`/schema-comparisons?targetDatabaseId=${managedId}`)
        }
        return
      case 'clone':
        if (managedId !== undefined) {
          void navigate(`/database-clones/nuevo?sourceDatabaseId=${managedId}`)
        }
        return
      case 'export':
        // Funciona sobre cualquier base del servidor, adoptada o no: se identifica por
        // `serverId` + nombre, igual que la conversión de collation.
        void navigate(
          `/database-exports?serverId=${target.serverId}&database=${encodeURIComponent(target.name)}`,
        )
        return
      default:
        onAction({ action, target, surface })
    }
  }
}

function useActionsFor(target: DatabaseActionTarget, surface: DatabaseActionSurface) {
  const canDropFromEngine = useCapabilities().can(CAPABILITIES.databasesDrop)
  return getDatabaseActions(target.state, surface, { canDropFromEngine })
}

/** Acciones de una fila. Va en la columna `header: ''` de `DataTable` (pie de la tarjeta bajo `md`). */
export function DatabaseRowActions({
  target,
  source,
  onAction,
}: {
  target: DatabaseActionTarget
  /** Qué listado la muestra: decide cuál de las dos destructivas aparece (R4). */
  source: 'inventory' | 'physical'
  onAction: (pending: PendingDatabaseAction) => void
}) {
  // `sort` es estable: dentro de cada zona se conserva el orden de `getDatabaseActions`.
  const actions = useActionsFor(target, source).sort((a, b) => rowZone(a) - rowZone(b))
  const run = useRunAction(onAction, source)

  // `flex-wrap`: en la tarjeta de `< md` una base activa suma seis atajos y la destructiva, más
  // de lo que cabe en un móvil; sin partir la línea, la destructiva quedaba fuera de pantalla.
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {actions.map((action) => {
        const { icon, row, rowText, cardText } = PRESENTATION[action]
        const label = DATABASE_ACTION_LABELS[action]
        return (
          <RowActionButton
            key={action}
            label={row === 'text' ? (rowText ?? label) : label}
            subject={target.name}
            icon={row === 'icon' ? icon : undefined}
            iconText={cardText ? 'card' : 'table'}
            variant={variantOf(action, source)}
            // Separada del resto: es la única que no se puede deshacer con otro clic.
            className={DESTRUCTIVE_ACTIONS.has(action) ? 'ml-2' : undefined}
            onClick={() => run(action, target)}
          />
        )
      })}
    </div>
  )
}

/**
 * Acciones de la cabecera de la ficha: el superconjunto (R1), siempre con texto porque aquí no
 * se repiten. Las que son una pestaña de la ficha (`DETAIL_TAB_ACTIONS`) no se pintan como botón.
 *
 * Van en grupos con nombre (`role="group"`): con ocho botones seguidos no había jerarquía, y la
 * salida del estado (Aprovisionar, Recrear) pesaba lo mismo que Exportar. Las destructivas van
 * aparte, separadas por un filete, para que nunca queden pegadas a una acción inocua.
 */
export function DatabaseHeaderActions({
  target,
  onAction,
}: {
  target: DatabaseActionTarget
  onAction: (pending: PendingDatabaseAction) => void
}) {
  const actions = useActionsFor(target, 'detail').filter(
    (action) => !DETAIL_TAB_ACTIONS.has(action),
  )
  const run = useRunAction(onAction, 'detail')

  return (
    <>
      {HEADER_GROUPS.map((group) => {
        const inGroup = actions.filter((action) => PRESENTATION[action].group === group.id)
        if (inGroup.length === 0) return null
        return (
          <div
            key={group.id}
            role="group"
            aria-label={group.label}
            className={cn(
              'flex flex-wrap gap-2',
              group.id === 'destructive' && 'sm:border-l sm:border-border sm:pl-3',
            )}
          >
            {inGroup.map((action) => (
              <Button
                key={action}
                variant={variantOf(action, 'detail')}
                onClick={() => run(action, target)}
              >
                {PRESENTATION[action].icon}
                {DATABASE_ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        )
      })}
    </>
  )
}

/**
 * Los diálogos de las acciones, montados una vez por página. Cada uno se monta condicionalmente,
 * así que nace con estado fresco en cada apertura, sin resetear nada con efectos.
 */
export function DatabaseActionDialogs({
  pending,
  getServer,
  onClose,
  onDropped,
  onShowGrantees,
}: {
  pending: PendingDatabaseAction | null
  /** El servidor de la base: su nombre para los textos y su motor/endpoint para el DROP. */
  getServer: (serverId: number) => ServerOut | undefined
  onClose: () => void
  /** Tras un DROP en el motor (o al descubrir que ya no existía). */
  onDropped?: (target: DatabaseActionTarget) => void
  /** Si se pasa, el diálogo de DROP ofrece ir a ver los usuarios con permisos de la base. */
  onShowGrantees?: (target: DatabaseActionTarget) => void
}) {
  if (!pending) return null
  const { action, target } = pending
  const { managed } = target
  const server = getServer(target.serverId)

  switch (action) {
    case 'adopt':
      return (
        <AdoptDatabaseModal
          open
          onClose={onClose}
          serverId={target.serverId}
          databaseName={target.name}
        />
      )
    case 'drop-from-engine':
      // Solo se ofrece donde el servidor ya está cargado (listado físico y ficha): sin su motor y
      // su endpoint el diálogo no puede decir contra QUÉ servidor se ejecuta el DROP.
      if (!server) return null
      return (
        <DropDatabaseDialog
          serverId={server.id}
          serverName={server.name}
          serverEndpoint={`${server.host}:${server.port}`}
          engine={server.engine}
          database={target.name}
          onClose={onClose}
          onDeleted={() => {
            onClose()
            onDropped?.(target)
          }}
          onShowGrantees={
            onShowGrantees
              ? () => {
                  onClose()
                  onShowGrantees(target)
                }
              : undefined
          }
        />
      )
  }

  // El resto son operaciones de inventario: sin registro no hay nada que abrir.
  if (!managed) return null
  switch (action) {
    case 'edit':
      return (
        <ManagedDatabaseFormModal
          open
          onClose={onClose}
          database={managed}
          serverName={server?.name}
        />
      )
    case 'reassign':
      return <ReassignOwnerModal database={managed} onClose={onClose} />
    case 'remove-from-inventory':
      return (
        <DeleteManagedDatabaseDialog
          database={managed}
          allowEngineDrop={allowsEngineDropOnRemove(target.state, pending.surface)}
          onClose={onClose}
        />
      )
    case 'provision':
    case 'recreate':
      return (
        <ProvisionDatabaseDialog database={managed} serverName={server?.name} onClose={onClose} />
      )
  }
}
