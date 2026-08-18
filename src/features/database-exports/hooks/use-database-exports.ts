import { useDeferredValue } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import { useDebouncedValue } from '@/lib/utils/use-debounced-value'
import type { QueryParams } from '@/lib/api/client'
import type { ExportJobStatus } from '@/lib/contracts'
import {
  getDatabaseExport,
  getExportCapabilities,
  getExportManifest,
  getExportObjects,
  listExportItems,
  previewDatabaseExport,
  resolveExportSelection,
  type ExportResolveSelectionIn,
  type ExportSpecPayload,
} from '../api/database-exports.api'

/**
 * Amortiguación de lo que el usuario teclea o marca antes de consultar el motor. Los tres endpoints
 * que dependen del formulario están limitados a 10/min y abren conexión a la base: sin esto, escribir
 * una palabra en el buscador o ajustar un delimitador agota la cuota antes de terminar.
 */
const TYPING_DEBOUNCE_MS = 400

/** Estados terminales del job: ninguna vista debe seguir haciendo polling una vez alcanzados. */
export const EXPORT_TERMINAL_STATUSES = new Set<ExportJobStatus>([
  'succeeded',
  'failed',
  'canceled',
  'interrupted',
])

/**
 * Capacidades del formulario 🔌 (30/min): controles, defaults, matriz de compatibilidad y límites.
 * Es lo PRIMERO que se pide, porque todo el resto del wizard se deriva de acá — sin esto no hay
 * formulario que pintar, no hay defaults que aplicar y no hay reglas que evaluar.
 *
 * La guarda es explícita porque los dos argumentos suelen venir de la ruta: con un `serverId` no
 * numérico o una base vacía la llamada se armaría contra una URL inválida.
 */
export function useExportCapabilities(
  serverId: number | null,
  database: string | null,
  enabled: boolean,
) {
  const hasTarget =
    serverId !== null &&
    Number.isFinite(serverId) &&
    serverId > 0 &&
    database !== null &&
    database.length > 0

  return useQuery({
    queryKey: queryKeys.databaseExports.capabilities(serverId ?? 0, database ?? ''),
    queryFn: ({ signal }) => getExportCapabilities(serverId ?? 0, database ?? '', signal),
    enabled: enabled && hasTarget,
  })
}

/**
 * Catálogo de objetos del motor 🔌 (10/min), paginado y filtrable. Usa `keepPreviousData` porque se
 * pagina y se filtra en vivo: sin él, cada tecleo en el buscador vaciaría la tabla y el selector
 * parpadearía entre "sin resultados" y la página nueva.
 */
export function useExportObjects(jobId: number, params: QueryParams, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseExports.objects(jobId, params),
    queryFn: ({ signal }) => getExportObjects(jobId, params, signal),
    enabled: enabled && Number.isFinite(jobId) && jobId > 0,
    placeholderData: keepPreviousData,
  })
}

/**
 * Cierre de dependencias de la selección en curso 🔌 (10/min).
 *
 * Se amortigua con `useDebouncedValue` **y** se difiere con `useDeferredValue`, que no son lo mismo:
 * el diferido solo colapsa las actualizaciones de un mismo ciclo de render, así que por sí solo deja
 * pasar una llamada por cada clic o pulsación. Contra un endpoint de 10/min eso es un 429 a media
 * palabra. El debounce corta las ráfagas; el diferido mantiene la interfaz responsiva mientras la
 * query recalcula.
 *
 * `isStale` es `true` mientras `body` (el valor EN VIVO, recién tocado por el usuario) todavía no
 * alcanzó al que disparó la query. Sin ese flag, un `data` que describe la selección ANTERIOR se lee
 * como «ya resuelto para lo que está marcado ahora», y confirmar en esa ventana pierde objetos en
 * silencio: el llamador debe bloquear cualquier acción que dependa del cierre mientras sea `true`.
 *
 * La comparación es por identidad, así que el llamador tiene que mantener `body` estable con
 * `useMemo` — un objeto literal nuevo en cada render dejaría `isStale` encendido para siempre.
 */
