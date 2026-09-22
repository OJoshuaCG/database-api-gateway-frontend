import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { DatabaseModelCreate, DatabaseModelUpdate, RenameSlugResult } from '@/lib/contracts'
import type { QueryParams } from '@/lib/api/client'
import { invalidateDatabaseViews } from '@/features/managed-databases/invalidate'
import {
  createDatabaseModel,
  deleteDatabaseModel,
  getDatabaseModel,
  listDatabaseModels,
  getVersionTablesReport,
  migrateVersionTable,
  planMigrateVersionTable,
  listModelDatabases,
  planRenameSlug,
  refreshModelDatabases,
  renameSlug,
  updateDatabaseModel,
} from '../api/database-models.api'

export function useDatabaseModels(params: QueryParams) {
  return useQuery({
    queryKey: queryKeys.databaseModels.list(params),
    queryFn: ({ signal }) => listDatabaseModels(params, signal),
    placeholderData: keepPreviousData,
  })
}

/** Detalle de un blueprint por id (para la página de versiones). */
export function useDatabaseModel(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.databaseModels.detail(id),
    queryFn: ({ signal }) => getDatabaseModel(id, signal),
    enabled: enabled && Number.isFinite(id) && id > 0,
  })
}

/**
 * BDs del blueprint **con su estado de despliegue** (versión actual, pendientes, parcial).
 *
 * Sustituye a lo que antes exigía una llamada por BD a `/migrations/status`, cada una con su
 * conexión al motor: ahora la tabla entera sale de una respuesta servida con datos locales.
 */
export function useModelDatabases(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseModels.databases(id),
    queryFn: ({ signal }) => listModelDatabases(id, signal),
    enabled,
  })
}

/**
 * Relee la versión REAL de cada BD y resincroniza la copia del gateway. 🔌
 *
 * El endpoint es `POST` porque tiene efectos: abre conexiones y reescribe `model_version`.
 * Colgarlo del `GET` obligaba además a limitar por tasa la lectura barata, que es la que la UI
 * repite al reenfocar la ventana.
 */
export function useRefreshModelDatabases(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => refreshModelDatabases(id),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.databaseModels.databases(id), data)
      toast.success('Estado actualizado', `${data.length} BD(s) releídas del motor`)
    },
    onError: (error) => toast.error('No se pudo releer el estado', toApiError(error).message),
  })
}

export function useCreateDatabaseModel() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: DatabaseModelCreate) => createDatabaseModel(body),
    onSuccess: (model) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      toast.success('Blueprint creado', model.name)
    },
    onError: (error) => toast.error('No se pudo crear el blueprint', toApiError(error).message),
  })
}

/**
 * Edición de un blueprint (nombre, slug, versión, charset/collation, activo).
 *
 * Invalida DOS troncos de key, no uno. El blueprint se pinta también en
 * `GET /projects/{id}/blueprints`, que vive bajo `['projects', id, 'blueprints']` y no comparte
 * prefijo con `['database-models']`. Un `invalidateQueries` solo sobre `databaseModels.all`
 * dejaba el nombre viejo en la tabla del detalle de proyecto justo después de renombrarlo desde
 * ahí, y no hay red de seguridad que lo tape: el QueryClient de la app usa `staleTime: 30_000` y
 * `refetchOnWindowFocus: false`. Mismo motivo que documenta `invalidateDatabaseViews`.
 *
 * El predicado apunta a `[2] === 'blueprints'` y por eso NO alcanza a la vista inversa
 * `projects.ofBlueprint` (`['projects', 'of-blueprint', modelId]`), que no muestra el nombre del
 * blueprint sino el de los proyectos.
 */
export function useUpdateDatabaseModel(id: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: DatabaseModelUpdate) => updateDatabaseModel(id, body),
    onSuccess: (model) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'projects' && query.queryKey[2] === 'blueprints',
      })
      toast.success('Blueprint actualizado', model.name)
    },
    onError: (error) =>
      toast.error('No se pudo actualizar el blueprint', toApiError(error).message),
  })
}

export function useDeleteDatabaseModel() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (id: number) => deleteDatabaseModel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
      toast.success('Blueprint eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el blueprint', toApiError(error).message),
  })
}

/**
 * Informe de contabilidad de versiones del blueprint (v25 §3.4). 🔌
 *
 * **Bajo demanda, nunca al montar**: abre una conexión por base y el endpoint es 10/min, así que
 * `enabled` lo gobierna un clic explícito del operador y no el ciclo de vida del componente.
 * Misma regla que ya sigue el `delete-plan` del borrado de versiones.
 *
 * `retry: false` por el mismo motivo: reintentar solo se come el presupuesto del minuto justo
 * cuando el operador lo necesita. Y `staleTime: Infinity` porque un informe es una **foto** de
 * cuándo se pidió: refrescarlo solo abriría N conexiones a espaldas de quien lo está leyendo.
 * Para releerlo está el botón «Comprobar ahora».
 */
