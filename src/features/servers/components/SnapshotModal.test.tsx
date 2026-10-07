import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { SnapshotModal } from './SnapshotModal'

const API = 'http://localhost/api/v1'

function mockSnapshot(statements: unknown[]) {
  server.use(
    http.get(`${API}/servers/1/databases/legacy/snapshot`, () =>
      HttpResponse.json({
        data: {
          database: 'legacy',
          source_engine: 'mysql',
          has_non_portable: true,
          statements,
        },
      }),
    ),
  )
}

describe('SnapshotModal: código oculto sin schema.definitions', () => {
  it('muestra el DDL de las tablas y «Contenido oculto» en los objetos redactados', async () => {
    mockSnapshot([
      { object_type: 'table', name: 'clientes', ddl: 'CREATE TABLE clientes (id INT)' },
      { object_type: 'view', name: 'v_top', ddl: '', redacted: true },
      { object_type: 'routine', name: 'sp_x', ddl: '', redacted: true },
    ])
    renderWithProviders(<SnapshotModal serverId={1} database="legacy" onClose={vi.fn()} />)

    await screen.findByText('Snapshot de legacy')
    // Los grupos son `<details>` cerrados: se abren para leer su contenido.
    for (const summary of await screen.findAllByText(/^(Tablas|Vistas|Rutinas) \(1\)/)) {
      await userEvent.click(summary)
    }
    // `CodeBlock` parte el SQL en tokens: se lee el texto del documento, no un nodo.
    await vi.waitFor(() => expect(document.body.textContent).toContain('CREATE TABLE clientes'))
    const notices = await screen.findAllByText(
      'Contenido oculto: tu rol no ve el código de este objeto',
    )
    expect(notices).toHaveLength(2)
  })

  it('sin objetos redactados no aparece ningún aviso', async () => {
    mockSnapshot([{ object_type: 'view', name: 'v_top', ddl: 'CREATE VIEW v_top AS SELECT 1' }])
    renderWithProviders(<SnapshotModal serverId={1} database="legacy" onClose={vi.fn()} />)

    await userEvent.click(await screen.findByText(/^Vistas \(1\)/))
    await vi.waitFor(() => expect(document.body.textContent).toContain('CREATE VIEW v_top'))
    expect(screen.queryByText(/Contenido oculto/)).not.toBeInTheDocument()
  })
})
