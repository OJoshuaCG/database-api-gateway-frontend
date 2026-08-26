import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import {
  useCancelCollationBatch,
  useCollationBatch,
  useCollationDrift,
  useCreateCollationBlueprintVersion,
  useExecuteCollationBatch,
  usePlanCollationBatch,
} from './use-collation-batches'

/**
 * Contratos del lote de collation contra respuestas COMPLETAS, campo por campo (v17).
 *
 * POR QUÉ ESTE ARCHIVO ES EL MÁS IMPORTANTE DEL MÓDULO
 * -----------------------------------------------------
 * Los contratos zod se escriben a mano (ADR-0001), así que una divergencia con el backend **no
 * falla al compilar**: falla en runtime, y falla FEO. El `safeParse` del cliente corre sobre el
 * envelope entero, o sea que **un solo campo mal tipado descarta la respuesta completa** y la
 * pantalla queda vacía con un `[api] Respuesta no conforme al contrato` en la consola — sin decir
 * cuál de los cuarenta campos fue.
 *
 * Estos payloads salen de `docs/api-reference-v17.md` del backend, campo por campo, y **con los
 * `null` puestos donde el contrato los admite**. Esa es la trampa concreta que el handoff marcó:
 * `ApiResponse` filtra los `None` solo del envelope, los anidados salen como `null` EXPLÍCITO, y
 * Zod `.optional()` rechaza `null`. Por eso todo campo `| null` va `.nullable()`, y por eso los
 * mocks de acá mandan `null` de verdad en vez de omitir la clave: omitirla probaría el caso que
 * no ocurre.
 */

const BASE = 'http://localhost/api/v1'
const MODEL_ID = 7
const BATCH_ID = 42

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

/** Summary de un job, con los cuatro campos de §2 y todos los nullables en `null`. */
function jobSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    server_id: 3,
    database_name: 'tienda_prod',
    database_id: 55,
    engine: 'mysql',
    mode: 'universal',
    target_charset: 'utf8mb4',
    target_collation: 'utf8mb4_0900_ai_ci',
    previous_db_charset: 'utf8mb3',
    previous_db_collation: 'utf8mb3_general_ci',
    status: 'running',
    phase: 'tables',
    progress: { phase: 'tables', tables_done: 3, objects_done: 0 },
    error: null,
    expired: false,
    created_at: '2026-08-25T10:00:00Z',
    expires_at: '2026-08-26T10:00:00Z',
    started_at: '2026-08-25T10:01:00Z',
    finished_at: null,
    batch_id: BATCH_ID,
    batch_seq: 1,
    tables_total: 40,
    objects_total: 6,
    ...overrides,
  }
}

