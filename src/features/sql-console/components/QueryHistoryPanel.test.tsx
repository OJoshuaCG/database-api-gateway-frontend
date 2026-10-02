import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { QueryHistoryPanel } from './QueryHistoryPanel'

const SERVER_ID = 7
const HISTORY_URL = `http://localhost/api/v1/servers/${SERVER_ID}/query/history`

const baseEntry = {
  id: 501,
  server_id: SERVER_ID,
  database_name: 'ventas',
  engine: 'mysql',
  admin_username: 'admin',
  connection_mode: 'stored',
  run_as_username: 'app_rw',
  impersonated_role: null,
  sql_text: "INSERT INTO clientes (email) VALUES ('ana@example.com')",
  danger_level: 'write',
  statement_count: 1,
  status: 'error',
  read_only: false,
  dry_run: false,
  committed: false,
  rows_returned: 0,
  rows_affected: 0,
  duration_ms: 12,
  error_code: '1062',
  error_message: "(1062) Duplicate entry '?' for key 'clientes.email'",
  created_at: '2026-10-01T10:00:00Z',
}

function mockHistory(entry: Record<string, unknown>) {
  server.use(
    http.get(HISTORY_URL, () =>
      HttpResponse.json({
        data: [entry],
        pagination: { page: 1, size: 20, total: 1, pages: 1, has_next: false, has_prev: false },
      }),
    ),
  )
}

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  const [viewButton] = await screen.findAllByRole('button', { name: 'Ver SQL' })
  await user.click(viewButton!)
  return screen.findByRole('dialog')
}

describe('QueryHistoryPanel — SQL enmascarado', () => {
  it('fila enmascarada: muestra «Valores ocultos» y deshabilita «Cargar en el editor»', async () => {
    mockHistory({
      ...baseEntry,
      sql_text: 'INSERT INTO clientes (email) VALUES (?)',
      sql_masked: true,
    })
    const onLoadInEditor = vi.fn()
    renderWithProviders(<QueryHistoryPanel serverId={SERVER_ID} onLoadInEditor={onLoadInEditor} />)

    expect((await screen.findAllByText('Valores ocultos')).length).toBeGreaterThan(0)
    const loadButtons = screen.getAllByRole('button', { name: 'Cargar en el editor' })
    for (const button of loadButtons) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(/Valores ocultos/)
    }
  })

  it('detalle enmascarado: explica por qué y no permite cargar en el editor', async () => {
    const user = userEvent.setup()
    mockHistory({
      ...baseEntry,
      sql_text: 'INSERT INTO clientes (email) VALUES (?)',
      sql_masked: true,
    })
    const onLoadInEditor = vi.fn()
    renderWithProviders(<QueryHistoryPanel serverId={SERVER_ID} onLoadInEditor={onLoadInEditor} />)

    const dialog = await openDetail(user)
    expect(
      within(dialog).getByText(/Los valores se ocultan porque no tenés permiso para ejecutar/),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(/recortado a 16 KB/)).not.toBeInTheDocument()
    const load = within(dialog).getByRole('button', { name: 'Cargar en el editor' })
    expect(load).toBeDisabled()
    expect(load).toHaveAccessibleDescription(/Los valores se ocultan/)
    expect(onLoadInEditor).not.toHaveBeenCalled()
  })

  it('fila sin enmascarar: «Cargar en el editor» habilitado y la nota de siempre', async () => {
    const user = userEvent.setup()
    // Sin `sql_masked`: un backend anterior al campo. El contrato lo toma como `false`.
    mockHistory(baseEntry)
    const onLoadInEditor = vi.fn()
    renderWithProviders(<QueryHistoryPanel serverId={SERVER_ID} onLoadInEditor={onLoadInEditor} />)

    const [rowLoad] = await screen.findAllByRole('button', { name: 'Cargar en el editor' })
    expect(rowLoad).toBeEnabled()
    expect(screen.queryByText('Valores ocultos')).not.toBeInTheDocument()

    const dialog = await openDetail(user)
    expect(within(dialog).getByText(/recortado a 16 KB/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Los valores se ocultan/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cargar en el editor' }))
    expect(onLoadInEditor).toHaveBeenCalledWith(expect.objectContaining({ id: 501 }))
  })
})
