import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import { GATEWAY_PASSWORD_MAX, GATEWAY_PASSWORD_MIN } from '@/lib/contracts'
import { useChangePassword } from '../hooks/use-change-password'
import { changePasswordErrorMessage, passwordChangedMessage } from '../messages'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Escribí tu contraseña actual'),
    newPassword: z
      .string()
      .min(GATEWAY_PASSWORD_MIN, `Mínimo ${GATEWAY_PASSWORD_MIN} caracteres`)
      .max(GATEWAY_PASSWORD_MAX, `Máximo ${GATEWAY_PASSWORD_MAX} caracteres`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    // Solo del lado del cliente: la API recibe una sola contraseña nueva. Un error de tipeo acá
    // deja a la persona con una credencial que no sabe cuál es, y además le cierra las demás
    // sesiones.
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  })

type Values = z.infer<typeof schema>

const EMPTY: Values = { currentPassword: '', newPassword: '', confirmPassword: '' }

/**
 * Cambio de la contraseña propia (`POST /auth/password`).
 *
 * Pide la contraseña ACTUAL aunque la sesión sea válida: es lo que separa «tengo la cookie» de
 * «soy la persona», y sin ella una sesión robada alcanzaría para quedarse con la cuenta.
 *
 * Los errores quedan FIJOS en el formulario, atados al campo culpable cuando lo hay: un toast que
 * se va solo deja a la persona sin saber cuál de las tres contraseñas estaba mal.
 */
export function ChangePasswordPanel() {
  const change = useChangePassword()
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    setSuccess(null)
    change.mutate(
      { current_password: values.currentPassword, new_password: values.newPassword },
      {
        onSuccess: (data) => {
          setSuccess(passwordChangedMessage(data.revoked_sessions))
          reset(EMPTY)
        },
        onError: (error) => {
          const mapped = changePasswordErrorMessage(toApiError(error))
          if (mapped.field) setError(mapped.field, { type: 'server', message: mapped.message })
          else setFormError(mapped.message)
        },
      },
    )
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cambiar contraseña</CardTitle>
        <CardDescription>
          Al cambiarla se cierran todas tus sesiones abiertas en otros lugares. Esta pestaña sigue
          abierta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
          {success && (
            <Callout tone="success" title="Contraseña cambiada">
              {success}
            </Callout>
          )}

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
            >
              {formError}
            </p>
          )}

          <Input
            label="Contraseña actual"
            type="password"
            required
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />

          <Input
            label="Contraseña nueva"
            type="password"
            required
            autoComplete="new-password"
            hint={`Al menos ${GATEWAY_PASSWORD_MIN} caracteres, distinta de la actual.`}
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />

          <Input
            label="Repetí la contraseña nueva"
            type="password"
            required
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

          <div className="flex justify-end">
            <Button type="submit" isLoading={isSubmitting || change.isPending}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
