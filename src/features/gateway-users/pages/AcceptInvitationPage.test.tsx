import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { renderWithProviders } from '@/test/utils'
import { AcceptInvitationPage } from './AcceptInvitationPage'

/** Pinta la dirección actual, para poder afirmar sobre ella desde el test. */
function LocationProbe() {
  const location = useLocation()
  return <output aria-label="ubicación">{`${location.pathname}${location.search}`}</output>
}

describe('AcceptInvitationPage — el token no se queda en la URL', () => {
  it('lo saca de la dirección apenas lo lee y lo conserva en el formulario', async () => {
    renderWithProviders(
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
      { route: '/invitacion?token=tok_secreto_123456' },
    )
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'ubicación' })).toHaveTextContent(/^\/invitacion$/),
    )
    // Se quitó de la URL pero no se perdió: el campo lo sigue teniendo para enviarlo.
    expect(screen.getByLabelText(/Token de invitación/)).toHaveValue('tok_secreto_123456')
  })
})
