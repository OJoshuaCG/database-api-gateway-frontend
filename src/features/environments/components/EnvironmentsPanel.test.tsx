import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { environmentFixture, pageOf } from '@/test/fixtures/authz-catalog'
import { ENVIRONMENTS_WRITE_UNBLOCK } from '../messages'
import { EnvironmentsPanel } from './EnvironmentsPanel'

describe('EnvironmentsPanel', () => {
  it('dice quién escribe entornos y cómo desbloquearlo cuando nadie es security_officer', async () => {
    server.use(
      http.get('http://localhost/api/v1/environments', () =>
        HttpResponse.json(pageOf([environmentFixture(1, 'Desarrollo', 0)])),
      ),
    )
    renderWithProviders(<EnvironmentsPanel />)
    expect(await screen.findByText(ENVIRONMENTS_WRITE_UNBLOCK)).toBeVisible()
    expect(ENVIRONMENTS_WRITE_UNBLOCK).toContain('Usuarios → Accesos')
  })
})
