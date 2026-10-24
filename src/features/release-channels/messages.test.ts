import { describe, expect, it } from 'vitest'
import { RELEASE_CHANNEL_ERROR_CODES } from '@/lib/contracts'
import { releaseChannelMessage, releaseChannelModeLabel } from './messages'

describe('releaseChannelMessage', () => {
  it('traduce TODOS los códigos del vocabulario cerrado', () => {
    for (const code of Object.values(RELEASE_CHANNEL_ERROR_CODES)) {
      expect(releaseChannelMessage(code), code).not.toBeNull()
    }
  })

  it('devuelve null para un código ajeno o ausente', () => {
    expect(releaseChannelMessage('environment.not_found')).toBeNull()
    expect(releaseChannelMessage(undefined)).toBeNull()
    expect(releaseChannelMessage(null)).toBeNull()
  })
})

describe('releaseChannelModeLabel', () => {
  it('etiqueta los tres modos y deja pasar uno desconocido tal cual', () => {
    expect(releaseChannelModeLabel('manual')).toBe('Manual')
    expect(releaseChannelModeLabel('derived')).toBe('Derivado')
    expect(releaseChannelModeLabel('latest')).toBe('Última versión')
    expect(releaseChannelModeLabel('pinned')).toBe('pinned')
  })
})
