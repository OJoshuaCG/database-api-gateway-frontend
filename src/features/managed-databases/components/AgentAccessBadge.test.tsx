import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { managedDatabaseFixture } from '@/test/fixtures/authz-catalog'
import { AgentAccessBadge } from './AgentAccessBadge'

describe('AgentAccessBadge', () => {
  it('por defecto la base está cerrada a agentes', () => {
    render(<AgentAccessBadge database={managedDatabaseFixture()} />)
    expect(screen.getByText('Cerrada a agentes')).toBeInTheDocument()
  })

  it('con el opt-in encendido se muestra abierta', () => {
    render(<AgentAccessBadge database={managedDatabaseFixture({ agent_access_allowed: true })} />)
    expect(screen.getByText('Abierta a agentes')).toBeInTheDocument()
  })

  it('el bloqueo gana sobre el permiso: nunca se pinta abierta', () => {
    render(
      <AgentAccessBadge
        database={managedDatabaseFixture({
          agent_access_allowed: true,
          agent_access_blocked: true,
        })}
      />,
    )
    expect(screen.getByText('Bloqueada para agentes')).toBeInTheDocument()
    expect(screen.queryByText('Abierta a agentes')).not.toBeInTheDocument()
  })
})
