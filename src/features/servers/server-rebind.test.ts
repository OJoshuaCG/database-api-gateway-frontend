import { describe, expect, it } from 'vitest'
import { normalizeApiError, ApiError } from '@/lib/api/errors'
import {
  REBIND_MESSAGE,
  rebindFields,
  rebindMessage,
  serverRebindErrorMessage,
  type RebindBaseline,
} from './server-rebind'

const saved: RebindBaseline = {
  host: 'db.empresa.com',
  port: 3306,
  engine: 'mysql',
  ssl_mode: 'require',
}

describe('rebindFields (misma regla que el backend)', () => {
  it('no exige nada si el destino no cambia', () => {
    expect(rebindFields(saved, { ...saved })).toEqual([])
  })

  it('el host se compara sin espacios ni mayúsculas', () => {
    expect(rebindFields(saved, { ...saved, host: '  DB.Empresa.com ' })).toEqual([])
    expect(rebindFields(saved, { ...saved, host: 'otro.empresa.com' })).toEqual(['host'])
  })

  it('detecta puerto y motor', () => {
    expect(rebindFields(saved, { ...saved, port: 3307, engine: 'mariadb' })).toEqual([
      'port',
      'engine',
    ])
  })

  it('debilitar el TLS desde `require` o más fuerte cuenta; endurecerlo no', () => {
    expect(rebindFields(saved, { ...saved, ssl_mode: 'prefer' })).toEqual(['ssl_mode'])
    expect(rebindFields(saved, { ...saved, ssl_mode: null })).toEqual(['ssl_mode'])
    expect(rebindFields(saved, { ...saved, ssl_mode: 'verify-full' })).toEqual([])
  })

  it('bajar desde un modo que no exigía TLS no cuenta', () => {
    const weak: RebindBaseline = { ...saved, ssl_mode: 'prefer' }
    expect(rebindFields(weak, { ...weak, ssl_mode: 'disable' })).toEqual([])
  })
})

describe('serverRebindErrorMessage', () => {
  it('traduce el 422 y lista los campos de `public_context.fields`', () => {
    const error = normalizeApiError(422, {
      detail: {
        msg: "exige volver a enviar 'root_password'",
        type: 'AppHttpException',
        public_context: {
          code: 'server.credential_required_for_rebind',
          fields: ['host', 'ssl_mode'],
        },
      },
    })
    const message = serverRebindErrorMessage(error)
    expect(message).toContain(REBIND_MESSAGE)
    expect(message).toContain('Cambiaste: host, modo TLS.')
  })

  it('sin `fields` sigue dando el aviso, sin lista', () => {
    const error = new ApiError({
      status: 422,
      message: 'x',
      code: 'server.credential_required_for_rebind',
    })
    expect(serverRebindErrorMessage(error)).toBe(REBIND_MESSAGE)
  })

  it('devuelve null ante otro código', () => {
    expect(serverRebindErrorMessage(new ApiError({ status: 422, message: 'x' }))).toBeNull()
  })

  it('ignora nombres de campo que no conoce en vez de mostrarlos crudos', () => {
    expect(rebindMessage(['port', 'otro_campo'])).toBe(`${REBIND_MESSAGE} Cambiaste: puerto.`)
  })
})
