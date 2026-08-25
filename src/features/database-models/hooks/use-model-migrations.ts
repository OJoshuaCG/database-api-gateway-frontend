import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { invalidateDatabaseViews } from '@/features/managed-databases/invalidate'
import { classifyItem } from '@/features/environments'
import { toApiError } from '@/lib/api/errors'
import { useToast } from '@/lib/toast/use-toast'
import type { QueryParams } from '@/lib/api/client'
import type {
  MigrationEditPreviewIn,
  MigrationValidateIn,
  ModelMigrationCreate,
  ModelMigrationPatch,
} from '@/lib/contracts'
import {
  applyAllMigrations,
  createModelMigration,
  deleteModelMigration,
  getModelMigration,
  listModelMigrations,
  previewModelMigrationEdit,
  updateModelMigration,
  validateModelMigration,
  type ApplyAllOptions,
} from '../api/model-migrations.api'

export function useModelMigrations(modelId: number, params: QueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.databaseModels.migrationList(modelId, params),
    queryFn: ({ signal }) => listModelMigrations(modelId, params, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useModelMigration(modelId: number, version: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseModels.migrationDetail(modelId, version),
    queryFn: ({ signal }) => getModelMigration(modelId, version, signal),
    enabled,
  })
}

export function useCreateModelMigration(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: ModelMigrationCreate) => createModelMigration(modelId, body),
    onSuccess: (migration) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
      toast.success('Migración creada', `${migration.version} · ${migration.name}`)
    },
    onError: (error) => toast.error('No se pudo crear la migración', toApiError(error).message),
  })
}

export function useUpdateModelMigration(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ version, body }: { version: string; body: ModelMigrationPatch }) =>
      updateModelMigration(modelId, version, body),
    onSuccess: (migration) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
      queryClient.setQueryData(
        queryKeys.databaseModels.migrationDetail(modelId, migration.version),
        migration,
      )
      toast.success('Migración actualizada', `${migration.version} · ${migration.name}`)
    },
    onError: (error) =>
      toast.error('No se pudo actualizar la migración', toApiError(error).message),
  })
}

export function useDeleteModelMigration(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (version: string) => deleteModelMigration(modelId, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
      toast.success('Migración eliminada')
    },
    onError: (error) => toast.error('No se pudo eliminar la migración', toApiError(error).message),
  })
}

export function useApplyAllMigrations(modelId: number) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (options: ApplyAllOptions) => applyAllMigrations(modelId, options),
    onSuccess: (result, options) => {
      if (!options.dryRun) {
        // Invalidación de las TRES vistas, no solo el inventario: la tabla de estado del
        // blueprint (`database-models/{id}/databases`) es justamente la que muestra la versión
        // aplicada, y hasta ahora quedaba rancia después de un apply masivo. Bug preexistente
        // que esta feature vuelve visible al agregarle la columna de entorno.
        invalidateDatabaseViews(queryClient)

        // Tres cubos, no dos. Una BD "bloqueada por política" NO es un fallo: es el sistema
        // funcionando, y mezclarla con los errores reales obliga a leer cada fila para saber
        // cuáles necesitan acción.
        const blocked = result.results.filter((r) => classifyItem(r) === 'blocked').length
        const failed = result.results.filter((r) => classifyItem(r) === 'failed').length
        // `matched_databases` y no `total_databases`: el primero refleja los filtros del lote
        // (p. ej. acotado a un entorno), así que "3 de 40" deja de leerse como "sobraron 37".
        const scope = `${result.processed} de ${result.matched_databases || result.total_databases} BD(s)`
        const detail = [
          `${result.results.length - blocked - failed} aplicada(s)`,
          blocked ? `${blocked} bloqueada(s) por política` : null,
          failed ? `${failed} con error` : null,
        ]
          .filter(Boolean)
          .join(' · ')

        if (failed > 0) {
          toast.error(`Aplicación masiva con ${failed} fallo(s)`, `${scope} — ${detail}`)
        } else if (blocked > 0) {
          // Ni éxito limpio ni error: el lote corrió y la política frenó parte. `warning` es el
          // tono correcto — en esta app el rojo significa "está roto", y un rechazo por política
          // es el sistema funcionando. No hay atajo para esta variante, así que va por `push`.
          toast.push({
            variant: 'warning',
            title: 'Aplicación masiva parcial',
            description: `${scope} — ${detail}`,
          })
        } else {
          toast.success('Aplicación masiva ejecutada', `${scope} — ${detail}`)
        }
      }
    },
    onError: (error) =>
      toast.error('No se pudo ejecutar la aplicación masiva', toApiError(error).message),
  })
}

/**
 * Valida el SQL de una migración antes de aplicarla (api-reference-v11 §1).
 *
 * Es una mutación y no una query a propósito: se dispara cuando el usuario pulsa «Validar»,
 * no en cada tecla. El endpoint tiene rate limit (20/min) y, con `managedDatabaseId`, abre
 * una conexión al motor — validar mientras se escribe lo agotaría en segundos.
 *
 * Sin `onError` con toast: el panel de resultados ya muestra el fallo en contexto, y un toast
 * encima solo taparía lo que el usuario está leyendo.
 */
export function useValidateModelMigration(modelId: number) {
  return useMutation({
    mutationFn: (body: MigrationValidateIn) => validateModelMigration(modelId, body),
  })
}

/**
 * Paso 1 de la edición de una versión ya aplicada (api-reference-v15 §3).
 *
 * Es una **mutación y no una query**, y no por comodidad: abre conexiones a los motores, está
 * limitada a 20/min, queda auditada y emite un token con vencimiento. Como query, TanStack la
 * refetchearía al reenfocar la ventana —gastando intentos del rate limit y rotando el token que
 * el usuario está a punto de usar—, y la cachearía, que es justo lo contrario de lo que se quiere:
 * cada previsualización tiene que leer el estado de AHORA.
 *
 * Sin `onError` con toast: los fallos de este paso se explican en el panel, en contexto, y cada
 * uno lleva un CTA distinto (reintentar, arreglar la conexión, volver a previsualizar).
 */
export function usePreviewModelMigrationEdit(modelId: number) {
  return useMutation({
    mutationFn: ({ version, body }: { version: string; body: MigrationEditPreviewIn }) =>
      previewModelMigrationEdit(modelId, version, body),
  })
}

/**
 * Paso 2 de la edición de una versión ya aplicada: el PATCH con el doble factor.
 *
 * Hook aparte de `useUpdateModelMigration` y no un flag suyo, porque el feedback es de otra
 * naturaleza. Aquel avisa con toasts; aquí **la pantalla de resultado ES el feedback** —tiene que
 * decir, con el mismo peso visual, qué cambió y qué NO cambió— y cada error lleva su propio CTA en
 * contexto (volver a previsualizar, corregir un override, reintentar el apply). Un toast encima
 * taparía justo eso.
 *
 * Sí invalida la caché: la insignia `sql_diverged` y el checksum nuevo tienen que releerse del
 * backend, no deducirse de la respuesta de esta llamada.
 */
export function useConfirmModelMigrationEdit(modelId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ version, body }: { version: string; body: ModelMigrationPatch }) =>
      updateModelMigration(modelId, version, body),
    onSuccess: (migration) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databaseModels.migrations(modelId) })
      queryClient.setQueryData(
        queryKeys.databaseModels.migrationDetail(modelId, migration.version),
        migration,
      )
    },
  })
}