export function useVersionTablesReport(modelId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseModelVersionTables.detail(modelId),
    queryFn: ({ signal }) => getVersionTablesReport(modelId, signal),
    enabled: enabled && Number.isFinite(modelId) && modelId > 0,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/**
 * Preview del renombrado del slug (v25 §3.2). 🔌 10/min.
 *
 * Es una mutación aunque no escriba nada, por la misma razón que el `delete-plan`: se dispara de
 * un clic y nunca al montar, y como query se re-pediría sola al reenfocar la ventana, abriendo N
 * conexiones sin que nadie lo haya pedido.
 *
 * **No emite toast de éxito**: el resultado es el semáforo del propio diálogo, y un toast encima
 * solo taparía el veredicto que hay que leer. Los errores sí los clasifica quien llama, por
 * `public_context.code`.
 */
export function useRenameSlugPlan(modelId: number) {
  return useMutation({
    mutationFn: (newSlug: string) => planRenameSlug(modelId, newSlug),
  })
}

/**
 * Lo que queda rancio tras cualquier operación que renombre tablas de versión: el renombrado de
 * slug y la migración al formato Datum. Compartido porque la regla es la misma —cambió el nombre
 * de la tabla que `status` lee en cada base— y una divergencia entre las dos no falla: solo
 * muestra datos viejos.
 */
function invalidateAfterVersionTableRename(
  queryClient: ReturnType<typeof useQueryClient>,
  modelId: number,
  result: RenameSlugResult,
): void {
  invalidateDatabaseViews(queryClient)
  void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.all })
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'projects' && query.queryKey[2] === 'blueprints',
  })
  void queryClient.invalidateQueries({
    queryKey: queryKeys.databaseModelVersionTables.detail(modelId),
  })
  /*
   * Redundante a propósito, y conviene que se sepa: `invalidateDatabaseViews` ya invalida
   * `['managed-databases']` entero, que es prefijo de `migrationStatus`. Se deja explícito
   * porque es la relación que importa —el `expected_table` de cada base renombrada cambió— y
   * porque el día que alguien acote aquel helper, esto tiene que seguir en pie.
   */
  for (const database of result.renamed_databases) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.managedDatabases.migrationStatus(database.managed_database_id),
    })
  }
}

/**
 * Ejecución del renombrado del slug (v25 §3.3). 🔌 3/min.
 *
 * Tras el éxito cambia el `slug`, que es **lo que `expected_table` predice y lo que `status` usa
 * para leer la versión de cada base**. Por eso la invalidación es ancha a propósito:
 *
 * - `invalidateDatabaseViews` cubre el cruce de troncos de las vistas de BD gestionada, que no
 *   comparten prefijo (ver su docstring).
 * - El blueprint y sus proyectos, porque el slug se pinta ahí.
 * - El informe de `/version-tables`, que quedó describiendo el parque anterior.
 * - Y el `status` de migraciones de **cada base renombrada**: no alcanza con invalidar el tronco
 *   de blueprints, porque ese estado cuelga de `['managed-databases', id, …]`.
 *
 * El error NO se notifica acá: los cinco códigos de v25 §6 tienen cada uno su propia UI —y
 * `slug_rename_failed` es una pantalla de incidente, no un toast—, así que la clasificación vive
 * en el asistente, que es quien tiene dónde pintarla.
 */
export function useRenameSlug(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (vars: { newSlug: string; confirmToken?: string | null }) =>
      renameSlug(modelId, vars.newSlug, vars.confirmToken),
    onSuccess: (result) => {
      invalidateAfterVersionTableRename(queryClient, modelId, result)
      toast.success(
        'Slug renombrado',
        result.no_op
          ? `El blueprint pasa a «${result.model.slug}». No hubo que tocar ningún motor.`
          : `El blueprint pasa a «${result.model.slug}» y se renombró la tabla de versión en ${result.renamed_databases.length} base(s).`,
      )
    },
  })
}

/**
 * Preview de la migración al formato Datum (v25 §2.3). 🔌 10/min. Mutación por lo mismo que
 * `useRenameSlugPlan`: se pide de un clic, nunca al montar ni al reenfocar la ventana.
 */
export function useMigrateVersionTablePlan(modelId: number) {
  return useMutation({
    mutationFn: () => planMigrateVersionTable(modelId),
  })
}

/**
 * Ejecución de la migración al formato Datum (v25 §2.3). 🔌 3/min.
 *
 * Misma invalidación que el renombrado de slug. El error no se notifica acá: comparte los cinco
 * códigos del renombrado, y la clasificación vive en el asistente, que es quien tiene dónde
 * pintarla.
 */
export function useMigrateVersionTable(modelId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (confirmToken: string | null) => migrateVersionTable(modelId, confirmToken),
    onSuccess: (result) => invalidateAfterVersionTableRename(queryClient, modelId, result),
  })
}
