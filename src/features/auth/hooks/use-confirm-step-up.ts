import { useMutation } from '@tanstack/react-query'
import { confirmStepUp } from '../api/auth.api'

/**
 * Mutación de `POST /auth/step-up`. No invalida nada: quien la usa (`StepUpProvider`) escribe la
 * ventana nueva en `/auth/me` con lo que devuelve, sin pagar otro request.
 */
export function useConfirmStepUp() {
  return useMutation({ mutationFn: (password: string) => confirmStepUp(password) })
}
