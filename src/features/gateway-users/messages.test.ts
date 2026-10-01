import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { GATEWAY_USER_ERROR_CODES } from '@/lib/contracts'
import {
  acceptInviteErrorMessage,
  gatewayUserErrorMessage,
  GRANT_CEILING_FALLBACK,
  RATE_LIMIT_HINT,
  SELF_MODIFICATION_MESSAGE,
} from './messages'
import { isOwnAccount, SELF_ACCESS_NOTE } from './self-access'

function error(
  status: number,
  code?: string,
  extra?: Partial<ConstructorParameters<typeof ApiError>[0]>,
) {
  return new ApiError({ status, message: 'mensaje del backend', code, ...extra })
}

describe('gatewayUserErrorMessage', () => {
  it('distingue el 404 del 422 aunque compartan el MISMO código', () => {
    // Es la trampa del §2.9: `gateway_user.not_found` llega con dos status y significan cosas
    // distintas. Enrutar solo por `code` mostraría el mensaje equivocado en uno de los dos casos.
    const notFound404 = gatewayUserErrorMessage(error(404, GATEWAY_USER_ERROR_CODES.notFound))
    expect(notFound404).toContain('ya no existe')

    // El 422 del mismo código es de la pantalla pública, así que estas pantallas NO lo reclaman.
    expect(gatewayUserErrorMessage(error(422, GATEWAY_USER_ERROR_CODES.notFound))).toBeNull()
  })

  it('explica el último administrador protegido sin invitar a reintentar', () => {
    const message = gatewayUserErrorMessage(error(409, GATEWAY_USER_ERROR_CODES.lastAdminProtected))
    expect(message).toContain('access_admin')
  })

  it('suma el `allowed[]` del backend cuando viene', () => {
    const message = gatewayUserErrorMessage(
      error(422, GATEWAY_USER_ERROR_CODES.invalidRole, {
        gatewayUserContext: { allowed: ['viewer', 'operator', 'owner'] },
      }),
    )
    expect(message).toContain('viewer, operator, owner')
  })

  it('sigue dando un mensaje útil cuando `invalid_global_capability` NO trae allowed', () => {
    // El código cubre dos errores distintos y solo uno trae `allowed`: el `scope_type` inválido
    // no lo trae. Un cliente que asuma que el campo está rompería justo ahí.
    const message = gatewayUserErrorMessage(
      error(422, GATEWAY_USER_ERROR_CODES.invalidGlobalCapability),
    )
    expect(message).toBeTruthy()
    expect(message).toContain('tipo de alcance')
  })

  it('el 429 gana sobre cualquier código, porque llega sin ninguno', () => {
    expect(gatewayUserErrorMessage(error(429))).toBe(RATE_LIMIT_HINT)
  })

  it('devuelve null ante un código desconocido, para no ocultar el mensaje real', () => {
    expect(gatewayUserErrorMessage(error(500, 'otra.cosa'))).toBeNull()
  })
})

describe('acceptInviteErrorMessage', () => {
  it('trata el 410 por STATUS, porque la invitación vencida llega sin código', () => {
    const message = acceptInviteErrorMessage(error(410))
    expect(message).toContain('venció')
  })

  it('cubre inválida / inexistente / ya usada con un solo mensaje', () => {
    // El backend responde lo mismo para los tres a propósito, para no ser un oráculo de qué
    // invitaciones hay pendientes.
    const message = acceptInviteErrorMessage(error(422, GATEWAY_USER_ERROR_CODES.notFound))
    expect(message).toContain('no es válida o ya se usó')
  })

  it('usa el min_length del backend cuando la contraseña es débil', () => {
    const message = acceptInviteErrorMessage(
      error(422, GATEWAY_USER_ERROR_CODES.weakPassword, {
        gatewayUserContext: { minLength: 12 },
      }),
    )
    expect(message).toContain('12')
  })

  it('cae al mensaje del backend si no reconoce el caso', () => {
    expect(acceptInviteErrorMessage(error(500))).toBe('mensaje del backend')
  })
})

describe('guards anti auto-escalada', () => {
  it('`self_modification_forbidden` dice quién puede hacerlo, con la misma nota de la fila propia', () => {
    const message = gatewayUserErrorMessage(
      error(409, GATEWAY_USER_ERROR_CODES.selfModificationForbidden),
    )
    expect(message).toBe(SELF_MODIFICATION_MESSAGE)
    expect(message).toContain(SELF_ACCESS_NOTE)
  })

  it('`grant_ceiling_exceeded` usa la frase propia en voseo y conserva solo el detalle del backend', () => {
    const backend =
      "No puedes otorgar más acceso del que tienes: rol base 'owner'; capacidades globales [security_officer]. Pídeselo a alguien que tenga ese nivel."
    const message = gatewayUserErrorMessage(
      error(409, GATEWAY_USER_ERROR_CODES.grantCeilingExceeded, {
        message: backend,
        type: 'AppHttpException',
      }),
    )
    expect(message).toBe(
      `${GRANT_CEILING_FALLBACK} Lo que excede: rol base 'owner'; capacidades globales [security_officer].`,
    )
    expect(message).not.toContain('puedes')
    expect(message).not.toContain('Pídeselo')
  })

  it('`grant_ceiling_exceeded` con un `msg` de otra forma cae en el respaldo, sin copiarlo', () => {
    const message = gatewayUserErrorMessage(
      error(409, GATEWAY_USER_ERROR_CODES.grantCeilingExceeded, {
        message: 'Otro texto cualquiera.',
        type: 'AppHttpException',
      }),
    )
    expect(message).toBe(GRANT_CEILING_FALLBACK)
  })

  it('`grant_ceiling_exceeded` sin envelope del backend cae en el respaldo, no en el genérico', () => {
    expect(gatewayUserErrorMessage(error(409, GATEWAY_USER_ERROR_CODES.grantCeilingExceeded))).toBe(
      GRANT_CEILING_FALLBACK,
    )
  })
})

describe('isOwnAccount', () => {
  it('compara por id, que es lo que compara el backend', () => {
    expect(isOwnAccount(7, { id: 7 })).toBe(true)
    expect(isOwnAccount(7, { id: 8 })).toBe(false)
  })

  it('sin sesión cargada no bloquea nada', () => {
    expect(isOwnAccount(null, { id: 7 })).toBe(false)
    expect(isOwnAccount(undefined, { id: 7 })).toBe(false)
  })
})
