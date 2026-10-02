import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { meFixture } from '@/test/fixtures/authz-catalog'
import { formatSodInstant } from '../separation-of-duties'
import { SodWarningsBanner } from './SodWarningsBanner'

const API = 'http://localhost/api/v1'

function mockMe(sodWarnings?: unknown) {
  let requests = 0
  server.use(
    http.get(`${API}/auth/me`, () => {
      requests += 1
      const me = meFixture({ role: 'owner', global_capabilities: ['security_officer'] })
      return HttpResponse.json({
        data: sodWarnings === undefined ? me : { ...me, sod_warnings: sodWarnings },
      })
    }),
  )
  return { requests: () => requests }
}

const WARNING = {
  rule: 'owner_security_officer',
  reason: null,
  since: null,
  expires_at: null,
}

describe('SodWarningsBanner', () => {
  it('heredada: pide que se separen las funciones, sin poder cerrarse', async () => {
    mockMe([
      {
        ...WARNING,
        status: 'grandfathered',
        reason: 'grandfathered',
        since: '2026-10-02T10:00:00',
      },
    ])
    renderWithProviders(<SodWarningsBanner />)
    expect(
      await screen.findByText(
        /Tu cuenta combina funciones que deberían estar separadas \(oficial de seguridad y owner\)\..*Pedí que se separen/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('override: muestra cuándo vence y el motivo declarado', async () => {
    mockMe([
      {
        ...WARNING,
        status: 'override',
        reason: 'Incidente 4711: no hay otro security_officer',
        since: '2026-10-02T10:00:00',
        expires_at: '2026-10-03T10:00:00',
      },
    ])
    renderWithProviders(<SodWarningsBanner />)
    expect(
      await screen.findByText('Tu cuenta tiene una excepción de emergencia'),
    ).toBeInTheDocument()
    const body = screen.getByText(/excepción de emergencia que rige hasta el/)
    expect(body).toHaveTextContent(formatSodInstant('2026-10-03T10:00:00'))
    expect(body).toHaveTextContent('Incidente 4711')
  })

  it('neutralizada: explica que las funciones de oficial de seguridad están desactivadas', async () => {
    mockMe([{ ...WARNING, rule: 'access_admin_security_officer', status: 'neutralized' }])
    renderWithProviders(<SodWarningsBanner />)
    expect(
      await screen.findByText('Tus funciones de oficial de seguridad están desactivadas'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/oficial de seguridad y administración de accesos sin ninguna excepción/),
    ).toBeInTheDocument()
  })

  it('sin avisos —o con un backend que no manda el campo— no pinta nada', async () => {
    for (const warnings of [[], undefined]) {
      const backend = mockMe(warnings)
      const { unmount } = renderWithProviders(<SodWarningsBanner />)
      await waitFor(() => expect(backend.requests()).toBeGreaterThan(0))
      // El contenedor también trae la región de toasts: se mira que no haya ningún aviso.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText(/separadas|oficial de seguridad/)).not.toBeInTheDocument()
      unmount()
    }
  })
})
