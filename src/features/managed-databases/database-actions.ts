import type { ProvisionStatus } from '@/lib/contracts'

/**
 * Qué acciones se ofrecen sobre una base de datos, como lógica pura.
 *
 * **Existe porque divergió.** Cada listado (el inventario del sidebar, las bases de un servidor) y
 * la ficha armaban sus botones a mano, y en agosto se decidió que las tablas conservaran atajos a
 * lo que ofrece la ficha. Sin una sola fuente, cada pantalla fue sumando atajos por su cuenta: una
 * base gestionada no tenía «Editar» en el listado del servidor, la ficha no tenía «Editar» ni
 * «Reasignar», y dos botones idénticos («Eliminar», papelera, rojo) hacían cosas opuestas.
 *
 * Las reglas que este módulo hace cumplir (y que su test verifica combinación por combinación):
 *
 * - **R1. La ficha tiene TODAS las acciones.** Una fila solo ofrece acciones que también estén en
 *   la ficha; una acción en una fila y no en la ficha es un bug. **Límite real, no garantizado por
 *   construcción:** el test compara la fila y la ficha de un MISMO estado, pero la fila del
 *   inventario no conoce la presencia física (`presence: 'unknown'`) y la ficha sí, así que las
 *   dos pueden resolver estados distintos para la misma base. Dos casos conocidos:
 *   - Una base `active` que desapareció del motor: su fila del inventario la ve `managed-active` y
 *     ofrece Comparar, Clonar y Exportar; su ficha la ve `managed-missing` y no los ofrece.
 *   - Una base en `error`: su fila la ve `managed-error` y ofrece Migraciones; si en realidad
 *     nunca se creó, su ficha la ve `managed-unprovisioned`, sin Migraciones y con Aprovisionar.
 *   En los dos casos la fila ofrece de más, nunca algo peligroso de menos, y la ficha —que es a
 *   donde lleva el enlace del nombre— muestra el estado real.
 * - **R2. Las acciones dependen del ESTADO de la base y de las capacidades**, no de qué listado
 *   la muestra: la misma base gestionada tiene la misma fila en cualquier tabla.
 * - **R4. Las variantes de contexto se declaran, no se improvisan**: `DatabaseActionSurface` es
 *   una unión cerrada y lo único que cambia entre `inventory` y `physical` es cuál de las dos
 *   destructivas aparece en la fila de una base gestionada activa.
 * - **R5. Una acción destructiva se nombra por su consecuencia**: «Quitar del inventario» y
 *   «Eliminar del motor 🔌» nunca comparten etiqueta ni icono.
 */

/**
 * Estado de una base frente a los dos planos (motor e inventario del gateway).
 *
 * - `managed-active`: registrada y existe en el motor (o se asume que existe: su estado lo dice).
 * - `managed-unprovisioned`: registrada y TODAVÍA no existe en el motor: `pending` (con presencia
 *   ausente o desconocida) o `error` que el motor confirma ausente (el alta falló).
 * - `managed-error`: registrada en `error` sin saber si existe en el motor, que es lo que ve la
 *   fila del inventario. `error` significa dos cosas opuestas: un alta que falló (no existe) o la
 *   CUARENTENA tras una migración fallida (sí existe, y Migraciones es justo su salida). Como no
 *   se puede suponer ninguna, no ofrece «Aprovisionar» —el backend lo rechaza en cuarentena con
 *   `quarantined_not_missing`, y la ficha de una base en cuarentena tampoco lo ofrece— ni nada que
 *   exija que la base exista, salvo Migraciones, que se ofrece siempre.
 * - `managed-missing`: registrada, se esperaba en el motor y no aparece: existió y desapareció
 *   (la borraron por fuera del gateway). Solo la ficha lo detecta: es la única vista que mira los
 *   dos planos a la vez por nombre.
 * - `managed-archived`: archivada y presente en el motor. El backend rechaza migrar, clonar y
 *   comparar una archivada (`managed_database.archived`); queda editar, exportar y quitarla.
 * - `managed-archived-unlisted`: archivada y el motor no la lista (ausente, o la vista no lo
 *   sabe). Tampoco se ofrece «Recrear»: el backend no recrea una archivada.
 * - `unmanaged`: existe en el motor y no en el inventario (adoptable).
 * - `unresolved`: existe en el motor pero el inventario no cargó, falló o vino truncado, así que
 *   no se sabe si está registrada. Solo se ofrece lo que depende del motor: afirmar «no
 *   gestionada» y ofrecer «Adoptar» sería decidir algo que todavía no se sabe.
 *
 * Hoy ningún flujo del gateway escribe `archived`, pero el contrato lo admite: sin estado propio
 * caía en `managed-active` y ofrecía operaciones que el backend rechaza.
 */
