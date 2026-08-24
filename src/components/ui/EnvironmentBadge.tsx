import { Badge, type BadgeTone } from './Badge'

/**
 * Entorno de despliegue de una BD gestionada, con su política.
 *
 * PRESENTACIONAL, como todo lo de `components/ui`: recibe props y no llama a ningún hook. El
 * `environment_id` llega como id crudo en la respuesta, así que el join id→entorno lo hace la
 * página (igual que `serverNameById`) y le pasa el estado ya resuelto. Poner el hook del catálogo
 * acá haría que un componente compartido haga data-fetching.
 *
 * Los CUATRO estados son distintos a propósito y no se colapsan en `#id`: una etiqueta de
 * SEGURIDAD que falla en abierto no es lo mismo que un nombre que cae a un id. En particular,
 * "sin clasificar" es una afirmación explícita —esa base NO está protegida por ninguna
 * política— y por eso no se renderiza como celda vacía: un blanco se lee "no cargó".
 */
export type EnvironmentBadgeState =
  | {
      kind: 'assigned'
      name: string
      color: BadgeTone | null
      blocksDestructive: boolean
    }
  /** `environment_id === null`: valor legítimo, y significa SIN protección. */
  | { kind: 'unassigned' }
  /** El catálogo todavía no resolvió. Nunca mostrar el id acá. */
  | { kind: 'loading' }
  /** El catálogo falló, o el id no está en él (entorno borrado o desconocido). */
  | { kind: 'unresolved'; environmentId: number; reason: 'error' | 'unknown' }

/**
 * Alcance REAL del bloqueo, para el `title`. Un badge crea creencias más amplias que la barrera:
 * el entorno NO frena el rollback, el DROP DATABASE, el clon con `drop_database`, la consola SQL,
 * la conversión de collation ni el export. Este string es lo más barato que evita la peor lectura.
 */
const BLOCKS_TITLE =
  'Bloquea aplicar migraciones destructivas (DROP / TRUNCATE / DELETE sin WHERE / ALTER DROP ' +
  'COLUMN) a las BDs de este entorno. NO bloquea DROP DATABASE, clon, consola SQL ni exportación.'

const ALLOWS_TITLE = 'Este entorno no bloquea las migraciones destructivas.'

const UNASSIGNED_TITLE =
  'Sin entorno asignado: ninguna política la protege, así que el guard de migraciones ' +
  'destructivas la deja pasar.'

export function EnvironmentBadge({
  state,
  className,
}: {
  state: EnvironmentBadgeState
  className?: string
}) {
  if (state.kind === 'loading') {
    return (
      <Badge tone="neutral" className={className} title="Cargando el catálogo de entornos…">
        …
      </Badge>
    )
  }

  if (state.kind === 'unassigned') {
    return (
      <Badge tone="neutral" className={className} title={UNASSIGNED_TITLE}>
        sin clasificar
      </Badge>
    )
  }

  if (state.kind === 'unresolved') {
    return (
      <Badge
        tone="neutral"
        className={className}
        title={
          state.reason === 'error'
            ? 'No se pudo cargar el catálogo de entornos, así que se muestra el id.'
            : 'Entorno desconocido: puede haber sido borrado o estar inactivo.'
        }
      >
        #{state.environmentId}
      </Badge>
    )
  }

  // El fallback cubre el `null` del backend (el color es opcional y se puede limpiar).
  // La compatibilidad `EnvironmentColor` ⊆ `BadgeTone` se afirma al CONSTRUIR el estado, en
  // `resolveEnvironmentState` — que es el único lugar que importa los dos lados sin invertir
  // capas (`components/ui` no debe depender de `lib/contracts`).
  const tone: BadgeTone = state.color ?? 'neutral'

  return (
    <Badge
      tone={tone}
      className={className}
      // El peso es un canal ortogonal al color, y hace falta: en estas tablas el rojo ya
      // significa "esto está roto" (error de aprovisionamiento, cuarentena, huérfana), así que
      // el color por sí solo no distingue "es producción" de "está fallando".
      title={state.blocksDestructive ? BLOCKS_TITLE : ALLOWS_TITLE}
    >
      {state.blocksDestructive ? <span aria-hidden>🔒</span> : null}
      <span className={state.blocksDestructive ? 'font-semibold' : undefined}>{state.name}</span>
    </Badge>
  )
}
