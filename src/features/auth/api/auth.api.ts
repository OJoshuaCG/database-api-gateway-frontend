import { fetchData, mutateData, mutateVoid } from '@/lib/api/client'
import { adminOutSchema, type AdminOut, type LoginIn } from '@/lib/contracts'

/** `GET /auth/me` — administrador autenticado. */
export function getMe(signal?: AbortSignal): Promise<AdminOut> {
  return fetchData('/auth/me', adminOutSchema, { signal })
}

/**
 * `POST /auth/login`. `suppressAuthHandler` evita que un 401 (credenciales inválidas)
 * dispare el flujo global de cierre de sesión/redirección.
 */
export function login(body: LoginIn): Promise<AdminOut> {
  return mutateData('POST', '/auth/login', adminOutSchema, { body, suppressAuthHandler: true })
}

/** `POST /auth/logout`. */
export function logout(): Promise<string | undefined> {
  return mutateVoid('POST', '/auth/logout')
}
