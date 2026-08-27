import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { VersionAlertsBar } from './VersionAlertsBar'
import type { VersionAlerts } from '../version-alerts'

const alerts = (overrides: Partial<VersionAlerts> = {}): VersionAlerts => ({
  unreviewed: [],
  withoutRollback: [],
  diverged: [],
  frozen: [],
  ...overrides,
})

describe('VersionAlertsBar', () => {
  it('no se renderiza si no hay nada que avisar', () => {
    const { container } = renderWithProviders(
      <VersionAlertsBar alerts={alerts()} selectedVersion={null} onSelect={vi.fn()} />,
    )
    // Un «0 sin revisar» no es información: ocuparía la primera pantalla para decir que todo está
    // bien.
    expect(container).toBeEmptyDOMElement()
  })

  it('cuenta las versiones de cada aviso', () => {
    renderWithProviders(
      <VersionAlertsBar
        alerts={alerts({ unreviewed: ['0002'], withoutRollback: ['0001', '0002', '0003'] })}
        selectedVersion={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '1 sin revisar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 sin rollback' })).toBeInTheDocument()
  })

  it('va cerrada: la lista de versiones no se pinta hasta que se pide', () => {
    renderWithProviders(
      <VersionAlertsBar
        alerts={alerts({ withoutRollback: ['0001'] })}
        selectedVersion={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByText('0001')).not.toBeInTheDocument()
  })

  it('al desplegar muestra las versiones Y la consecuencia, no solo la lista', async () => {
    // Sin la consecuencia, «3 sin rollback» es una etiqueta: lo que la vuelve accionable es saber
    // que un rollback que las atraviese falla con 409 para todo el camino.
    const user = userEvent.setup()
    renderWithProviders(
      <VersionAlertsBar
        alerts={alerts({ withoutRollback: ['0001', '0003'] })}
        selectedVersion={null}
        onSelect={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: '2 sin rollback' }))
    expect(screen.getByText(/falla con 409, para todo el camino/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0001' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0003' })).toBeInTheDocument()
  })

  it('pulsar una versión de la lista la selecciona', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <VersionAlertsBar
        alerts={alerts({ unreviewed: ['0004'] })}
        selectedVersion={null}
        onSelect={onSelect}
      />,
    )
    await user.click(screen.getByRole('button', { name: '1 sin revisar' }))
    await user.click(screen.getByRole('button', { name: '0004' }))
    expect(onSelect).toHaveBeenCalledWith('0004')
  })

  it('solo un aviso abierto a la vez: dos listas abiertas vuelven a ser la tabla', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VersionAlertsBar
        alerts={alerts({ unreviewed: ['0002'], withoutRollback: ['0001'] })}
        selectedVersion={null}
        onSelect={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: '1 sin revisar' }))
    expect(screen.getByRole('button', { name: '0002' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '1 sin rollback' }))
    expect(screen.queryByRole('button', { name: '0002' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0001' })).toBeInTheDocument()
  })

  it('marca la versión que se está mirando dentro de la lista', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VersionAlertsBar
        alerts={alerts({ withoutRollback: ['0001', '0002'] })}
        selectedVersion="0002"
        onSelect={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: '2 sin rollback' }))
    expect(screen.getByRole('button', { name: '0002' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: '0001' })).not.toHaveAttribute('aria-current')
  })
})
