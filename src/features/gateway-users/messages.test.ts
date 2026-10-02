import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { ACCESS_REQUEST_ERROR_CODES, GATEWAY_USER_ERROR_CODES } from '@/lib/contracts'
import {
  acceptInviteErrorMessage,
  accessRequestBlockedMessage,
  accessRequestErrorMessage,
  ELEVATION_PENDING_MESSAGE,
  gatewayUserErrorMessage,
  NOT_ASSIGNABLE_MESSAGE,
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
  it('el 422 `grant_scope_not_found` de PUT /access manda a recargar y nombra lo que falta', () => {
    const message = gatewayUserErrorMessage(
      error(422, GATEWAY_USER_ERROR_CODES.grantScopeNotFound, {
        gatewayUserContext: {
          missingScopes: [
            { scopeType: 'environment', scopeId: 3 },
            { scopeType: 'server', scopeId: 9 },
          ],
        },
      }),
    )
    expect(message).toContain('ya no existe')
    expect(message).toContain('Recargá la página')
    expect(message).toContain('el entorno #3, el servidor #9')
  })

  it('el 422 `grant_scope_not_found` sin `missing_scopes` sigue siendo accionable', () => {
    const message = gatewayUserErrorMessage(error(422, GATEWAY_USER_ERROR_CODES.grantScopeNotFound))
    expect(message).toContain('Recargá la página')
    expect(message).not.toContain('#')
  })

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
  it('cubre inválida / vencida / inexistente / ya usada con un solo mensaje', () => {
    // El backend responde lo mismo para todos a propósito, para no ser un oráculo de qué
    // invitaciones hay pendientes.
    const message = acceptInviteErrorMessage(error(422, GATEWAY_USER_ERROR_CODES.notFound))
    expect(message).toContain('no es válida, venció o ya se usó')
  })

  it('un 410 de un backend anterior recibe el MISMO mensaje, sin reabrir la distinción', () => {
    expect(acceptInviteErrorMessage(error(410))).toBe(
      acceptInviteErrorMessage(error(422, GATEWAY_USER_ERROR_CODES.notFound)),
    )
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

  it('`not_assignable` reemplaza al techo retirado y dice quién asigna', () => {
    const message = gatewayUserErrorMessage(error(409, GATEWAY_USER_ERROR_CODES.notAssignable))
    expect(message).toBe(NOT_ASSIGNABLE_MESSAGE)
    expect(message).toContain('access_admin')
  })

  it('el código retirado `grant_ceiling_exceeded` ya no tiene copy propio (cae al del backend)', () => {
    expect(gatewayUserErrorMessage(error(409, 'access.grant_ceiling_exceeded'))).toBeNull()
  })
})

describe('elevaciones con segundo aprobador (v29 §9)', () => {
  const codes = Object.values(ACCESS_REQUEST_ERROR_CODES)

  it.each(codes)('%s tiene copy propio en voseo, nunca el mensaje del backend', (code) => {
    const message = accessRequestErrorMessage(error(409, code))
    expect(message).toBeTruthy()
    expect(message).not.toContain('mensaje del backend')
    expect(message).not.toMatch(/\bpuedes\b|\btienes\b/u)
  })

  it('la solicitud vieja explica que se canceló sola y cómo volver a pedirla', () => {
    const message = accessRequestErrorMessage(error(409, ACCESS_REQUEST_ERROR_CODES.requestStale))
    expect(message).toContain('cambió desde que se pidió')
    expect(message).toContain('pedila de nuevo')
  })

  it('cancelar algo ajeno manda a rechazarlo', () => {
    expect(
      accessRequestErrorMessage(error(409, ACCESS_REQUEST_ERROR_CODES.requestNotRequester)),
    ).toContain('rechazala')
  })

  it('el auto-aprobado habla de elevaciones, no de capacidades', () => {
    const message = accessRequestBlockedMessage('access.self_approval_forbidden')
    expect(message).toContain('elevación que pediste vos')
  })

  it('sin motivo devuelve null; uno desconocido, un genérico', () => {
    expect(accessRequestBlockedMessage(null)).toBeNull()
    expect(accessRequestBlockedMessage('access.algo_nuevo')).toContain('No podés decidir')
  })

  it('cae al copy general del módulo (429) y a null en un código ajeno', () => {
    expect(accessRequestErrorMessage(error(429))).toBe(RATE_LIMIT_HINT)
    expect(accessRequestErrorMessage(error(500, 'otra.cosa'))).toBeNull()
  })

  it('el aviso del 202 dice qué se aplicó y qué espera', () => {
    expect(ELEVATION_PENDING_MESSAGE).toBe(
      'Se aplicó lo que no requiere aprobación; la elevación quedó pendiente de otro administrador de accesos.',
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
