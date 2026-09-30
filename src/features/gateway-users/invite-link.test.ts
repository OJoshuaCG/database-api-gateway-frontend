import { describe, expect, it } from 'vitest'
import { buildInviteLink, extractInviteToken } from './invite-link'

describe('buildInviteLink', () => {
  it('arma la URL pública de aceptación con el token como query param', () => {
    expect(buildInviteLink('1759420800.abc123', 'https://gateway.example.com')).toBe(
      'https://gateway.example.com/invitacion?token=1759420800.abc123',
    )
  })

  it('ignora la ruta que ya traiga el origen', () => {
    expect(buildInviteLink('1.a', 'http://localhost:5173/usuarios')).toBe(
      'http://localhost:5173/invitacion?token=1.a',
    )
  })
})

describe('extractInviteToken', () => {
  it('devuelve el token solo tal cual (sin espacios)', () => {
    expect(extractInviteToken('  1759420800.abc123 ')).toBe('1759420800.abc123')
  })

  it('extrae el token de un link completo pegado', () => {
    expect(
      extractInviteToken('https://gateway.example.com/invitacion?token=1759420800.abc123'),
    ).toBe('1759420800.abc123')
  })

  it('devuelve la entrada si no es una URL válida', () => {
    expect(extractInviteToken('not a url?token=x')).toBe('not a url?token=x')
  })
})
