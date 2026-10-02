import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import type { ServerOut } from '@/lib/contracts'
import { DeleteServerDialog } from './DeleteServerDialog'

const API = 'http://localhost/api/v1'

const SERVER: ServerOut = {
  id: 42,
  name: 'mysql-prod',
  host: 'db.example.com',
  port: 3306,
  engine: 'mysql',
  root_username: 'gateway_root',
  ssl_mode: 'require',
  status: 'active',
  is_active: true,
  notes: null,
  has_root_password: true,
  created_at: '2026-06-23T10:00:00Z',
  updated_at: '2026-06-23T10:00:00Z',
}

describe('DeleteServerDialog', () => {
  it('ante el 409 `access.scope_has_grants` explica qué accesos bloquean y no deja reintentar', async () => {
    server.use(
      http.delete(`${API}/servers/42`, () =>
        HttpResponse.json(
          {
            detail: {
              msg: 'El servidor tiene accesos otorgados (2 por alcance, 1 capacidades puntuales vivas).',
              type: 'AppHttpException',
              public_context: {
                code: 'access.scope_has_grants',
                access_grant_count: 2,
                capability_grant_count: 1,
              },
            },
          },
          { status: 409 },
        ),
      ),
    )
    const onClose = vi.fn()
    renderWithProviders(<DeleteServerDialog server={SERVER} onClose={onClose} />)

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }))

    const expected =
      'No se puede borrar: 2 permisos por alcance y 1 capacidad puntual todavía apuntan a este servidor. Quitáselos primero desde la página de accesos de cada usuario.'
    expect(await within(dialog).findByText(expected)).toBeInTheDocument()
    // Reintentar no lo arregla: el botón queda deshabilitado y el diálogo sigue abierto.
    expect(within(dialog).getByRole('button', { name: 'Eliminar' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
