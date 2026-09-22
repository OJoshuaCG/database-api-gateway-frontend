import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
} from '@/components/ui'
import { useCapabilityGuard } from '@/features/auth'
import { CAPABILITIES, type VersionTableDatabase, type VersionTableStatus } from '@/lib/contracts'
import { toApiError } from '@/lib/api/errors'
import { formatDateTime } from '@/lib/utils'
import { useVersionTablesReport } from '../hooks/use-database-models'
import { RenameSlugDialog } from './RenameSlugDialog'
import {
  isBlockingVersionTable,
  isVersionTableStatus,
  VERSION_TABLE_STATUS_ORDER,
  versionTableBadge,
  versionTableStatusRank,
} from '../version-table-badges'

/** Espera que se impone tras un 429. El endpoint es 10/min, así que reintentar antes no sirve. */
const ESPERA_429_MS = 60_000

/**
 * La versión que se puede stampear de una tabla huérfana. `null` cuando la tabla existe pero está
 * VACÍA — que no es «no se pudo leer»: no hay versión que ofrecer, así que tampoco hay CTA.
 */
function versionesRecuperables(fila: VersionTableDatabase): string[] {
  return fila.orphan_tables
    .map((tabla) => tabla.version)
    .filter((version): version is string => version !== null && version.length > 0)
}

/** Nombre legible del servidor; el id existe siempre, el nombre no. */
function nombreServidor(fila: VersionTableDatabase): string {
  return fila.server_name ?? `Servidor #${fila.server_id}`
}

interface VersionTablesReportPanelProps {
  modelId: number
}

/**
 * Informe de contabilidad de versiones del blueprint (`GET /database-models/{id}/version-tables`).
 *
 * **Qué diagnostica.** El `slug` del blueprint nombra la tabla `_datum_version_<slug>` (o `_gw_v_<slug>` en el formato histórico) DENTRO de cada base
 * gestionada. Cambiar el slug por un campo de formulario no renombraba nada en los motores, así
 * que el gateway quedaba leyendo una tabla inexistente y la contabilidad real seguía viva con el
 * nombre viejo. Esta pantalla es la que dice, base por base, si eso pasó y con qué versión.
 *
 * **Se pide a mano, nunca al montar.** Abre una conexión por base y el endpoint es 10/min: un
 * `enabled` atado al ciclo de vida del componente gastaría el presupuesto del minuto cada vez que
 * alguien entra a la pestaña por error. El botón «Comprobar ahora 🔌» es el único disparador.
 *
 * **Tres cosas que esta vista deliberadamente NO hace**, y conviene que sigan sin hacerse:
 *
 * 1. **No ofrece borrar la tabla huérfana.** No hay endpoint para eso y la consola SQL bloquea por
 *    diseño cualquier sentencia que nombre `_datum_version_*` o `_gw_v_*`. Un botón que no puede existir es peor que su
 *    ausencia: promete una salida y deja al operador buscando por qué falla.
 * 2. **No «arregla automáticamente».** El enlace de recuperación PRECARGA la versión leída en el
 *    formulario de stamp de esa base, que el admin confirma; no la ejecuta. El backend rechazó la
 *    auto-corrección a propósito — con varias huérfanas no hay forma de saber cuál adoptar.
 * 3. **No tiene acciones en lote.** Cada base puede tener un contraste distinto entre lo que dice
 *    el inventario y lo que dice la tabla huérfana, y ese contraste es justamente lo que hay que
 *    mirar antes de tocarla. «Recuperar todas» taparía las N decisiones en un clic.
 *
 * Tampoco hay gráfica: cinco categorías sobre un total pequeño se leen mejor en contadores, y una
 * de tarta invita a leer «proporción sana» donde lo único que importa es si hay ≥1 fuera de sitio.
 */
