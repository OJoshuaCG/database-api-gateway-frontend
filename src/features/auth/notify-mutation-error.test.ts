import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import type { ToastInput } from '@/lib/toast/toast-context'
import { ACCESS_FORBIDDEN_CODE, AUTH_CSRF_ERROR_CODES } from '@/lib/contracts'
import { CSRF_ERROR_TITLE, csrfErrorCopy, forbiddenCopy, MY_ACCESS_PATH } from './messages'
import { notifyMutationError } from './notify-mutation-error'

function fakeToast() {
  return {
    error: vi.fn<(title: string, description?: string) => string>(),
    push: vi.fn<(input: ToastInput) => string>(),
  }
}

describe('notifyMutationError', () => {
  it('un 403 de acceso muestra el copy compartido con «Ver mi acceso», no el título del hook', () => {
    const toast = fakeToast()
    const error = new ApiError({
      status: 403,
      message: 'No tienes permiso para esta operación.',
      code: ACCESS_FORBIDDEN_CODE,
    })
    notifyMutationError(toast, error, 'No se pudieron aplicar las migraciones')
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        title: forbiddenCopy().title,
        description: forbiddenCopy().body,
        action: { label: 'Ver mi acceso', href: MY_ACCESS_PATH },
      }),
    )
  })

  describe('403 de CSRF', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it.each([
      AUTH_CSRF_ERROR_CODES.missing,
      AUTH_CSRF_ERROR_CODES.invalid,
      AUTH_CSRF_ERROR_CODES.originRejected,
    ])('%s muestra su propio copy, no el de permisos ni «Ver mi acceso»', (code) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const toast = fakeToast()
      const error = new ApiError({ status: 403, message: 'Token CSRF inválido.', code })
      notifyMutationError(toast, error, 'No se pudo guardar')
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.push).toHaveBeenCalledTimes(1)
      const pushed = toast.push.mock.calls[0]![0]
      expect(pushed).toMatchObject({
        variant: 'error',
        title: CSRF_ERROR_TITLE,
        description: csrfErrorCopy(error),
      })
      expect(pushed.action).toBeUndefined()
      expect(pushed.title).not.toBe(forbiddenCopy().title)
      expect(pushed.description).not.toBe(forbiddenCopy().body)
    })

    it('el de token manda a recargar; el de origen, a la dirección oficial', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const toast = fakeToast()
      notifyMutationError(
        toast,
        new ApiError({ status: 403, message: 'x', code: AUTH_CSRF_ERROR_CODES.invalid }),
        'No se pudo guardar',
      )
      notifyMutationError(
        toast,
        new ApiError({ status: 403, message: 'x', code: AUTH_CSRF_ERROR_CODES.originRejected }),
        'No se pudo guardar',
      )
      expect(toast.push.mock.calls[0]![0].description).toMatch(/Recargá la página/)
      expect(toast.push.mock.calls[1]![0].description).toMatch(/dirección oficial/)
    })

    it('deja rastro en consola con el código y el request id', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const error = new ApiError({
        status: 403,
        message: 'x',
        code: AUTH_CSRF_ERROR_CODES.missing,
        requestId: 'req-1',
      })
      notifyMutationError(fakeToast(), error, 'No se pudo guardar')
      expect(warn).toHaveBeenCalledWith(expect.any(String), {
        code: AUTH_CSRF_ERROR_CODES.missing,
        requestId: 'req-1',
      })
    })
  })

  it('un 403 sin código conocido sigue el camino normal', () => {
    const toast = fakeToast()
    notifyMutationError(
      toast,
      new ApiError({ status: 403, message: 'Prohibido' }),
      'No se pudo guardar',
    )
    expect(toast.push).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No se pudo guardar', 'Prohibido')
  })

  it('cualquier otro error: título del hook y el mensaje del backend', () => {
    const toast = fakeToast()
    notifyMutationError(
      toast,
      new ApiError({ status: 409, message: 'Ya existe' }),
      'No se pudo crear',
    )
    expect(toast.error).toHaveBeenCalledWith('No se pudo crear', 'Ya existe')
  })

  it('la descripción explícita del hook gana sobre el mensaje del backend', () => {
    const toast = fakeToast()
    notifyMutationError(
      toast,
      new ApiError({ status: 409, message: 'crudo' }),
      'No se pudo crear',
      'Traducido',
    )
    expect(toast.error).toHaveBeenCalledWith('No se pudo crear', 'Traducido')
  })
})
