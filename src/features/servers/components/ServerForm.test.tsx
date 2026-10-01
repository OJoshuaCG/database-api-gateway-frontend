import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { REBIND_MESSAGE, type RebindBaseline } from '../server-rebind'
import { ServerForm, type ServerFormValues } from './ServerForm'

const original: RebindBaseline = {
  host: 'db.empresa.com',
  port: 3306,
  engine: 'mysql',
  ssl_mode: 'require',
}

const defaults: Partial<ServerFormValues> = {
  name: 'Producción',
  ...original,
  root_username: 'gateway_admin',
  root_password: '',
  notes: '',
  is_active: true,
}

function renderEdit(onSubmit = vi.fn()) {
  renderWithProviders(
    <ServerForm
      mode="edit"
      defaultValues={defaults}
      original={original}
      onSubmit={onSubmit}
      onCancel={() => undefined}
    />,
  )
  return onSubmit
}

describe('ServerForm — re-apuntar el servidor exige la contraseña', () => {
  it('sin cambios de destino la contraseña sigue siendo opcional', async () => {
    const onSubmit = renderEdit()
    expect(screen.getByText('Déjalo en blanco para no cambiarla.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('al cambiar el host avisa en vivo y no envía sin contraseña', async () => {
    const onSubmit = renderEdit()
    const host = screen.getByLabelText(/Host/)
    await userEvent.clear(host)
    await userEvent.type(host, 'otro.empresa.com')

    // El aviso aparece antes de enviar, con el campo que lo disparó.
    expect(screen.getByText(`${REBIND_MESSAGE} Cambiaste: host.`)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('con la contraseña reingresada sí envía', async () => {
    const onSubmit = renderEdit()
    const host = screen.getByLabelText(/Host/)
    await userEvent.clear(host)
    await userEvent.type(host, 'otro.empresa.com')
    await userEvent.type(screen.getByLabelText(/Contraseña root/), 'nueva-clave')

    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      host: 'otro.empresa.com',
      root_password: 'nueva-clave',
    })
  })

  it('`requirePassword` (el 422 del backend) marca y enfoca la contraseña', async () => {
    const onSubmit = renderEdit(
      vi.fn((_values: ServerFormValues, form: { requirePassword: (m: string) => void }) =>
        form.requirePassword('mensaje del 422'),
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('mensaje del 422')).toBeInTheDocument()
    expect(screen.getByLabelText(/Contraseña root/)).toHaveFocus()
  })
})