export function VersionTablesReportPanel({ modelId }: VersionTablesReportPanelProps) {
  /** Se activa con el primer clic y ya no se apaga: a partir de ahí releer es `refetch`. */
  const [pedido, setPedido] = useState(false)
  const [filtro, setFiltro] = useState<VersionTableStatus | null>(null)
  /**
   * Tic del reloj para la cuenta atrás del 429. Empieza en `null` a propósito: leer `Date.now()`
   * en render (o en el inicializador de `useState`, que también corre en render) es una función
   * impura y `react-hooks` v7 lo marca como error. Hasta el primer tic se usa el instante del
   * error como base, que da la espera completa.
   */
  const [ahora, setAhora] = useState<number | null>(null)
  const [actualizando, setActualizando] = useState(false)

  const informe = useVersionTablesReport(modelId, pedido)
  // Escribe en bases ajenas: mismo requisito que el renombrado de slug. Se deshabilita el botón en
  // vez de dejar que el 403 llegue tras leer el plan entero.
  const guardFormato = useCapabilityGuard(
    CAPABILITIES.blueprintsWrite,
    'actualizar el formato de las tablas de versión',
  )
  const error = informe.isError ? toApiError(informe.error) : null

  // Cuenta atrás del 429. `errorUpdatedAt` lo da TanStack Query, así que el instante del error no
  // hay que capturarlo con un `setState` dentro de un efecto (que además está prohibido acá).
  const esperaHasta = error?.isRateLimited ? informe.errorUpdatedAt + ESPERA_429_MS : null
  const restanteMs =
    esperaHasta === null
      ? 0
      : Math.max(0, esperaHasta - Math.max(ahora ?? 0, esperaHasta - ESPERA_429_MS))
  const segundosRestantes = Math.ceil(restanteMs / 1000)

  useEffect(() => {
    // `setTimeout` encadenado y no un `setInterval`: al llegar a cero el efecto sale sin volver a
    // programar nada, así que el reloj se apaga solo en vez de tiquear para siempre de fondo.
    if (restanteMs <= 0) return
    const id = setTimeout(() => setAhora(Date.now()), 1000)
    return () => clearTimeout(id)
  }, [restanteMs])

  const bases = useMemo(() => informe.data?.databases ?? [], [informe.data])
  const bloqueantes = bases.filter((base) => isBlockingVersionTable(base.status)).length
  const sinLeer = bases.filter((base) => base.status === 'unreachable').length

  /**
   * Contadores del `summary` tal y como llegaron.
   *
   * El backend lo declara `dict[str, int]` **abierto**: no se asumen las cinco claves ni se
   * rellenan las que falten, y una desconocida se pinta con su nombre crudo en vez de
   * descartarse — un contador que el backend se molestó en mandar y la UI esconde en silencio es
   * el fallo que no se nota hasta que hace falta.
   */
  const contadores = useMemo(() => {
    const desconocido = VERSION_TABLE_STATUS_ORDER.length
    return Object.entries(informe.data?.summary ?? {})
      .map(([clave, total]) => ({
        clave,
        total,
        badge: isVersionTableStatus(clave) ? versionTableBadge(clave) : null,
      }))
      .sort(
        (a, b) =>
          (a.badge ? versionTableStatusRank(a.badge.key) : desconocido) -
            (b.badge ? versionTableStatusRank(b.badge.key) : desconocido) ||
          a.clave.localeCompare(b.clave),
      )
  }, [informe.data])

  /**
   * Filas ordenadas **con lo bloqueante primero** y filtradas en cliente.
   *
   * `/version-tables` no pagina y devuelve el parque entero, así que el orden y el filtro son la
   * única forma legítima de que lo accionable quede en la primera pantalla: el endpoint no acepta
   * parámetros de orden ni de estado y no se los va a inventar esta vista.
   */
  const filas = useMemo(() => {
    const visibles = filtro ? bases.filter((base) => base.status === filtro) : bases
    return [...visibles].sort(
      (a, b) =>
        versionTableStatusRank(a.status) - versionTableStatusRank(b.status) ||
        a.database_name.localeCompare(b.database_name, 'es'),
    )
  }, [bases, filtro])

  const columns = useMemo<ColumnDef<VersionTableDatabase>[]>(
    () => [
      {
        accessorKey: 'database_name',
        header: 'Base',
        cell: ({ row }) => (
          <Link
            to={`/managed-databases/${row.original.managed_database_id}/migrations`}
            className="font-medium text-foreground hover:underline"
          >
            {row.original.database_name}
          </Link>
        ),
      },
      {
        id: 'server',
        accessorFn: (fila) => nombreServidor(fila),
        header: 'Servidor',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{nombreServidor(row.original)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Estado',
        // Sin ordenación propia: ordenar «Estado» alfabéticamente rompería el orden por gravedad,
        // que es el único que pone lo accionable arriba.
        enableSorting: false,
        cell: ({ row }) => {
          const badge = versionTableBadge(row.original.status)
          const presentes = row.original.present_tables
          const detalle = row.original.detail
          return (
            <div className="flex flex-col items-start gap-1.5">
              <Badge tone={badge.tone} title={badge.title}>
                {badge.icon && <span aria-hidden>{badge.icon}</span>}
                {badge.label}
              </Badge>
              {/*
                La consecuencia del estado NO se repite por fila: es la misma prosa de tres líneas
                para las quince bases `orphaned` de un parque roto, y entre quince copias idénticas
                hay que ir a buscar lo único que varía —el `detail` y la versión real—. En la vista
                de tarjeta de `&lt;md` es peor todavía: empuja el enlace de recuperación al fondo.
                Vive arriba y una sola vez, en el `Callout` del semáforo; acá se llega a ella por
                el `title` del badge y por «Ver detalle». Mismo criterio que el aviso de dirección
                del historial, que también va una vez arriba.
              */}
              {(detalle || presentes.length > 0) && (
                // Plegado y no siempre visible porque son varias líneas por fila; el texto del
                // backend va TAL CUAL y sin resumir: es lo que nombra la tabla real y el motivo
                // exacto de un `unreachable`, y resumirlo borra justo el dato que hace falta.
                <details className="w-full rounded-lg border border-border px-2 py-1.5 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Ver detalle</summary>
                  <div className="flex flex-col gap-1.5 pt-1.5">
                    {detalle && <p className="whitespace-pre-wrap text-foreground">{detalle}</p>}
                    {presentes.length > 0 && (
                      <p className="text-muted-foreground">
                        Tablas internas halladas:{' '}
                        {presentes.map((tabla) => (
                          <code
                            key={tabla}
                            className="mr-1 rounded bg-surface-muted px-1 py-0.5 font-mono"
                          >
                            {tabla}
                          </code>
                        ))}
                      </p>
                    )}
                  </div>
                </details>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'current_version',
        header: 'Versión esperada',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <code className="w-fit rounded bg-surface-muted px-1.5 py-0.5 text-xs">
              {row.original.current_version ?? 'ninguna'}
            </code>
            <span className="text-xs text-muted-foreground">
              en <code className="font-mono">{row.original.expected_table}</code>
            </span>
          </div>
        ),
      },
      {
        id: 'real',
        header: 'Versión real',
        enableSorting: false,
        cell: ({ row }) => {
          const { orphan_tables: huerfanas, cached_version: inventario } = row.original
          if (huerfanas.length === 0) {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-col gap-2">
              {huerfanas.map((tabla) => {
                const discrepa = tabla.version !== null && tabla.version !== inventario
                return (
                  <div key={tabla.table} className="flex flex-col gap-0.5">
                    <code className="w-fit rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                      {/* Una tabla sin filas NO es un error de lectura: existe y está vacía, así
                          que no hay versión que stampear y por eso tampoco lleva CTA. */}
                      {tabla.version ?? 'Tabla vacía'}
                    </code>
                    {/* En `mixed` esto NO es «la versión real» de la base: la real vive en la
                        tabla esperada, que el gateway lee bien. Esto es lo que quedó en el
                        residuo, y rotularlo igual que en `orphaned` invita a stampearlo. */}
                    {row.original.status === 'mixed' && (
                      <span className="text-xs text-warning">residuo, no la versión vigente</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      en <code className="font-mono">{tabla.table}</code>
                    </span>
                    {discrepa && (
                      // El contraste va VISIBLE y no en un `title`: es el dato que decide si se
                      // puede recuperar de un stamp o si esta base necesita que alguien la mire.
                      <span className="text-xs font-medium text-warning">
                        El inventario dice {inventario ?? 'ninguna'}, la tabla huérfana dice{' '}
                        {tabla.version}. Mirá esta base antes de tocarla.
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        },
      },
      {
        // `header: ''` es la convención del repo para la columna de acciones: es la que la vista
        // de tarjeta de `DataTable` pinta al final, sin etiqueta, como fila de botones.
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const fila = row.original
          if (fila.status === 'unreachable') {
            // Sin acción y CON el motivo: ofrecer un stamp sobre una base que no se pudo leer
            // sería posicionarla a ciegas.
            return (
              <span className="text-xs text-muted-foreground">
                No se pudo leer el motor: sin acción hasta que responda.
              </span>
            )
          }
          /*
           * 🔴 SOLO `orphaned`, no `isBlockingVersionTable` (que es `orphaned || mixed`).
           *
           * Las dos preguntas parecen la misma y son opuestas. `isBlockingVersionTable` responde
           * «¿mueve `needs_attention`?»; acá hace falta «¿hay algo que stampear?».
           *
           * En `orphaned` la tabla esperada NO existe y la huérfana tiene la verdad: recuperar es
           * moverle el puntero a esa versión. En `mixed` la tabla esperada **sí existe y el
           * gateway la lee bien** —lo dice el propio badge: «el puntero es correcto»— y la
           * huérfana es residuo de un renombrado a medias, con una versión VIEJA. Ofrecer ahí
           * «Recuperar con stamp 0007…» sobre una base que está sana en 0012 la haría
           * RETROCEDER, y los apply siguientes reejecutarían 0008–0012. Es el mismo daño del
           * incidente, servido por la pantalla que existe para repararlo.
           */
          const versiones = fila.status === 'orphaned' ? versionesRecuperables(fila) : []
          if (fila.status === 'mixed') {
            return (
              <span className="text-xs text-muted-foreground">
                El puntero de esta base es correcto: lo que sobra es residuo, no una versión que
                recuperar. Quitarlo requiere acceso directo al motor.
              </span>
            )
          }
          if (versiones.length === 0) return null
          return (
            <div className="flex flex-col items-start gap-1.5 md:items-end">
              {/* Un enlace POR versión legible: con dos tablas huérfanas no hay forma de saber
                  cuál adoptar, y elegir una por el front sería la auto-corrección que el backend
                  rechazó. El enlace solo PRECARGA el stamp; lo confirma el admin en la base. */}
              {versiones.map((version) => (
                <Link
                  key={version}
                  to={`/managed-databases/${fila.managed_database_id}/migrations?stamp=${version}`}
                  className="rounded px-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Recuperar con stamp {version}…
                </Link>
              ))}
            </div>
          )
        },
      },
    ],
    [],
  )

  const comprobadoEl = informe.dataUpdatedAt
    ? formatDateTime(new Date(informe.dataUpdatedAt).toISOString())
    : null

  const botonComprobar = (
    <Button
      variant="outline"
      size="sm"
      isLoading={informe.isFetching}
      disabled={segundosRestantes > 0}
      onClick={() => {
        if (!pedido) setPedido(true)
        else void informe.refetch()
      }}
    >
      {segundosRestantes > 0 ? `Disponible en ${segundosRestantes} s` : 'Comprobar ahora 🔌'}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Contabilidad de versiones</p>
          <p className="text-xs text-muted-foreground">
            Blueprint{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5">
              {informe.data?.slug ?? '—'}
            </code>{' '}
            · el gateway busca la tabla{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5 font-mono">
              {informe.data?.expected_table ?? '—'}
            </code>{' '}
            dentro de cada base gestionada.
          </p>
          {comprobadoEl && (
            // Hora absoluta y no «hace N s»: lo relativo obliga a un reloj en render —impuro— o a
            // un tic permanente, y acá lo que importa es DE CUÁNDO es la foto, no su antigüedad.
            <p className="text-xs text-muted-foreground">Comprobado el {comprobadoEl}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap justify-end gap-2">
            {/*
              Opcional y secundario A PROPÓSITO: las bases con el formato histórico siguen
              funcionando para siempre y cada apply, rollback o stamp moderniza la que toca. Por
              eso no hay badge de «pendiente» ni banner que empuje a pulsarlo: sirve para no
              esperar, no para saldar una deuda.
            */}
            <Button
              variant="outline"
              size="sm"
              disabled={!guardFormato.allowed}
              title={guardFormato.hint}
              onClick={() => setActualizando(true)}
            >
              Actualizar al formato Datum… 🔌
            </Button>
            {botonComprobar}
          </div>
          {/* Un `<button disabled>` no dispara el tooltip nativo: el motivo va como texto
              visible, igual que en `DatabaseModelForm`. */}
          {!guardFormato.allowed && guardFormato.hint && (
            <p className="text-xs text-muted-foreground">{guardFormato.hint}</p>
          )}
        </div>
      </div>

      {actualizando && (
        /*
         * Tras un éxito el hook invalida la key de este informe. Si ya se había pedido, la query
         * está activa y TanStack Query la vuelve a pedir sola pese al `staleTime: Infinity` —el
         * invalidate marca la foto como rancia y refetchea toda query montada—, así que al
         * cerrar el diálogo la tabla ya está releyéndose. Si nunca se pidió, no hay foto vieja
         * que confunda: sigue el estado vacío de «Comprobar ahora».
         */
        <RenameSlugDialog
          mode="migrate-format"
          modelId={modelId}
          onClose={() => setActualizando(false)}
        />
      )}

      {!pedido ? (
        <Card>
          <CardContent className="py-5">
            <EmptyState
              title="La comprobación no se lanza sola"
              description="Leer la contabilidad abre una conexión a CADA base gestionada del blueprint y el endpoint admite 10 comprobaciones por minuto, así que se pide a mano: esta pantalla no gasta ese presupuesto por el simple hecho de abrirla."
              action={botonComprobar}
            />
          </CardContent>
        </Card>
      ) : error?.isRateLimited ? (
        <Callout tone="warning" title="Límite de 10 comprobaciones por minuto">
          <p>
            El gateway rechazó la lectura porque ya se pidió el informe demasiadas veces en este
            minuto. El botón vuelve a habilitarse en {segundosRestantes} s; reintentar antes solo
            consume el presupuesto del minuto siguiente.
          </p>
        </Callout>
      ) : error ? (
        // Ojo: un MOTOR caído no llega por acá. Eso viene como fila `unreachable` dentro de un
        // 200, y el informe se pinta igual con el resto del parque.
        <ErrorState
          error={informe.error}
          title="No se pudo leer la contabilidad de versiones"
          onRetry={() => void informe.refetch()}
        />
      ) : (
        <>
          {informe.data &&
            (informe.data.needs_attention ? (
              <Callout
                tone="danger"
                title={`${bloqueantes} base(s) tienen su contabilidad de versiones fuera de sitio`}
              >
                <p>
                  Mientras siga así, el estado de migraciones de esas bases no es de fiar y aplicar
                  reejecutaría migraciones ya aplicadas.
                </p>
                {sinLeer > 0 && (
                  <p>
                    Además hay {sinLeer} base(s) que no se pudieron leer: su contabilidad es
                    indeterminada, no correcta.
                  </p>
                )}
              </Callout>
            ) : sinLeer > 0 ? (
              // 🔴 `needs_attention` NO cuenta `unreachable`, así que un informe puede venir en
              // `false` con media docena de bases sin leer. Pintarlo verde afirmaría algo que
              // nadie comprobó, y este informe existe justamente para no afirmar de más.
              <Callout
                tone="warning"
                title={`Sin nada fuera de sitio, pero ${sinLeer} base(s) quedaron sin leer`}
              >
                <p>
                  De las bases que respondieron, toda la contabilidad está donde el gateway la
                  busca. Las que no respondieron quedan indeterminadas: no cuentan como sanas.
                  Vuelve a comprobar cuando sus motores estén disponibles.
                </p>
              </Callout>
            ) : (
              <Callout tone="success" title="Toda la contabilidad está donde el gateway la busca.">
                <p>Ninguna base tiene tablas de versión fuera de sitio ni residuos que resolver.</p>
              </Callout>
            ))}

          {contadores.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {contadores.map((contador) => (
                <span
                  key={contador.clave}
                  className="inline-flex items-center gap-2 rounded-card border border-border bg-surface px-3 py-1.5"
                  title={contador.badge?.title}
                >
                  <span className="text-sm font-semibold text-foreground">{contador.total}</span>
                  {contador.badge ? (
                    <Badge tone={contador.badge.tone}>{contador.badge.label}</Badge>
                  ) : (
                    // Clave que este front no conoce: se muestra cruda. Esconderla dejaría un
                    // total que no cuadra con las filas y ninguna pista de por qué.
                    <Badge tone="neutral" title="Estado que esta versión del front no conoce">
                      {contador.clave}
                    </Badge>
                  )}
                </span>
              ))}
            </div>
          )}

          <DataTable<VersionTableDatabase>
            data={filas}
            columns={columns}
            isLoading={informe.isLoading}
            isFetching={informe.isFetching}
            getRowId={(fila) => String(fila.managed_database_id)}
            searchPlaceholder="Buscar base o servidor…"
            toolbar={
              <div className="min-w-48">
                <Combobox<VersionTableStatus>
                  label="Estado"
                  items={[...VERSION_TABLE_STATUS_ORDER]}
                  value={filtro}
                  onChange={setFiltro}
                  itemToString={(estado) => versionTableBadge(estado).label}
                  itemToKey={(estado) => estado}
                  placeholder="Todos"
                  clearable
                />
              </div>
            }
            emptyState={
              filtro ? (
                <EmptyState
                  title="Ninguna base en ese estado"
                  description="Quita el filtro para volver a ver el parque completo."
                  action={
                    <Button variant="ghost" size="sm" onClick={() => setFiltro(null)}>
                      Quitar el filtro
                    </Button>
                  }
                />
              ) : (
                // No es un error: un blueprint sin bases gestionadas simplemente no tiene
                // contabilidad que comprobar en ningún motor.
                <EmptyState
                  title="Este blueprint no tiene bases gestionadas"
                  description="No hay contabilidad que comprobar."
                />
              )
            }
          />
        </>
      )}
    </div>
  )
}