export type DatabaseState =
  | 'managed-active'
  | 'managed-unprovisioned'
  | 'managed-error'
  | 'managed-missing'
  | 'managed-archived'
  | 'managed-archived-unlisted'
  | 'unmanaged'
  | 'unresolved'

/**
 * Dónde se pintan las acciones. `inventory` y `physical` son las dos variantes de fila (R4);
 * `detail` es la cabecera de la ficha, que por R1 es el superconjunto de ambas.
 */
export type DatabaseActionSurface = 'inventory' | 'physical' | 'detail'

/** Qué sabe la vista sobre la presencia física de la base en el motor. */
export type EnginePresence = 'present' | 'absent' | 'unknown'

export type DatabaseActionId =
  | 'provision'
  | 'recreate'
  | 'adopt'
  | 'edit'
  | 'reassign'
  | 'agent-access'
  | 'migrations'
  | 'compare'
  | 'clone'
  | 'export'
  | 'remove-from-inventory'
  | 'drop-from-engine'

/** Capacidades del rol que cambian qué se ofrece. Se pasan resueltas: este módulo es puro. */
export interface DatabaseActionCapabilities {
  /** `databases.drop`: el DROP DATABASE sobre el motor. */
  canDropFromEngine: boolean
}

/**
 * Nombre de cada acción: es a la vez el texto del botón, el `aria-label` y el tooltip del icono.
 * Vive aquí, y no en el componente, para que el test pueda comprobar R5 sobre las etiquetas reales.
 */
export const DATABASE_ACTION_LABELS: Record<DatabaseActionId, string> = {
  provision: 'Aprovisionar 🔌',
  recreate: 'Recrear en el motor 🔌',
  adopt: 'Adoptar',
  edit: 'Editar',
  reassign: 'Reasignar propietario',
  'agent-access': 'Acceso de agentes',
  migrations: 'Migraciones',
  compare: 'Comparar esquema',
  clone: 'Clonar',
  export: 'Exportar',
  'remove-from-inventory': 'Quitar del inventario',
  'drop-from-engine': 'Eliminar del motor 🔌',
}

/** Acciones de dominio: van con texto y primero, porque son la salida del estado en que está. */
export const DOMAIN_ACTIONS: ReadonlySet<DatabaseActionId> = new Set<DatabaseActionId>([
  'provision',
  'recreate',
  'adopt',
])

/** Acciones destructivas: siempre al final y nunca más de una por fila. */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<DatabaseActionId> = new Set<DatabaseActionId>([
  'remove-from-inventory',
  'drop-from-engine',
])

/**
 * Acciones que en la ficha son una PESTAÑA y no un botón de la cabecera. Siguen contando para R1
 * —la ficha las ofrece—, pero pintarlas también como botón duplicaría la pestaña de al lado.
 */
export const DETAIL_TAB_ACTIONS: ReadonlySet<DatabaseActionId> = new Set<DatabaseActionId>([
  'migrations',
])

/**
 * Deriva el estado de una base.
 *
 * `inventoryKnown` es falso mientras el inventario carga o si falló: sin él, una base sin registro
 * es `unresolved`, no `unmanaged`. Una base sin registro y ausente del motor no tiene estado —no
 * existe en ningún plano— y la vista que la busca debe tratarla antes de llegar aquí.
 */
