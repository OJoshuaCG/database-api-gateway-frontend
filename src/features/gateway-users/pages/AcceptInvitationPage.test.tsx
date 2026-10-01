import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router-dom'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { AcceptInvitationPage } from './AcceptInvitationPage'

const API = 'http://localhost/api/v1'

/** Pinta la dirección actual, para poder afirmar sobre ella desde el test. */
function LocationProbe() {
  const location = useLocation()
  return (
    <output aria-label="ubicación">{`${location.pathname}${location.search}${location.hash}`}</output>
  )
}

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/invitacion"
        element={
          <>
            <AcceptInvitationPage />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { route },
  )
}

/** Captura el cuerpo del POST de aceptación. */
function captureAccept(): { body: Record<string, unknown> | null } {
  const captured: { body: Record<string, unknown> | null } = { body: null }
  server.use(
    http.post(`${API}/gateway-users/invite/accept`, async ({ request }) => {
      captured.body = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ data: { username: 'ana' } })
    }),
  )
  return captured
}

async function fillPasswordAndSubmit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/Contraseña nueva/), 'una-clave-larga-123')
  await user.type(screen.getByLabelText(/Repetí la contraseña/), 'una-clave-larga-123')
  await user.click(screen.getByRole('button', { name: 'Establecer contraseña' }))
}

describe('AcceptInvitationPage — el token no se queda en la URL', () => {
  it('lee el fragmento, lo saca de la dirección y lo conserva en el formulario', async () => {
    renderAt('/invitacion#token=tok_secreto_123456')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'ubicación' })).toHaveTextContent(/^\/invitacion$/),
    )
    // Se quitó de la URL pero no se perdió: el campo lo sigue teniendo para enviarlo.
    expect(screen.getByLabelText(/Token de invitación/)).toHaveValue('tok_secreto_123456')
    expect(screen.getByText(/Si recargás, volvé a abrir el enlace/)).toBeInTheDocument()
  })

  it('acepta todavía el enlace viejo con ?token= y también lo quita', async () => {
    renderAt('/invitacion?token=tok_viejo_123456')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'ubicación' })).toHaveTextContent(/^\/invitacion$/),
    )
    expect(screen.getByLabelText(/Token de invitación/)).toHaveValue('tok_viejo_123456')
  })

  it('al enviar, el token viaja en el cuerpo del POST', async () => {
    const captured = captureAccept()
    renderAt('/invitacion#token=tok_secreto_123456')
    await fillPasswordAndSubmit()
    expect(await screen.findByText('Contraseña establecida')).toBeInTheDocument()
    expect(captured.body).toEqual({ token: 'tok_secreto_123456', password: 'una-clave-larga-123' })
  })

  it('un enlace completo pegado en el campo manda solo el token', async () => {
    const captured = captureAccept()
    renderAt('/invitacion')
    const user = userEvent.setup()
    await user.type(
      screen.getByLabelText(/Token de invitación/),
      'https://gateway.example.com/invitacion#token=tok_pegado_123456',
    )
    await fillPasswordAndSubmit()
    await screen.findByText('Contraseña establecida')
    expect(captured.body).toMatchObject({ token: 'tok_pegado_123456' })
  })
})
