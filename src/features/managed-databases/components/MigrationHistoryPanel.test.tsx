import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { MigrationHistoryPanel } from './MigrationHistoryPanel'

/**
 * Lo que se prueba acá es la TOLERANCIA del historial a lo que v25 dejó incompleto.
 *
 * Una fila anterior a esa entrega trae `direction`, `version`, `model_migration_id`, el actor, el
 * checksum y el `request_id` todos en `null`, y tiene que leerse igual de bien que una nueva: sin
 * huecos rotos, sin ocultarse y —sobre todo— sin que la UI invente que fue una aplicación.
 *
 * `DataTable` renderiza cada fila DOS veces (tabla desde `md`, tarjeta por debajo), que es cómo el
 * repo evita el scroll horizontal. En jsdom conviven las dos, así que toda consulta por texto de
 * celda encuentra dos nodos: se usa `getAllBy*`.
 */

const BASE = 'http://localhost/api/v1'
const DB_ID = 42

/** Fila «nueva»: todo lo que v25 agregó, registrado. */
const nueva = {
  id: 2,
  managed_database_id: DB_ID,
  model_migration_id: 12,
  version: '0012',
  applied_at: '2026-03-02T10:00:00Z',
  status: 'applied',
  error: null,
  execution_ms: 1500,
  direction: 'down',
  applied_checksum: 'abc123def456',
  actor_type: 'admin',
  actor_id: 3,
  actor_username: 'ana',
  request_id: 'req-nuevo-1',
}

/** Fila «antigua»: todos los campos nuevos en `null`. */
const antigua = {
  id: 1,
  managed_database_id: DB_ID,
  model_migration_id: null,
  version: null,
  applied_at: '2026-01-05T08:30:00Z',
  status: 'failed',
  error: 'ERROR 1064 (42000): You have an error in your SQL syntax',
  direction: null,
  applied_checksum: null,
  actor_type: null,
  actor_id: null,
  actor_username: null,
  request_id: null,
}

function mockHistory(items: unknown[]) {
  server.use(
    http.get(`${BASE}/managed-databases/${DB_ID}/migrations/history`, () =>
      HttpResponse.json({
        data: items,
        pagination: {
          page: 1,
          size: 10,
          total: items.length,
          pages: 1,
          has_next: false,
          has_prev: false,
        },
      }),
    ),
  )
}

describe('MigrationHistoryPanel', () => {
  it('no inventa la dirección de una fila antigua y avisa de la consecuencia', async () => {
    mockHistory([antigua, nueva])
    renderWithProviders(<MigrationHistoryPanel dbId={DB_ID} />)

    expect((await screen.findAllByText('Sin registrar')).length).toBeGreaterThan(0)
    expect(screen.getByText(/no prueba que la versión siga vigente/i)).toBeInTheDocument()
    // La dirección registrada sí se nombra, y NO como «Aplicada».
    expect(screen.getAllByText('Revertida').length).toBeGreaterThan(0)
  })

  it('el aviso desaparece cuando todas las filas registran la dirección', async () => {
    mockHistory([nueva])
    renderWithProviders(<MigrationHistoryPanel dbId={DB_ID} />)

    await screen.findAllByText('Revertida')
    expect(screen.queryByText(/no prueba que la versión siga vigente/i)).not.toBeInTheDocument()
  })

  it('muestra la fila cuya versión se borró del blueprint, sin atenuarla', async () => {
    // Con la FK en `null`, la versión y el checksum aplicado son lo único que queda del evento.
    mockHistory([antigua])
    renderWithProviders(<MigrationHistoryPanel dbId={DB_ID} />)

    expect((await screen.findAllByText('Versión borrada')).length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('La versión de este evento no se pudo determinar').length,
    ).toBeGreaterThan(0)
    // Y el resultado va en español, derivado — no el `failed` crudo del contrato.
    expect(screen.getAllByText('Fallida').length).toBeGreaterThan(0)
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
  })

  it('el detalle de una fila antigua se abre sin huecos rotos', async () => {
    mockHistory([antigua])
    renderWithProviders(<MigrationHistoryPanel dbId={DB_ID} />)

    const botones = await screen.findAllByRole('button', { name: 'Ver detalle' })
    await userEvent.click(botones[0]!)

    const dialogo = within(screen.getByRole('dialog'))
    expect(dialogo.getByText('Detalle del evento')).toBeInTheDocument()
    expect(dialogo.getByText(/ERROR 1064/)).toBeInTheDocument()
    expect(dialogo.getByText('Checksum aplicado')).toBeInTheDocument()
    expect(dialogo.getByText('ID de solicitud')).toBeInTheDocument()
    expect(dialogo.getByText('Quién').parentElement).toHaveTextContent('—')
    // Sin `request_id` no hay nada que copiar: el botón no se ofrece.
    expect(
      dialogo.queryByRole('button', { name: 'Copiar ID de solicitud' }),
    ).not.toBeInTheDocument()
  })

  it('ofrece copiar el ID de solicitud cuando la fila lo trae', async () => {
    mockHistory([nueva])
    renderWithProviders(<MigrationHistoryPanel dbId={DB_ID} />)

    const botones = await screen.findAllByRole('button', { name: 'Ver detalle' })
    await userEvent.click(botones[0]!)

    const dialogo = within(screen.getByRole('dialog'))
    expect(dialogo.getByText('req-nuevo-1')).toBeInTheDocument()
    expect(dialogo.getByRole('button', { name: 'Copiar ID de solicitud' })).toBeInTheDocument()
    expect(dialogo.getByText('abc123def456')).toBeInTheDocument()
  })

  it('sin eventos muestra el estado vacío', async () => {
    mockHistory([])
    renderWithProviders(<MigrationHistoryPanel dbId={DB_ID} />)

    expect(
      await screen.findByText('Esta base no tiene historial de migraciones.'),
    ).toBeInTheDocument()
  })
})
