import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { SecondApproverBadge } from './SecondApproverBadge'

const API = 'http://localhost/api/v1'
const NOTE = '(se aplica directo durante la ventana de arranque)'

function mockMe(open: boolean | null) {
  let requests = 0
  server.use(
    http.get(`${API}/auth/me`, () => {
      requests += 1
      const me = meFixture({ role: 'viewer', global_capabilities: ['access_admin'] })
      return HttpResponse.json({
        data: {
          ...me,
          bootstrap_window: open === null ? null : { open, closes_at: '2026-10-05T17:00:00' },
        },
      })
    }),
  )
  return { requests: () => requests }
}

describe('SecondApproverBadge', () => {
  it('con la ventana abierta suma la nota junto al distintivo', async () => {
    mockMe(true)
    renderWithProviders(<SecondApproverBadge />)
    expect(await screen.findByText(NOTE)).toBeInTheDocument()
    expect(screen.getByText('Requiere segundo aprobador')).toBeInTheDocument()
  })

  it('sin ventana, cerrada o con la nota desactivada: solo el distintivo', async () => {
    for (const [open, bootstrapNote] of [
      [null, true],
      [false, true],
      [true, false],
    ] as const) {
      const backend = mockMe(open)
      const { unmount } = renderWithProviders(<SecondApproverBadge bootstrapNote={bootstrapNote} />)
      await waitFor(() => expect(backend.requests()).toBeGreaterThan(0))
      expect(screen.getByText('Requiere segundo aprobador')).toBeInTheDocument()
      expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
      unmount()
    }
  })
})
