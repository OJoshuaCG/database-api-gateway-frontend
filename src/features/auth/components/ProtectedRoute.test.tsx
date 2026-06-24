import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { ProtectedRoute } from './ProtectedRoute'

function renderRoutes() {
  return renderWithProviders(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div>Contenido protegido</div>} />
      </Route>
      <Route path="/login" element={<div>Pantalla de login</div>} />
    </Routes>,
    { route: '/' },
  )
}

describe('ProtectedRoute', () => {
  it('renderiza el contenido cuando hay sesión válida', async () => {
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({ data: { id: 1, username: 'admin' } }),
      ),
    )
    renderRoutes()
    expect(await screen.findByText('Contenido protegido')).toBeInTheDocument()
  })

  it('redirige a login ante un 401', async () => {
    server.use(
      http.get('http://localhost/api/v1/auth/me', () =>
        HttpResponse.json({ detail: 'No autenticado' }, { status: 401 }),
      ),
    )
    renderRoutes()
    await waitFor(() => expect(screen.getByText('Pantalla de login')).toBeInTheDocument())
  })
})
