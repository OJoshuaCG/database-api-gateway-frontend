import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { ACCESS_FORBIDDEN_CODE } from '@/lib/contracts'
import { forbiddenCopy, MY_ACCESS_PATH } from './messages'
import { notifyMutationError } from './notify-mutation-error'

function fakeToast() {
  return { error: vi.fn(), push: vi.fn() }
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

  it('un 403 sin el código de acceso (p. ej. CSRF) sigue el camino normal', () => {
    const toast = fakeToast()
    const error = new ApiError({ status: 403, message: 'CSRF', code: 'auth.csrf_invalid' })
    notifyMutationError(toast, error, 'No se pudo guardar')
    expect(toast.push).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('No se pudo guardar', 'CSRF')
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
