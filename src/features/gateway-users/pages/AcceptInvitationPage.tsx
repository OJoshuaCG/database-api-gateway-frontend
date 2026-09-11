import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Callout, Card, Input } from '@/components/ui'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { toApiError } from '@/lib/api/errors'
import {
  GATEWAY_INVITE_TOKEN_MIN,
  GATEWAY_PASSWORD_MAX,
  GATEWAY_PASSWORD_MIN,
} from '@/lib/contracts'
import { useAcceptGatewayUserInvite } from '../hooks/use-gateway-users'
import { acceptInviteErrorMessage } from '../messages'

const schema = z
  .object({
    token: z.string().trim().min(GATEWAY_INVITE_TOKEN_MIN, 'Pegá el token de invitación completo'),
    password: z
      .string()
      .min(GATEWAY_PASSWORD_MIN, `Mínimo ${GATEWAY_PASSWORD_MIN} caracteres`)
      .max(GATEWAY_PASSWORD_MAX, `Máximo ${GATEWAY_PASSWORD_MAX} caracteres`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    // La confirmación es solo del lado del cliente: la API recibe una sola contraseña. Existe
    // porque un error de tipeo acá gasta la invitación —es de un solo uso— y deja a la persona
    // fuera con una credencial que no sabe cuál es.
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  })

type Values = z.infer<typeof schema>

/**
 * Aceptar una invitación (§2.4) — pantalla **pública**, fuera del área autenticada.
 *
 * Quien la usa todavía no puede iniciar sesión, que es justamente el punto del diseño: nadie más
 * que esa persona conoce su contraseña, así que ninguna acción auditada a su nombre es repudiable.
 *
 * El `user_id` viaja DENTRO del token firmado, así que la pantalla no necesita ningún otro dato.
 * El token llega por la URL (`?token=`) o pegado a mano — el gateway no tiene sustrato de
 * notificación, así que alguien se lo pasó por un canal humano.
 */
export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const accept = useAcceptGatewayUserInvite()
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const tokenFromUrl = searchParams.get('token') ?? ''

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { token: tokenFromUrl, password: '', confirmPassword: '' },
  })

  const onSubmit = handleSubmit((values) => {
    setFormError(null)
    accept.mutate(
      { token: values.token, password: values.password },
      {
        onSuccess: (data) => setDone(data.username),
        // El error queda FIJO en el formulario, no en un toast: un aviso que se va solo deja a
        // alguien que no puede entrar sin saber por qué, y sin nada que releer.
        onError: (error) => setFormError(acceptInviteErrorMessage(toApiError(error))),
      },
    )
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <Card clay className="w-full max-w-md">
        {done ? (
          <div className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-lg font-semibold text-foreground">Contraseña establecida</h1>
              <p className="text-sm text-muted-foreground">
                Tu usuario es <strong className="font-mono text-foreground">{done}</strong>. Ya
                podés iniciar sesión.
              </p>
            </div>
            {/* El 200 NO abre sesión: hay que llevar a la persona al login normal. */}
            <Button type="button" className="w-full" onClick={() => void navigate('/login')}>
              Ir al inicio de sesión
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-5 p-6" noValidate>
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-lg font-semibold text-foreground">Activá tu cuenta</h1>
              <p className="text-sm text-muted-foreground">
                Elegí tu contraseña para el Database API Gateway. Nadie más la conoce, ni siquiera
                quien creó la cuenta.
              </p>
            </div>

            {formError && (
              <p
                role="alert"
                className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
              >
                {formError}
              </p>
            )}

            <Input
              label="Token de invitación"
              required
              autoFocus={tokenFromUrl.length === 0}
              className="font-mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              hint={
                tokenFromUrl
                  ? 'Lo tomamos del enlace que abriste.'
                  : 'Te lo tiene que dar quien administra los accesos.'
              }
              error={errors.token?.message}
              {...register('token')}
            />

            <Input
              label="Contraseña nueva"
              type="password"
              required
              autoFocus={tokenFromUrl.length > 0}
              autoComplete="new-password"
              hint={`Al menos ${GATEWAY_PASSWORD_MIN} caracteres.`}
              error={errors.password?.message}
              {...register('password')}
            />

            <Input
              label="Repetí la contraseña"
              type="password"
              required
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />

            <Callout tone="warning" title="La invitación es de un solo uso">
              En cuanto la uses deja de valer. Si algo sale mal, pedile una nueva a quien administra
              los accesos.
            </Callout>

            <Button type="submit" className="w-full" isLoading={isSubmitting || accept.isPending}>
              Establecer contraseña
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