describe('usePlanCollationBatch', () => {
  it('parsea el plan completo, con una BD ok y otra rechazada por motor', async () => {
    server.use(
      http.post(`${BASE}/database-models/${MODEL_ID}/collation-conversions`, () =>
        HttpResponse.json({
          data: {
            batch_id: BATCH_ID,
            model_id: MODEL_ID,
            model_slug: 'tienda',
            target_charset: 'utf8mb4',
            target_collation: 'utf8mb4_0900_ai_ci',
            total_eligible: 5,
            max_databases: 3,
            capped: true,
            batch_token: 'tok-abc',
            expires_at: '2026-08-26T10:00:00Z',
            runs_serially: true,
            databases: [
              {
                managed_database_id: 55,
                server_id: 3,
                database_name: 'tienda_prod',
                batch_seq: 1,
                job_id: 101,
                ok: true,
                error: null,
                error_code: null,
                tables_to_convert: 40,
                objects_to_recreate: 6,
                include_database_default: true,
                missing_tables: [],
                warnings: ['Los objetos programables se recrearán.'],
                confirm_token: 'ct-1',
              },
              {
                // La PostgreSQL del blueprint: NO aborta el lote, sale como ítem.
                managed_database_id: 56,
                server_id: 4,
                database_name: 'analitica',
                batch_seq: 2,
                job_id: null,
                ok: false,
                error: 'El objetivo pedido no aplica a este motor.',
                error_code: 'collation.engine_not_applicable',
                tables_to_convert: 0,
                objects_to_recreate: 0,
                include_database_default: false,
                missing_tables: [],
                warnings: [],
                confirm_token: null,
              },
            ],
          },
          message: 'Lote planificado.',
        }),
      ),
    )

    const { result } = renderHook(() => usePlanCollationBatch(MODEL_ID), { wrapper })
    act(() => {
      result.current.mutate({
        target_charset: 'utf8mb4',
        target_collation: 'utf8mb4_0900_ai_ci',
        scope: 'all_tables',
        tables: [],
        objects: 'all',
        include_database_default: true,
        environment_id: null,
        max_databases: 3,
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const plan = result.current.data!
    expect(plan.batch_token).toBe('tok-abc')
    expect(plan.capped).toBe(true)
    expect(plan.databases).toHaveLength(2)
    // El `job_id: null` y el `confirm_token: null` del ítem rechazado son el caso que
    // `.optional()` habría descartado, tumbando la respuesta entera.
    expect(plan.databases[1]?.job_id).toBeNull()
    expect(plan.databases[1]?.confirm_token).toBeNull()
    expect(plan.databases[1]?.error_code).toBe('collation.engine_not_applicable')
  })
})

describe('useExecuteCollationBatch', () => {
  it('parsea el 200 con rechazos por BD adentro', async () => {
    server.use(
      http.post(
        `${BASE}/database-models/${MODEL_ID}/collation-conversions/${BATCH_ID}/execute`,
        () =>
          HttpResponse.json({
            data: {
              batch_id: BATCH_ID,
              model_id: MODEL_ID,
              enqueued: 1,
              runs_serially: true,
              results: [
                {
                  managed_database_id: 55,
                  database_name: 'tienda_prod',
                  job_id: 101,
                  batch_seq: 1,
                  ok: true,
                  error: null,
                  error_code: null,
                },
                {
                  managed_database_id: 56,
                  database_name: 'analitica',
                  job_id: null,
                  batch_seq: 2,
                  ok: false,
                  error: 'No aplica.',
                  error_code: 'collation.engine_not_applicable',
                },
              ],
            },
            message: 'Lote encolado.',
          }),
      ),
    )

    const { result } = renderHook(() => useExecuteCollationBatch(MODEL_ID, BATCH_ID), { wrapper })
    act(() => {
      result.current.mutate({
        confirm_model_slug: 'tienda',
        confirm_token: 'tok-abc',
        database_ids: [55, 56],
        confirmations: {},
        force: false,
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.enqueued).toBe(1)
    expect(result.current.data?.results).toHaveLength(2)
  })
})

describe('useCollationBatch', () => {
  it('parsea el estado del lote con sus jobs', async () => {
    server.use(
      http.get(`${BASE}/database-models/${MODEL_ID}/collation-conversions/${BATCH_ID}`, () =>
        HttpResponse.json({
          data: {
            batch: {
              batch_id: BATCH_ID,
              model_id: MODEL_ID,
              target_charset: 'utf8mb4',
              target_collation: 'utf8mb4_0900_ai_ci',
              status: 'running',
              error: null,
              total: 3,
              max_databases: 3,
              capped: true,
              blueprint_version_id: null,
              created_by_username: 'admin',
              expires_at: '2026-08-26T10:00:00Z',
              created_at: '2026-08-25T10:00:00Z',
              started_at: '2026-08-25T10:01:00Z',
              finished_at: null,
              runs_serially: true,
              counts: { total: 3, queued: 2, running: 1, done: 0, failed: 0, canceled: 0 },
            },
            jobs: [jobSummary()],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useCollationBatch(MODEL_ID, BATCH_ID, true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.batch.counts.queued).toBe(2)
    expect(result.current.data?.jobs[0]?.tables_total).toBe(40)
    expect(result.current.data?.jobs[0]?.batch_seq).toBe(1)
  })

  it('un job SUELTO trae los cuatro campos del lote en null', async () => {
    // Es el caso normal de una conversión por base, y el que rompería si algún día alguien
    // "simplifica" esos campos a `.optional()`.
    server.use(
      http.get(`${BASE}/database-models/${MODEL_ID}/collation-conversions/${BATCH_ID}`, () =>
        HttpResponse.json({
          data: {
            batch: {
              batch_id: BATCH_ID,
              model_id: MODEL_ID,
              target_charset: null,
              target_collation: 'utf8mb4_0900_ai_ci',
              status: 'done',
              error: null,
              total: 1,
              max_databases: 10,
              capped: false,
              blueprint_version_id: 9,
              created_by_username: null,
              expires_at: '2026-08-26T10:00:00Z',
              created_at: '2026-08-25T10:00:00Z',
              started_at: '2026-08-25T10:01:00Z',
              finished_at: '2026-08-25T11:00:00Z',
              runs_serially: true,
              counts: { total: 1, queued: 0, running: 0, done: 1, failed: 0, canceled: 0 },
            },
            jobs: [
              jobSummary({
                status: 'succeeded',
                phase: null,
                progress: null,
                batch_id: null,
                batch_seq: null,
                tables_total: null,
                objects_total: null,
                finished_at: '2026-08-25T11:00:00Z',
              }),
            ],
          },
        }),
      ),
    )

    const { result } = renderHook(() => useCollationBatch(MODEL_ID, BATCH_ID, true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const job = result.current.data!.jobs[0]!
    expect(job.batch_id).toBeNull()
    expect(job.progress).toBeNull()
    expect(job.tables_total).toBeNull()
  })

  it('no hace polling cuando el lote ya está en estado terminal', async () => {
    let hits = 0
    server.use(
      http.get(`${BASE}/database-models/${MODEL_ID}/collation-conversions/${BATCH_ID}`, () => {
        hits += 1
        return HttpResponse.json({
          data: {
            batch: {
              batch_id: BATCH_ID,
              model_id: MODEL_ID,
              target_charset: null,
              target_collation: 'utf8mb4_0900_ai_ci',
              status: 'done',
              error: null,
              total: 1,
              max_databases: 10,
              capped: false,
              blueprint_version_id: null,
              created_by_username: null,
              expires_at: '2026-08-26T10:00:00Z',
              created_at: '2026-08-25T10:00:00Z',
              started_at: null,
              finished_at: '2026-08-25T11:00:00Z',
              runs_serially: true,
              counts: { total: 1, queued: 0, running: 0, done: 1, failed: 0, canceled: 0 },
            },
            jobs: [],
          },
        })
      }),
    )

    const { result } = renderHook(() => useCollationBatch(MODEL_ID, BATCH_ID, true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // Un lote terminado que siguiera refrescando cada 5 s quemaría el rate limit de 30/min
    // para siempre, sobre datos que ya no cambian.
    expect(hits).toBe(1)
  })
})

describe('useCancelCollationBatch', () => {
  it('escribe la respuesta en la caché para no esperar un tick de 5 s', async () => {
    server.use(
      http.post(
        `${BASE}/database-models/${MODEL_ID}/collation-conversions/${BATCH_ID}/cancel`,
        () =>
          HttpResponse.json({
            data: {
              batch: {
                batch_id: BATCH_ID,
                model_id: MODEL_ID,
                target_charset: null,
                target_collation: 'utf8mb4_0900_ai_ci',
                status: 'canceled',
                error: null,
                total: 2,
                max_databases: 10,
                capped: false,
                blueprint_version_id: null,
                created_by_username: null,
                expires_at: '2026-08-26T10:00:00Z',
                created_at: '2026-08-25T10:00:00Z',
                started_at: '2026-08-25T10:01:00Z',
                finished_at: '2026-08-25T10:30:00Z',
                runs_serially: true,
                counts: { total: 2, queued: 0, running: 0, done: 1, failed: 0, canceled: 1 },
              },
              jobs: [],
            },
          }),
      ),
    )

    const { result } = renderHook(() => useCancelCollationBatch(MODEL_ID, BATCH_ID), { wrapper })
    act(() => {
      result.current.mutate()
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.batch.status).toBe('canceled')
  })
})

describe('useCreateCollationBlueprintVersion', () => {
  it('parsea la versión con stamps fallidos', async () => {
    server.use(
      http.post(
        `${BASE}/database-models/${MODEL_ID}/collation-conversions/${BATCH_ID}/blueprint-version`,
        () =>
          HttpResponse.json({
            data: {
              batch_id: BATCH_ID,
              model_id: MODEL_ID,
              version: 12,
              migration_id: 300,
              statement_count: 47,
              stamped: [
                { managed_database_id: 55, ok: true, error: null },
                { managed_database_id: 56, ok: false, error: 'timeout' },
              ],
              pending_stamp: [56],
              note: 'Esta versión se stampea, no se aplica.',
            },
          }),
      ),
    )

    const { result } = renderHook(
      () => useCreateCollationBlueprintVersion(MODEL_ID, BATCH_ID),
      { wrapper },
    )
    act(() => {
      result.current.mutate({ name: null })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.version).toBe(12)
    expect(result.current.data?.pending_stamp).toEqual([56])
  })
})

describe('useCollationDrift', () => {
  it('parsea los cinco estados de deriva y el declared en null', async () => {
    server.use(
      http.get(`${BASE}/database-models/${MODEL_ID}/collation-drift`, () =>
        HttpResponse.json({
          data: {
            model_id: MODEL_ID,
            model_slug: 'tienda',
            declared: null,
            source: 'cached',
            source_note: 'Lectura del inventario del gateway, no del motor.',
            databases: (
              ['ok', 'drifted', 'unknown', 'undeclared', 'not_applicable'] as const
            ).map((status, i) => ({
              managed_database_id: 50 + i,
              database_name: `db_${status}`,
              server_id: 3,
              server_name: 'srv-1',
              engine: status === 'not_applicable' ? 'postgresql' : 'mysql',
              environment_slug: i === 0 ? 'produccion' : null,
              charset: status === 'unknown' ? null : 'utf8mb4',
              collation: status === 'unknown' ? null : 'utf8mb4_0900_ai_ci',
              status,
              source_of_truth: 'adopted',
            })),
          },
        }),
      ),
    )

    const { result } = renderHook(() => useCollationDrift(MODEL_ID, true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.declared).toBeNull()
    expect(result.current.data?.databases).toHaveLength(5)
    expect(result.current.data?.databases[2]?.collation).toBeNull()
  })
})
