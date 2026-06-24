import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('habilita confirmar solo cuando se escribe la palabra exacta (doble confirmación)', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Eliminar base de datos"
        confirmWord="app_prod"
        confirmLabel="Eliminar"
      />,
    )

    const confirmButton = screen.getByRole('button', { name: 'Eliminar' })
    expect(confirmButton).toBeDisabled()

    const input = screen.getByLabelText(/escribe app_prod para confirmar/i)
    await user.type(input, 'app_prod')

    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('sin confirmWord, confirmar está disponible de inmediato', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Eliminar"
        confirmLabel="Eliminar"
      />,
    )
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeEnabled()
  })
})
