/**
 * La cuenta con la sesión abierta NO puede cambiar su propio rol, su propio acceso ni
 * desactivarse: lo hace otra persona con permiso de administración de accesos. El backend lo
 * impone con el 409 `access.self_modification_forbidden`; la UI lo anticipa deshabilitando esos
 * controles en la fila propia, con el motivo a la vista, para no llevar a nadie hasta el 409.
 *
 * Es cortesía de UI, no autorización: decide el servidor, siempre.
 */
export const SELF_ACCESS_NOTE =
  'Tu propio acceso lo cambia otra persona con permiso de administración de accesos.'

/**
 * ¿`user` es la cuenta de la sesión actual? Compara por `id`, que es lo que compara el backend,
 * y no por `username`. Sin sesión cargada responde `false`: ante la duda no se bloquea nada que
 * el backend no vaya a bloquear, y si lo bloquea, el 409 lo explica igual.
 */
export function isOwnAccount(
  sessionUserId: number | null | undefined,
  user: { id: number },
): boolean {
  return sessionUserId != null && sessionUserId === user.id
}