export function useExportResolveSelection(
  jobId: number,
  body: ExportResolveSelectionIn | null,
  enabled: boolean,
) {
  const deferredBody = useDeferredValue(useDebouncedValue(body, TYPING_DEBOUNCE_MS))
  const isStale = body !== deferredBody

  const query = useQuery({
    queryKey: queryKeys.databaseExports.resolveSelection(jobId, deferredBody),
    // El `?? {}` es inalcanzable (la query está deshabilitada con `body` nulo); existe para no
    // recurrir a un cast que taparía un cambio de firma real.
    queryFn: ({ signal }) => resolveExportSelection(jobId, deferredBody ?? {}, signal),
    enabled: enabled && deferredBody !== null && Number.isFinite(jobId) && jobId > 0,
  })

  return { ...query, isStale }
}

/**
 * Panel vivo de consecuencias 🔌 (10/min): valida el spec en cada cambio del formulario y reporta
 * objetos planificados, estimaciones y avisos.
 *
 * **`dry_run_only: true` se fuerza acá dentro, no en el llamador**, y es deliberado: un
 * `dry_run_only: false` accidental CONGELARÍA la selección y emitiría un `confirm_token` nuevo en
 * cada tecleo, invalidando el anterior. El preview autoritativo es una mutación aparte
 * (`useExportPreview`), que se dispara una sola vez cuando el usuario confirma.
 *
 * Mismo debounce + diferido y mismo `isStale` que `useExportResolveSelection`: el llamador debe
 * mantener `spec` estable con `useMemo` y no leer `data` como definitivo mientras `isStale` sea
 * `true`.
 *
 * `autoResolveDependencies` viaja **también aquí**, y no solo en el preview autoritativo: sin él, el
 * CTA «Agregar las dependencias» que el propio panel de error ofrece ante un 422
 * `export.missing_dependencies` no cambiaría el cuerpo de esta query, así que devolvería el mismo
 * 422 para siempre y —como el paso de confirmación exige un dry-run válido— el botón de exportar
 * quedaría deshabilitado sin explicación.
 */
export function useExportDryRunPreview(
  jobId: number,
  spec: ExportSpecPayload | null,
  autoResolveDependencies: boolean,
  enabled: boolean,
) {
  const deferredSpec = useDeferredValue(useDebouncedValue(spec, TYPING_DEBOUNCE_MS))
  const isStale = spec !== deferredSpec

  const query = useQuery({
    queryKey: queryKeys.databaseExports.preview(jobId, {
      spec: deferredSpec,
      dryRun: true,
      autoResolveDependencies,
    }),
    queryFn: ({ signal }) =>
      previewDatabaseExport(
        jobId,
        {
          spec: deferredSpec ?? undefined,
          dry_run_only: true,
          auto_resolve_dependencies: autoResolveDependencies,
        },
        signal,
      ),
    enabled: enabled && deferredSpec !== null && Number.isFinite(jobId) && jobId > 0,
  })

  return { ...query, isStale }
}

/**
 * Resumen + estado del job: el latido del polling. Refresca cada 2,5 s mientras el `status` no sea
 * terminal y se detiene sola en cuanto lo es. Este endpoint no tiene rate limit precisamente para
 * que este intervalo (2–3 s, el que pide el contrato) sea sostenible.
 */
export function useDatabaseExport(jobId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseExports.detail(jobId),
    queryFn: ({ signal }) => getDatabaseExport(jobId, signal),
    enabled: enabled && Number.isFinite(jobId) && jobId > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && !EXPORT_TERMINAL_STATUSES.has(status) ? 2500 : false
    },
  })
}

/**
 * Reporte por objeto, paginado. **Sin polling**, a diferencia del de clones y conversiones: el
 * backend escribe los ítems de una sola vez AL TERMINAR el job, así que durante `pending`/`running`
 * este endpoint devuelve lista vacía. Refrescarlo en vivo solo conseguiría mostrar «0 incidencias»
 * durante toda la exportación, que es lo contrario de la verdad — el llamador lo habilita cuando el
 * `status` ya es terminal.
 */
export function useExportItems(jobId: number, params: QueryParams, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseExports.items(jobId, params),
    queryFn: ({ signal }) => listExportItems(jobId, params, signal),
    enabled: enabled && Number.isFinite(jobId) && jobId > 0,
    placeholderData: keepPreviousData,
  })
}

/**
 * Manifiesto del artefacto: qué se llevó, con su sha256, sin abrir el archivo. Sobrevive a
 * `consumed` y a `purged`, así que sigue respondiendo después de descargar o de que el artefacto
 * se purgue.
 */
export function useExportManifest(jobId: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.databaseExports.manifest(jobId),
    queryFn: ({ signal }) => getExportManifest(jobId, signal),
    enabled: enabled && Number.isFinite(jobId) && jobId > 0,
  })
}
