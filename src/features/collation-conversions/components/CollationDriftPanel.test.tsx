import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CollationDriftPanel } from './CollationDriftPanel'

/**
 * El panel de deriva se usa para DECIDIR conversiones sobre bases reales, así que lo que se
 * prueba acá es que no afirme de más: que `unknown` no se lea como "todo bien", y que el aviso de
 * que esto es una caché (no el motor) aparezca textual.
 */

const BASE = 'http://localhost/api/v1'
const MODEL_ID = 7
const NOTE = 'Lectura del inventario del gateway, no del motor. Puede estar desactualizada.'

function driftRow(status: string, id: number) {
  return {
    managed_database_id: id,
    database_name: `db_${status}`,
    server_id: 3,
    server_name: 'srv-1',
    engine: status === 'not_applicable' ? 'postgresql' : 'mysql',
    environment_slug: null,
    charset: status === 'unknown' ? null : 'utf8mb4',
    collation: status === 'unknown' ? null : 'utf8mb4_0900_ai_ci',
    status,
    source_of_truth: status === 'unknown' ? 'unknown' : 'adopted',
  }
}

function mockDrift(declared: { charset: string | null; collation: string | null } | null = null) {
  server.use(
    http.get(`${BASE}/database-models/${MODEL_ID}/collation-drift`, () =>
      HttpResponse.json({
        data: {
          model_id: MODEL_ID,
          model_slug: 'tienda',
          declared,
          source: 'cached',
          source_note: NOTE,
          databases: [
            driftRow('ok', 51),
            driftRow('drifted', 52),
            driftRow('unknown', 53),
            driftRow('not_applicable', 54),
          ],
        },
      }),
    ),
  )
}

/**
 * `DataTable` renderiza cada fila DOS veces: la tabla (`md` para arriba) y una tarjeta por fila
 * (debajo de `md`), que es cómo el repo evita el scroll horizontal. En jsdom las dos existen a la
 * vez, así que toda consulta por texto de celda encuentra dos nodos. Mismo criterio que
 * `VersionsTable.test.tsx`.
 */
function primerNodo(texto: string | RegExp): HTMLElement {
  return screen.getAllByText(texto)[0]!
}

describe('CollationDriftPanel', () => {
  it('muestra el aviso de que es una caché, textual', async () => {
    mockDrift()
    renderWithProviders(<CollationDriftPanel modelId={MODEL_ID} />)
    expect(await screen.findByText(NOTE)).toBeInTheDocument()
  })

  it('`unknown` NO comparte etiqueta con `ok`', async () => {
    // Es la regla del contrato §6, y la razón es concreta: pintarlos igual le diría al operador
    // que todo está bien sobre bases de las que el inventario no sabe nada. Son afirmaciones
    // distintas, y la diferencia importa justo cuando se decide si convertir.
    mockDrift()
    renderWithProviders(<CollationDriftPanel modelId={MODEL_ID} />)

    await screen.findAllByText('Coincide')
    const coincide = primerNodo('Coincide')
    const sinDato = primerNodo('Sin dato')
    expect(coincide).toBeInTheDocument()
    expect(sinDato).toBeInTheDocument()
    // El tono es lo que se compara: si alguien "unifica" los dos estados, esto se pone rojo.
    expect(coincide.className).not.toBe(sinDato.className)
  })

  it('la fila sin dato no inventa una collation', async () => {
    mockDrift()
    renderWithProviders(<CollationDriftPanel modelId={MODEL_ID} />)
    await screen.findAllByText('db_unknown')
    const fila = primerNodo('db_unknown').closest('tr')
    expect(fila).not.toBeNull()
    expect(within(fila!).getByText('—')).toBeInTheDocument()
  })

  it('sin declaración, lo dice en vez de mostrar un vacío', async () => {
    mockDrift(null)
    renderWithProviders(<CollationDriftPanel modelId={MODEL_ID} />)
    expect(await screen.findByText(/Sin declarar\./i)).toBeInTheDocument()
  })

  it('con declaración, la muestra', async () => {
    mockDrift({ charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' })
    renderWithProviders(<CollationDriftPanel modelId={MODEL_ID} />)
    // La cabecera de "declarado" es única; las celdas de la tabla repiten el valor.
    const nodos = await screen.findAllByText(/utf8mb4_0900_ai_ci/)
    expect(nodos.length).toBeGreaterThan(0)
  })
})
