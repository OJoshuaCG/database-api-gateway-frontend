import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadioCardGroup } from './RadioCardGroup'

type Mode = 'family' | 'server'
type Family = 'mysql_mariadb' | 'postgresql'

const MODES = [
  { value: 'family' as Mode, label: 'Por motor', hint: 'BDs ya registradas en el inventario.' },
  { value: 'server' as Mode, label: 'Por servidor', hint: 'Incluye BDs sin registrar.' },
]

const FAMILIES = [
  { value: 'mysql_mariadb' as Family, label: 'MySQL / MariaDB' },
  { value: 'postgresql' as Family, label: 'PostgreSQL' },
]

/** Dos grupos en la misma pantalla: el caso que el componente existe para desambiguar. */
function TwoGroups() {
  const [mode, setMode] = useState<Mode | null>('family')
  const [family, setFamily] = useState<Family | null>(null)

  return (
    <>
      <RadioCardGroup<Mode>
        title="1. Modo de selección"
        description="Elige una de estas dos formas."
        options={MODES}
        value={mode}
        onChange={setMode}
      />
      <RadioCardGroup<Family>
        title="2. Motor"
        options={FAMILIES}
        value={family}
        onChange={setFamily}
      />
    </>
  )
}

describe('RadioCardGroup', () => {
  it('expone cada grupo por separado y la selección de uno no afecta al otro', async () => {
    const user = userEvent.setup()
    render(<TwoGroups />)

    // El `legend` nombra al grupo: son dos grupos distintos, no una lista de 4 opciones.
    expect(screen.getByRole('group', { name: /modo de selección/i })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /motor/i })).toBeInTheDocument()

    const porMotor = screen.getByRole('radio', { name: /por motor/i })
    const postgres = screen.getByRole('radio', { name: /postgresql/i })
    expect(porMotor).toBeChecked()
    expect(postgres).not.toBeChecked()

    // Marcar en el grupo 2 no desmarca el grupo 1: los `name` autogenerados no colisionan.
    await user.click(postgres)
    expect(postgres).toBeChecked()
    expect(porMotor).toBeChecked()
  })

  it('toda la tarjeta es clicable, no solo el radio', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <RadioCardGroup<Mode>
        title="Modo de selección"
        options={MODES}
        value="family"
        onChange={onChange}
      />,
    )

    // El hint vive dentro del `<label>`: al hacer click ahí también se selecciona la opción.
    await user.click(screen.getByText('Incluye BDs sin registrar.'))
    expect(onChange).toHaveBeenCalledWith('server')
  })

  it('liga el hint y la descripción del grupo al radio vía aria-describedby', () => {
    render(
      <RadioCardGroup<Mode>
        title="Modo de selección"
        description="Elige una de estas dos formas."
        options={MODES}
        value={null}
        onChange={() => {}}
      />,
    )

    const radio = screen.getByRole('radio', { name: /por servidor/i })
    expect(radio).toHaveAccessibleDescription(/incluye bds sin registrar/i)
    expect(radio).toHaveAccessibleDescription(/elige una de estas dos formas/i)
  })
})
