import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import { CharsetCollationSelector } from './CharsetCollationSelector'

/**
 * `enabled: false` en TanStack Query (family `null` u `overrideOptions` presente) NO dispara
 * ninguna petición: por eso cada test mockea `CATALOG_URL` igual, aunque algunos no dependan de
 * la respuesta — el `server.listen({ onUnhandledRequest: 'error' })` de `src/test/setup.ts`
 * haría fallar el test si alguna combinación llegara a pedirla de verdad.
 */
const CATALOG_URL = 'http://localhost/api/v1/charset-collation-options'

const suggested = {
  id: 1,
  engine_family: 'mysql' as const,
  charset: 'utf8mb4',
  collation: 'utf8mb4_unicode_ci',
  enabled: true,
  is_default: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const secondary = {
  id: 2,
  engine_family: 'mysql' as const,
  charset: 'latin1',
  collation: null,
  enabled: true,
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function mockCatalog(options: unknown[]) {
  server.use(http.get(CATALOG_URL, () => HttpResponse.json(options)))
}

function mockCatalogError() {
  server.use(http.get(CATALOG_URL, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
}

describe('CharsetCollationSelector', () => {
  it('sin motor elegido queda deshabilitado y avisa que hay que elegir servidor primero', () => {
    renderWithProviders(
      <CharsetCollationSelector engineFamily={null} value={undefined} onChange={vi.fn()} />,
    )
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByText('Elegí primero un servidor.')).toBeInTheDocument()
  })

  it('autopreselecciona la combinación is_default cuando el valor todavía no se decidió', async () => {
    mockCatalog([suggested, secondary])
    const onChange = vi.fn()
    renderWithProviders(
      <CharsetCollationSelector engineFamily="mysql" value={undefined} onChange={onChange} />,
    )
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
      }),
    )
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('autopreselecciona null cuando ninguna combinación es la sugerida', async () => {
    mockCatalog([{ ...suggested, is_default: false }, secondary])
    const onChange = vi.fn()
    renderWithProviders(
      <CharsetCollationSelector engineFamily="mysql" value={undefined} onChange={onChange} />,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('no vuelve a autopreseleccionar una vez que el consumidor ya tiene un valor para la familia', async () => {
    mockCatalog([suggested, secondary])
    const onChange = vi.fn()
    const { rerender } = renderWithProviders(
      <CharsetCollationSelector
        engineFamily="mysql"
        value={{ charset: 'latin1', collation: null }}
        onChange={onChange}
      />,
    )
    await screen.findByRole('button', { name: 'Abrir lista' })
    rerender(
      <CharsetCollationSelector
        engineFamily="mysql"
        value={{ charset: 'latin1', collation: null }}
        onChange={onChange}
      />,
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('value=null se muestra seleccionado como "usar el valor por defecto del motor"', () => {
    mockCatalog([suggested, secondary])
    renderWithProviders(
      <CharsetCollationSelector engineFamily="mysql" value={null} onChange={vi.fn()} />,
    )
    expect(screen.getByRole('textbox')).toHaveValue('Usar el valor por defecto del motor')
  })

  it('lista las combinaciones del catálogo y marca la sugerida', async () => {
    mockCatalog([suggested, secondary])
    const user = userEvent.setup()
    renderWithProviders(
      <CharsetCollationSelector engineFamily="mysql" value={null} onChange={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'Abrir lista' }))
    expect(await screen.findByText('utf8mb4 · utf8mb4_unicode_ci ⭐ sugerida')).toBeInTheDocument()
    expect(screen.getByText('latin1 — (collation por defecto del motor)')).toBeInTheDocument()
  })

  it('un value que no está en la lista actual no rompe: queda sin selección', () => {
    mockCatalog([suggested, secondary])
    renderWithProviders(
      <CharsetCollationSelector
        engineFamily="mysql"
        value={{ charset: 'ascii', collation: null }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('sin combinaciones habilitadas avisa pero no deshabilita el selector', async () => {
    mockCatalog([])
    renderWithProviders(
      <CharsetCollationSelector engineFamily="postgresql" value={null} onChange={vi.fn()} />,
    )
    expect(
      await screen.findByText(
        'No hay combinaciones habilitadas para este motor. La base se creará con el valor por defecto del servidor.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeEnabled()
  })

  it('en error de carga solo ofrece el valor por defecto del motor, sin bloquear el formulario', async () => {
    mockCatalogError()
    const user = userEvent.setup()
    renderWithProviders(
      <CharsetCollationSelector engineFamily="mysql" value={null} onChange={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Abrir lista' }))
    expect(screen.getByText('Usar el valor por defecto del motor')).toBeInTheDocument()
    expect(screen.queryByText('utf8mb4 · utf8mb4_unicode_ci ⭐ sugerida')).not.toBeInTheDocument()
  })

  it('con overrideOptions ignora la query normal y muestra la nota de lista actualizada', async () => {
    mockCatalog([suggested, secondary])
    const user = userEvent.setup()
    renderWithProviders(
      <CharsetCollationSelector
        engineFamily="postgresql"
        value={null}
        onChange={vi.fn()}
        overrideOptions={[{ charset: 'UTF8', collation: null, isDefault: true }]}
      />,
    )
    expect(
      screen.getByText('Lista actualizada con las combinaciones disponibles.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Abrir lista' }))
    expect(
      screen.getByText('UTF8 — (collation por defecto del motor) ⭐ sugerida'),
    ).toBeInTheDocument()
    expect(screen.queryByText('utf8mb4 · utf8mb4_unicode_ci ⭐ sugerida')).not.toBeInTheDocument()
  })

  it('respeta el hint externo por sobre los mensajes fijos del selector', () => {
    mockCatalog([])
    renderWithProviders(
      <CharsetCollationSelector
        engineFamily={null}
        value={undefined}
        onChange={vi.fn()}
        hint="Aviso propio del formulario"
      />,
    )
    expect(screen.getByText('Aviso propio del formulario')).toBeInTheDocument()
    expect(screen.queryByText('Elegí primero un servidor.')).not.toBeInTheDocument()
  })
})
