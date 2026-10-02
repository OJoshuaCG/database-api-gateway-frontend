import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isSkippedByScope, skippedBaseLabel } from '../messages'
import { SkippedByScopeCallout } from './SkippedByScopeCallout'

describe('SkippedByScopeCallout', () => {
  it('lista solo ids, sin nombres, y cuenta lo omitido', () => {
    render(<SkippedByScopeCallout ids={[12, 15]} noun="fila" />)
    expect(screen.getByText('2 filas omitidas por falta de permiso')).toBeInTheDocument()
    expect(screen.getByText(/#12, #15/)).toBeInTheDocument()
  })

  it('en singular concuerda', () => {
    render(<SkippedByScopeCallout ids={[7]} noun="base" />)
    expect(screen.getByText('1 base omitida por falta de permiso')).toBeInTheDocument()
  })

  it('no pinta nada sin omitidas', () => {
    const { container } = render(<SkippedByScopeCallout ids={[]} noun="fila" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('isSkippedByScope / skippedBaseLabel', () => {
  it('solo `ok: false` con access.forbidden es una omitida', () => {
    expect(isSkippedByScope({ ok: false, error_code: 'access.forbidden' })).toBe(true)
    expect(isSkippedByScope({ ok: false, error_code: 'environment.destructive_blocked' })).toBe(
      false,
    )
    expect(isSkippedByScope({ ok: true, error_code: null })).toBe(false)
  })

  it('la etiqueta lleva el id', () => {
    expect(skippedBaseLabel(42)).toBe('Sin permiso en esta base (#42)')
  })
})
