import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { REDACTED_DEFINITION_TEXT, RedactedDefinition } from './RedactedDefinition'

describe('RedactedDefinition', () => {
  it('dice que el contenido está oculto y por qué (el rol no ve el código)', () => {
    render(<RedactedDefinition />)
    expect(screen.getByRole('note')).toHaveTextContent(
      'Contenido oculto: tu rol no ve el código de este objeto',
    )
    expect(REDACTED_DEFINITION_TEXT).toBe('Contenido oculto: tu rol no ve el código de este objeto')
  })

  it('con título, el nombre accesible lo nombra: varios avisos en pantalla se distinguen', () => {
    render(<RedactedDefinition title="v_top" />)
    expect(screen.getByRole('note', { name: 'v_top: código oculto' })).toBeInTheDocument()
  })
})