export function resolveDatabaseState(input: {
  managed: { status: ProvisionStatus } | null
  inventoryKnown: boolean
  presence: EnginePresence
}): DatabaseState {
  const { managed, inventoryKnown, presence } = input
  if (managed === null) return inventoryKnown ? 'unmanaged' : 'unresolved'
  // Antes que la presencia: una archivada presente no es activa, y el backend rechaza sobre ella
  // lo que una activa ofrece.
  if (managed.status === 'archived') {
    return presence === 'present' ? 'managed-archived' : 'managed-archived-unlisted'
  }
  // Si el motor la lista, existe, diga lo que diga el estado del registro: ofrecer «Aprovisionar»
  // sobre una base que ya está ahí solo produciría un CREATE DATABASE fallido.
  if (presence === 'present') return 'managed-active'
  if (managed.status === 'pending') return 'managed-unprovisioned'
  // Con presencia desconocida NO se supone ausencia: un `error` puede ser una cuarentena, y la
  // base estar en el motor. Solo el motor confirmando que no está la vuelve «sin aprovisionar».
  if (managed.status === 'error') {
    return presence === 'absent' ? 'managed-unprovisioned' : 'managed-error'
  }
  return presence === 'absent' ? 'managed-missing' : 'managed-active'
}

/**
 * Lista ordenada de acciones disponibles: [dominio con texto] [atajos] [destructiva].
 *
 * Lo que requiere que la base exista en el motor (comparar, clonar, exportar, eliminar del motor)
 * nunca se ofrece en los estados en que no existe o no se sabe; Migraciones es la excepción en
 * `managed-error`, por la cuarentena (ver `DatabaseState`). Lo que requiere el registro del
 * inventario (editar, reasignar, quitar del inventario, migraciones, comparar, clonar) nunca se
 * ofrece sin él.
 */
export function getDatabaseActions(
  state: DatabaseState,
  surface: DatabaseActionSurface,
  capabilities: DatabaseActionCapabilities,
): DatabaseActionId[] {
  const dropFromEngine: DatabaseActionId[] = capabilities.canDropFromEngine
    ? ['drop-from-engine']
    : []

  switch (state) {
    case 'managed-active': {
      const destructive: DatabaseActionId[] =
        surface === 'inventory'
          ? ['remove-from-inventory']
          : surface === 'physical'
            ? dropFromEngine
            : ['remove-from-inventory', ...dropFromEngine]
      return [
        'edit',
        'reassign',
        'agent-access',
        'migrations',
        'compare',
        'clone',
        'export',
        ...destructive,
      ]
    }
    case 'managed-unprovisioned':
      return ['provision', 'edit', 'reassign', 'agent-access', 'remove-from-inventory']
    case 'managed-error':
      return ['edit', 'reassign', 'agent-access', 'migrations', 'remove-from-inventory']
    case 'managed-missing':
      return ['recreate', 'edit', 'reassign', 'agent-access', 'remove-from-inventory']
    case 'managed-archived':
      return ['edit', 'export', 'remove-from-inventory']
    case 'managed-archived-unlisted':
      return ['edit', 'remove-from-inventory']
    case 'unmanaged':
      return ['adopt', 'export', ...dropFromEngine]
    case 'unresolved':
      return ['export', ...dropFromEngine]
  }
}

/**
 * Si el diálogo de «Quitar del inventario» puede ofrecer además el DROP del motor (`drop_remote`).
 *
 * Solo en la fila del inventario de una base activa: es la única superficie donde «Eliminar del
 * motor 🔌» no está al lado. En la ficha y en el listado físico ese botón existe y pasa por el
 * preview, las conexiones activas y el `confirm_token`; el switch del diálogo hace el DROP sin
 * nada de eso, y ofrecer los dos caminos lado a lado invita a tomar el corto. Y fuera de
 * `managed-active` la base no está (o no se sabe si está) en el motor: no hay nada que borrar.
 */
export function allowsEngineDropOnRemove(
  state: DatabaseState,
  surface: DatabaseActionSurface,
): boolean {
  return surface === 'inventory' && state === 'managed-active'
}
