import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlWrapProvider } from './SqlWrapProvider'
import { SQL_WRAP_STORAGE_KEY } from './sql-wrap-context'
import { useSqlWrap } from './use-sql-wrap'

function Probe() {
  const { wrap, toggleWrap } = useSqlWrap()
  return (
    <button type="button" onClick={toggleWrap}>
      {wrap ? 'ajuste' : 'scroll'}
    </button>
  )
}

function renderProbe() {
  return render(
    <SqlWrapProvider>
      <Probe />
    </SqlWrapProvider>,
  )
}

afterEach(() => {
  delete document.documentElement.dataset.sqlWrap
})

describe('SqlWrapProvider', () => {
  it('envuelve las líneas por omisión', () => {
    renderProbe()
    expect(screen.getByRole('button', { name: 'ajuste' })).toBeInTheDocument()
    expect(document.documentElement.dataset.sqlWrap).toBe('on')
  })

  it('persiste el modo y lo recupera al volver a montar', async () => {
    const user = userEvent.setup()
    const { unmount } = renderProbe()

    await user.click(screen.getByRole('button', { name: 'ajuste' }))
    expect(document.documentElement.dataset.sqlWrap).toBe('off')
    expect(localStorage.getItem(SQL_WRAP_STORAGE_KEY)).toBe('off')

    unmount()
    renderProbe()
    expect(screen.getByRole('button', { name: 'scroll' })).toBeInTheDocument()
  })

  it('cae en el modo por omisión si lo almacenado no se reconoce', () => {
    localStorage.setItem(SQL_WRAP_STORAGE_KEY, 'basura')
    renderProbe()
    expect(screen.getByRole('button', { name: 'ajuste' })).toBeInTheDocument()
  })

  it('sigue funcionando si el almacenamiento no está disponible', async () => {
    // Navegación privada o cookies de terceros bloqueadas: `localStorage` lanza al leer y escribir.
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sin almacenamiento')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('sin almacenamiento')
    })

    renderProbe()
    await user.click(screen.getByRole('button', { name: 'ajuste' }))

    // La preferencia sigue viva en memoria aunque no se pueda guardar.
    expect(screen.getByRole('button', { name: 'scroll' })).toBeInTheDocument()
    expect(document.documentElement.dataset.sqlWrap).toBe('off')
  })

  it('exige el provider: el hook falla en seco si falta', () => {
    // El error se propaga al render; se silencia el ruido de React en la consola.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/SqlWrapProvider/)
    spy.mockRestore()
  })
})
