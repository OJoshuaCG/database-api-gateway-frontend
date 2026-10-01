import { describe, expect, it } from 'vitest'
import { buildInviteLink, extractInviteToken, inviteTokenFromLocation } from './invite-link'

describe('buildInviteLink', () => {
  it('arma la URL pública de aceptación con el token en el fragmento', () => {
    expect(buildInviteLink('1759420800.abc123', 'https://gateway.example.com')).toBe(
      'https://gateway.example.com/invitacion#token=1759420800.abc123',
    )
  })

  it('ignora la ruta que ya traiga el origen', () => {
    expect(buildInviteLink('1.a', 'http://localhost:5173/usuarios')).toBe(
      'http://localhost:5173/invitacion#token=1.a',
    )
  })

  it('nunca pone el token en la query: no tiene que llegar al servidor', () => {
    expect(new URL(buildInviteLink('1.a', 'https://gateway.example.com')).search).toBe('')
  })
})

describe('inviteTokenFromLocation', () => {
  it('lee el fragmento', () => {
    expect(inviteTokenFromLocation({ search: '', hash: '#token=1.a' })).toBe('1.a')
  })

  it('acepta todavía la query de los enlaces ya entregados', () => {
    expect(inviteTokenFromLocation({ search: '?token=1.b', hash: '' })).toBe('1.b')
  })

  it('el fragmento gana sobre la query', () => {
    expect(inviteTokenFromLocation({ search: '?token=viejo', hash: '#token=nuevo' })).toBe('nuevo')
  })

  it('devuelve null sin token', () => {
    expect(inviteTokenFromLocation({ search: '', hash: '' })).toBeNull()
  })
})

describe('extractInviteToken', () => {
  it('devuelve el token solo tal cual (sin espacios)', () => {
    expect(extractInviteToken('  1759420800.abc123 ')).toBe('1759420800.abc123')
  })

  it('extrae el token de un link completo pegado (fragmento)', () => {
    expect(
      extractInviteToken('https://gateway.example.com/invitacion#token=1759420800.abc123'),
    ).toBe('1759420800.abc123')
  })

  it('extrae el token de un link viejo pegado (query)', () => {
    expect(
      extractInviteToken('https://gateway.example.com/invitacion?token=1759420800.abc123'),
    ).toBe('1759420800.abc123')
  })

  it('devuelve la entrada si no es una URL válida', () => {
    expect(extractInviteToken('not a url?token=x')).toBe('not a url?token=x')
  })
})
