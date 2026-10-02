import { fetchData, fetchList, mutateData, mutateVoid } from '@/lib/api/client'
import {
  adminOutSchema,
  capabilityDescriptorSchema,
  passwordChangeOutSchema,
  scopeReadinessSchema,
  sessionInfoSchema,
  stepUpOutSchema,
  type AdminOut,
  type CapabilityDescriptor,
  type LoginIn,
  type PasswordChangeIn,
  type PasswordChangeOut,
  type ScopeReadiness,
  type SessionInfo,
  type StepUpOut,
} from '@/lib/contracts'

/** `GET /auth/me` — administrador autenticado. */
export function getMe(signal?: AbortSignal): Promise<AdminOut> {
  return fetchData('/auth/me', adminOutSchema, { signal })
}

/**
 * `POST /auth/login`. `suppressAuthHandler` evita que un 401 (credenciales inválidas)
 * dispare el flujo global de cierre de sesión/redirección.
 *
 * `csrf: false` porque acá TODAVÍA NO HAY SESIÓN (v23 §7.1): el token se deriva del identificador
 * de sesión, así que en la pantalla de login la cookie no existe y no podría existir. El backend
 * tampoco lo exige — su chequeo vive dentro del guard de capacidades, que solo corre para un actor
 * de sesión.
 */
export function login(body: LoginIn): Promise<AdminOut> {
  return mutateData('POST', '/auth/login', adminOutSchema, {
    body,
    suppressAuthHandler: true,
    csrf: false,
  })
}

/** `POST /auth/logout`. */
export function logout(): Promise<string | undefined> {
  return mutateVoid('POST', '/auth/logout')
}

/**
 * `GET /authz/catalog` (v23 §2) — el vocabulario completo de capacidades, detrás de `self.read`,
 * o sea cualquier sesión. Es una lista NO paginada.
 */
export function getCapabilityCatalog(signal?: AbortSignal): Promise<CapabilityDescriptor[]> {
  return fetchList('/authz/catalog', capabilityDescriptorSchema, { signal })
}

/**
 * `GET /authz/scope-readiness` (v23 §8, detrás de `gateway.admin`) — se consulta ANTES de otorgar
 * el primer acceso por alcance, porque una base sin entorno resuelve al entorno MÁS PROTEGIDO y no
 * al default.
 */
export function getScopeReadiness(signal?: AbortSignal): Promise<ScopeReadiness> {
  return fetchData('/authz/scope-readiness', scopeReadinessSchema, { signal })
}

/** `GET /auth/sessions` (v23 §7.4) — las sesiones vivas del propio usuario. */
export function listSessions(signal?: AbortSignal): Promise<SessionInfo[]> {
  return fetchList('/auth/sessions', sessionInfoSchema, { signal })
}

/** `POST /auth/sessions/revoke-others` (v23 §7.4) — cierra las demás y CONSERVA la actual. */
export function revokeOtherSessions(): Promise<string | undefined> {
  return mutateVoid('POST', '/auth/sessions/revoke-others')
}

/**
 * `POST /auth/password` — cambia la contraseña PROPIA (exige la actual).
 *
 * Al éxito el backend cierra TODAS las sesiones del usuario y abre una nueva en la misma
 * respuesta: el `sid` rota y la cookie CSRF cambia con él. No hace falta refrescar nada a mano,
 * porque `readCsrfToken` lee la cookie en cada request y la próxima ya ve la nueva.
 */
export function changeOwnPassword(body: PasswordChangeIn): Promise<PasswordChangeOut> {
  return mutateData('POST', '/auth/password', passwordChangeOutSchema, { body })
}

/**
 * `POST /auth/step-up` — confirma la contraseña propia y abre la ventana de step-up de ESTA sesión.
 *
 * `suppressStepUp` porque es justamente el endpoint que resuelve ese 403: no puede depender de sí
 * mismo. El 401 NO se suprime: el del quinto fallo (`auth.session_step_up_failed`) es una sesión
 * revocada de verdad y tiene que llevar al login como cualquier otro. La contraseña incorrecta es
 * un 400, así que no cierra nada.
 */
export function confirmStepUp(password: string): Promise<StepUpOut> {
  return mutateData('POST', '/auth/step-up', stepUpOutSchema, {
    body: { password },
    suppressStepUp: true,
  })
}
