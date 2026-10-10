import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IntegrationScopeCeilingEntry } from '@/lib/contracts'
import { IntegrationScopesPicker } from './IntegrationScopesPicker'

const READ_ENTRY: IntegrationScopeCeilingEntry = {
  scope: 'servers.list',
  label: 'Listar servidores permitidos',
  mutates: false,
  tier: 'read',
}
const WRITE_ENTRY: IntegrationScopeCeilingEntry = {
  scope: 'databases.create',
  label: 'Crear una base de datos',
  mutates: true,
  tier: 'write',
}
const ROLLBACK_ENTRY: IntegrationScopeCeilingEntry = {
  scope: 'migrations.rollback',
  label: 'Revertir migraciones (puede borrar datos de forma irreversible)',
  mutates: true,
  tier: 'destructive',
}
const STAMP_ENTRY: IntegrationScopeCeilingEntry = {
  scope: 'migrations.stamp',
  label: 'Marcar una versión de migración sin ejecutar SQL',
  mutates: true,
  tier: 'destructive',
}

interface HarnessProps {
  ceilingScopes: IntegrationScopeCeilingEntry[]
  initialValue?: string[]
  suspendedScopes?: string[]
}

/** El selector es controlado: este arnés hace de formulario. */
function Harness({ ceilingScopes, initialValue = [], suspendedScopes }: HarnessProps) {
  const [value, setValue] = useState<string[]>(initialValue)
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <>
      <IntegrationScopesPicker
        ceilingScopes={ceilingScopes}
        maxDestructiveTtlDays={7}
        value={value}
        onChange={setValue}
        suspendedScopes={suspendedScopes}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        description="Ayuda"
      />
      <output data-testid="value">{value.join(',')}</output>
      <output data-testid="acknowledged">{String(acknowledged)}</output>
    </>
  )
}

describe('IntegrationScopesPicker — grupos por tier', () => {
  it('agrupa en Lectura, Escritura y Destructivas con el tier que informó el servidor', () => {
    render(<Harness ceilingScopes={[ROLLBACK_ENTRY, WRITE_ENTRY, READ_ENTRY]} />)
    expect(screen.getByText('Lectura')).toBeInTheDocument()
    expect(screen.getByText('Escritura')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Destructivas/ })).toBeInTheDocument()
  })

  it('renderiza SOLO los scopes del techo: lo que el usuario no tiene no aparece ni deshabilitado', () => {
    render(<Harness ceilingScopes={[READ_ENTRY]} />)
    expect(screen.getByRole('checkbox', { name: /Listar servidores permitidos/ })).toBeEnabled()
    expect(screen.queryByText('Escritura')).not.toBeInTheDocument()
    expect(screen.queryByText(/Crear una base de datos/)).not.toBeInTheDocument()
    // Sin scopes destructivos en el techo no se dibuja ni el encabezado del grupo.
    expect(screen.queryByRole('button', { name: /Destructivas/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Revertir migraciones/)).not.toBeInTheDocument()
  })

  it('seleccionar y quitar un scope actualiza la lista', async () => {
    const user = userEvent.setup()
    render(<Harness ceilingScopes={[READ_ENTRY, WRITE_ENTRY]} />)

    await user.click(screen.getByRole('checkbox', { name: /Listar servidores permitidos/ }))
    await user.click(screen.getByRole('checkbox', { name: /Crear una base de datos/ }))
    expect(screen.getByTestId('value')).toHaveTextContent('servers.list,databases.create')

    await user.click(screen.getByRole('checkbox', { name: /Listar servidores permitidos/ }))
    expect(screen.getByTestId('value')).toHaveTextContent('databases.create')
  })
})

describe('IntegrationScopesPicker — grupo destructivo', () => {
  it('está plegado por defecto: sus scopes no se ven hasta abrirlo', async () => {
    const user = userEvent.setup()
    render(<Harness ceilingScopes={[READ_ENTRY, ROLLBACK_ENTRY, STAMP_ENTRY]} />)

    const toggle = screen.getByRole('button', { name: /Destructivas/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox', { name: /Revertir migraciones/ })).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('checkbox', { name: /Revertir migraciones/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Marcar una versión/ })).toBeInTheDocument()
  })

  it('arranca abierto si el token ya tiene un scope destructivo', () => {
    render(
      <Harness
        ceilingScopes={[READ_ENTRY, ROLLBACK_ENTRY]}
        initialValue={['migrations.rollback']}
      />,
    )
    expect(screen.getByRole('button', { name: /Destructivas/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('elegir un scope destructivo muestra el aviso con el tope del servidor y la confirmación', async () => {
    const user = userEvent.setup()
    render(<Harness ceilingScopes={[READ_ENTRY, ROLLBACK_ENTRY]} />)
    expect(screen.queryByText(/El token vencerá en 7 días como máximo/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Destructivas/ }))
    await user.click(screen.getByRole('checkbox', { name: /Revertir migraciones/ }))

    expect(screen.getByText('Operaciones destructivas')).toBeInTheDocument()
    expect(screen.getByText(/El token vencerá en 7 días como máximo/)).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', {
        name: 'Entiendo que una integración podrá revertir migraciones y perder datos.',
      }),
    ).not.toBeChecked()
  })

  it('al quitar el último scope destructivo desaparece el aviso y se reinicia la confirmación', async () => {
    const user = userEvent.setup()
    render(<Harness ceilingScopes={[READ_ENTRY, ROLLBACK_ENTRY]} />)

    await user.click(screen.getByRole('button', { name: /Destructivas/ }))
    await user.click(screen.getByRole('checkbox', { name: /Revertir migraciones/ }))
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Entiendo que una integración podrá revertir migraciones y perder datos.',
      }),
    )
    expect(screen.getByTestId('acknowledged')).toHaveTextContent('true')

    await user.click(screen.getByRole('checkbox', { name: /Revertir migraciones/ }))
    expect(screen.queryByText(/El token vencerá en 7 días como máximo/)).not.toBeInTheDocument()
    // Si vuelve a elegirlo tiene que volver a aceptar: la confirmación no se arrastra.
    expect(screen.getByTestId('acknowledged')).toHaveTextContent('false')
  })
})

describe('IntegrationScopesPicker — scopes suspendidos', () => {
  it('los muestra con la marca «suspendido» y sin casilla para elegirlos', () => {
    render(
      <Harness
        ceilingScopes={[READ_ENTRY]}
        initialValue={['servers.list']}
        suspendedScopes={['databases.create']}
      />,
    )
    expect(screen.getByText('databases.create')).toBeInTheDocument()
    expect(screen.getByText('suspendido')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /databases.create/ })).not.toBeInTheDocument()
  })

  it('sin suspendidos no dibuja el bloque', () => {
    render(<Harness ceilingScopes={[READ_ENTRY]} suspendedScopes={[]} />)
    expect(screen.queryByText('suspendido')).not.toBeInTheDocument()
  })
})
