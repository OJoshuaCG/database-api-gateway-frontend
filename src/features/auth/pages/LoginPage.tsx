import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { loginInSchema, type LoginIn } from '@/lib/contracts'
import { toApiError } from '@/lib/api/errors'
import { Button, Card, Input } from '@/components/ui'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { useSession } from '../hooks/use-session'
import { useLogin } from '../hooks/use-login'

interface LocationState {
  from?: string
}

export function LoginPage() {
  const { isAuthenticated } = useSession()
  const login = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from ?? '/servers'

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginIn>({
    resolver: zodResolver(loginInSchema),
    defaultValues: { username: '', password: '' },
  })

  // Si ya hay sesión, no mostrar el login.
  if (isAuthenticated) return <Navigate to={from} replace />

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values)
      void navigate(from, { replace: true })
    } catch (error) {
      const apiError = toApiError(error)
      setError('root', { message: apiError.message })
    }
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card clay className="w-full max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-5 p-6" noValidate>
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                aria-hidden
              >
                <ellipse cx="12" cy="5.5" rx="7" ry="2.5" strokeWidth="1.8" />
                <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" strokeWidth="1.8" />
              </svg>
            </span>
            <h1 className="text-lg font-semibold text-foreground">Database API Gateway</h1>
            <p className="text-sm text-muted-foreground">Inicia sesión como administrador</p>
          </div>

          {errors.root && (
            <p
              role="alert"
              className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
            >
              {errors.root.message}
            </p>
          )}

          <Input
            label="Usuario"
            autoComplete="username"
            autoFocus
            required
            error={errors.username?.message}
            {...register('username')}
          />
          <Input
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />

          <Button type="submit" className="w-full" isLoading={isSubmitting || login.isPending}>
            Entrar
          </Button>
        </form>
      </Card>
    </div>
  )
}
