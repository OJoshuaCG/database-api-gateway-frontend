import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { renderWithProviders } from '@/test/utils'
import type { MigrationDeletePlanOut, MigrationDeleteResult } from '@/lib/contracts'
import { MigrationDeletePlanDialog } from './MigrationDeletePlanDialog'

const MIGRATION_URL = 'http://localhost/api/v1/database-models/3/migrations/0007'
const PLAN_URL = `${MIGRATION_URL}/delete-plan`
const DATABASES_URL = 'http://localhost/api/v1/database-models/3/databases'

/** El aviso que el contrato obliga a mostrar: las bases conservan FÍSICAMENTE los objetos. */
const WARNING_OBJETOS =
  'Las bases que ya aplicaron 0007 conservan físicamente sus tablas e índices: el borrado no los revierte.'

/**
 * Plan del `delete-plan` con valores por defecto sensatos.
 *
 * Existe para que cada `it` declare SOLO lo que decide su caso: el resto del plan es ruido que,
 * repetido en once tests, esconde justamente el campo que cada uno está probando.
 */
function plan(overrides: Partial<MigrationDeletePlanOut> = {}): MigrationDeletePlanOut {
  return {
    model_id: 3,
    version: '0007',
    deletable: true,
    renumber: [{ from_version: '0008', to_version: '0007' }],
    stamp_plan: [],
    blockers: [],
    unstampable: [],
    partial_applications: [],
    requires_confirmation: false,
    confirm_token: null,
    expires_at: null,
    warnings: [WARNING_OBJETOS],
    ...overrides,
  }
}

function deleteResult(overrides: Partial<MigrationDeleteResult> = {}): MigrationDeleteResult {
  return {
    model_id: 3,
    version: '0007',
    renumbered: [{ from_version: '0008', to_version: '0007' }],
    stamped: [],
    ...overrides,
  }
}

/** Cuerpo de error del backend, con el `code` estable dentro de `public_context`. */
function errorBody(msg: string, publicContext?: Record<string, unknown>) {
  return {
    detail: {
      msg,
      type: 'AppHttpException',
      ...(publicContext ? { public_context: publicContext } : {}),
    },
  }
}

interface MountOptions {
  initialPlan?: MigrationDeletePlanOut
  /** Respuesta del `DELETE`. Por defecto, un 200 con el desglose de lo ejecutado. */
  onDelete?: () => Response
  /** Respuesta del `delete-plan` cuando el test pulsa «Volver a comprobar». */
  replanWith?: MigrationDeletePlanOut
}

function mount({ initialPlan = plan(), onDelete, replanWith = plan() }: MountOptions = {}) {
  const deleteUrls: string[] = []
  const planCalls = { count: 0 }
  const onClose = vi.fn()
  const onDeleted = vi.fn()

  server.use(
    http.delete(MIGRATION_URL, ({ request }) => {
      deleteUrls.push(request.url)
      return onDelete ? onDelete() : HttpResponse.json({ data: deleteResult() })
    }),
    http.get(PLAN_URL, () => {
      planCalls.count += 1
      return HttpResponse.json({ data: replanWith })
    }),
    // La pide `BlockingDatabasesList` para poner nombre a los ids bloqueantes.
    http.get(DATABASES_URL, () => HttpResponse.json({ data: [] })),
  )

  renderWithProviders(
    <MigrationDeletePlanDialog
      modelId={3}
      version="0007"
      initialPlan={initialPlan}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )

  return { deleteUrls, planCalls, onClose, onDeleted, user: userEvent.setup() }
}

/** Un `expires_at` relativo al momento del test: el TTL real es de 2 minutos. */
function expiresIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

/** Cumple las dos condiciones que el usuario controla: reconocer y reescribir la versión. */
async function confirmar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox'))
  await user.type(screen.getByLabelText(/Escribe el número de versión/), '0007')
}

describe('MigrationDeletePlanDialog', () => {
  it('con `deletable: false` NO ofrece borrar en ningún caso', async () => {
    mount({
      initialPlan: plan({
        deletable: false,
        requires_confirmation: false,
        renumber: [],
        blockers: [
          { managed_database_id: 7, reason: 'in_use', current_version: '0007' },
          { managed_database_id: 9, reason: 'unreadable' },
        ],
      }),
    })

    expect(
      screen.getByRole('heading', { name: 'No se puede eliminar la versión 0007' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('BD #7')).toBeInTheDocument()
    expect(screen.getByText('BD #9')).toBeInTheDocument()
    // Ni siquiera deshabilitado: un botón deshabilitado sugiere que hay forma de habilitarlo
    // desde aquí, y no la hay. La salida está en las BDs, no en este diálogo.
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument()
  })

  it('muestra los `warnings[]` del plan tal cual y sin resumir', () => {
    const otroAviso = 'Dos bases están más adelante y se les moverá el puntero.'
    mount({ initialPlan: plan({ warnings: [WARNING_OBJETOS, otroAviso] }) })

    // El primero es obligación del contrato: dice que el borrado NO revierte nada en el motor.
    expect(screen.getByText(WARNING_OBJETOS)).toBeInTheDocument()
    expect(screen.getByText(otroAviso)).toBeInTheDocument()
  })

  it('sin confirmación, reescribir la versión habilita el borrado y el DELETE va sin token', async () => {
    const { user, deleteUrls } = mount({
      initialPlan: plan({ requires_confirmation: false, confirm_token: null }),
    })

    const borrar = screen.getByRole('button', { name: 'Eliminar la versión 0007' })
    expect(borrar).toBeDisabled()

    await user.type(screen.getByLabelText(/Escribe el número de versión/), '0007')
    expect(borrar).toBeEnabled()

    await user.click(borrar)
    await waitFor(() => expect(deleteUrls).toHaveLength(1))
    // Mandar el token siempre entrenaría al cliente a mandarlo siempre y vaciaría de sentido la
    // confirmación de los planes que SÍ escriben en el motor.
    expect(new URL(deleteUrls[0]!).searchParams.has('confirm_token')).toBe(false)
  })

  it('con confirmación exige las TRES condiciones: reconocer, reescribir y token vigente', async () => {
    const { user } = mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-123',
        expires_at: expiresIn(120_000),
        stamp_plan: [
          {
            managed_database_id: 7,
            database_name: 'app_prod',
            from_version: '0020',
            to_version: '0019',
          },
        ],
      }),
    })

    const borrar = screen.getByRole('button', { name: /Eliminar 0007 y mover los punteros/ })
    // (a) Sin nada.
    expect(borrar).toBeDisabled()

    // (b) Solo el reconocimiento.
    await user.click(screen.getByRole('checkbox'))
    expect(borrar).toBeDisabled()

    // (c) Solo la versión reescrita, y encima mal escrita.
    await user.click(screen.getByRole('checkbox'))
    await user.type(screen.getByLabelText(/Escribe el número de versión/), '0008')
    expect(borrar).toBeDisabled()

    // Las dos juntas, con el token vivo: recién ahí.
    await user.clear(screen.getByLabelText(/Escribe el número de versión/))
    await confirmar(user)
    expect(borrar).toBeEnabled()
  })

  it('lista el `stamp_plan` como escrituras remotas, con nombre o degradando a «BD #id»', () => {
    mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-123',
        expires_at: expiresIn(120_000),
        stamp_plan: [
          {
            managed_database_id: 7,
            database_name: 'app_prod',
            from_version: '0020',
            to_version: '0019',
          },
          { managed_database_id: 9, from_version: '0018', to_version: '0017' },
        ],
      }),
    })

    expect(screen.getByText(/Se va a escribir en estas 2 base\(s\)/)).toBeInTheDocument()
    expect(screen.getByText('app_prod')).toBeInTheDocument()
    // Un nombre que falta no es un fallo de la operación; esconder la fila por no poder titularla
    // sí lo sería.
    expect(screen.getByText('BD #9')).toBeInTheDocument()
    expect(screen.getByText(/escritura remota/)).toBeInTheDocument()
  })

  it('con el token caducado no se puede confirmar, y NO se re-planifica solo', () => {
    const { planCalls } = mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-viejo',
        expires_at: expiresIn(-5_000),
        stamp_plan: [{ managed_database_id: 7, from_version: '0020', to_version: '0019' }],
      }),
    })

    expect(
      screen.getByRole('button', { name: /Eliminar 0007 y mover los punteros/ }),
    ).toBeDisabled()
    expect(screen.getByText('La autorización de este plan caducó')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Volver a comprobar' }).length).toBeGreaterThan(0)
    // Cada plan nuevo puede describir OTRAS bases: pedirlo solo dejaría al usuario mirando una
    // lista que no leyó, con el reconocimiento ya marcado.
    expect(planCalls.count).toBe(0)
  })

  it('un 410 del DELETE avisa de la caducidad, ofrece re-planificar y no cierra el diálogo', async () => {
    const { user, onClose } = mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-123',
        expires_at: expiresIn(120_000),
        stamp_plan: [{ managed_database_id: 7, from_version: '0020', to_version: '0019' }],
      }),
      onDelete: () =>
        HttpResponse.json(errorBody('El token de confirmación expiró.'), { status: 410 }),
    })

    await confirmar(user)
    await user.click(screen.getByRole('button', { name: /Eliminar 0007 y mover los punteros/ }))

    expect(await screen.findByText('La confirmación caducó')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver a comprobar el plan' })).toBeInTheDocument()
    // El diálogo sigue en pie: cerrarlo obligaría a rehacer el camino entero desde la ficha.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: /Eliminar la versión 0007/ })).toBeInTheDocument()
  })

  it('un 422 sin `code` dice que el parque cambió, sin culpar al operador', async () => {
    const { user } = mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-123',
        expires_at: expiresIn(120_000),
        stamp_plan: [{ managed_database_id: 7, from_version: '0020', to_version: '0019' }],
      }),
      onDelete: () =>
        HttpResponse.json(errorBody('El token no corresponde a esta operación.'), { status: 422 }),
    })

    await confirmar(user)
    await user.click(screen.getByRole('button', { name: /Eliminar 0007 y mover los punteros/ }))

    expect(await screen.findByText('El plan ya no describe la realidad')).toBeInTheDocument()
    expect(screen.getByText(/alguna se movió mientras tanto/)).toBeInTheDocument()
    // El token se invalida porque el parque cambió por debajo, no porque el usuario hiciera algo
    // mal: el texto tiene que decirlo, o el operador busca su propio error y no lo encuentra.
    expect(screen.getByText(/No es un fallo tuyo/)).toBeInTheDocument()
  })

  it('un `renumber_stamp_failed` COMPENSADO deja reintentar', async () => {
    const { user } = mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-123',
        expires_at: expiresIn(120_000),
        stamp_plan: [{ managed_database_id: 7, from_version: '0020', to_version: '0019' }],
      }),
      onDelete: () =>
        HttpResponse.json(
          errorBody('Falló al mover los punteros.', {
            code: 'model_migration.renumber_stamp_failed',
            compensated: true,
          }),
          { status: 409 },
        ),
    })

    await confirmar(user)
    await user.click(screen.getByRole('button', { name: /Eliminar 0007 y mover los punteros/ }))

    expect(
      await screen.findByText('Falló al mover los punteros y se deshizo todo'),
    ).toBeInTheDocument()
    // Todo volvió a su sitio: no hay trabajo manual pendiente, así que reintentar es legítimo.
    expect(screen.getByRole('button', { name: 'Volver a comprobar el plan' })).toBeInTheDocument()
  })

  it('un `renumber_stamp_failed` SIN compensar lista las bases torcidas y NO ofrece reintentar', async () => {
    const { user } = mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-123',
        expires_at: expiresIn(120_000),
        stamp_plan: [{ managed_database_id: 7, from_version: '0020', to_version: '0019' }],
      }),
      onDelete: () =>
        HttpResponse.json(
          errorBody('Falló al mover los punteros.', {
            code: 'model_migration.renumber_stamp_failed',
            left_moved: [
              {
                managed_database_id: 7,
                database_name: 'app_prod',
                from_version: '0020',
                to_version: '0019',
              },
              { managed_database_id: 9, from_version: '0018', to_version: '0017' },
            ],
          }),
          { status: 409 },
        ),
    })

    await confirmar(user)
    await user.click(screen.getByRole('button', { name: /Eliminar 0007 y mover los punteros/ }))

    expect(
      await screen.findByText('Falló al mover los punteros y algunas bases quedaron mal marcadas'),
    ).toBeInTheDocument()
    expect(screen.getByText('app_prod')).toBeInTheDocument()
    expect(screen.getByText('BD #9')).toBeInTheDocument()
    expect(screen.getByText(/stamp manual/)).toBeInTheDocument()
    // `compensated` ausente significa que quedaron punteros torcidos. Un botón de reintento al
    // lado invita a saltarse el arreglo manual, y el reintento recalcularía el plan sobre
    // punteros que el backend ya no cree que estén donde están.
    expect(
      screen.queryByRole('button', { name: 'Volver a comprobar el plan' }),
    ).not.toBeInTheDocument()
  })

  it('tras el 200 nombra las bases de `stamped[]` y al cerrar avisa al padre', async () => {
    const { user, onDeleted } = mount({
      initialPlan: plan({
        requires_confirmation: true,
        confirm_token: 'tok-123',
        expires_at: expiresIn(120_000),
        stamp_plan: [{ managed_database_id: 7, from_version: '0020', to_version: '0019' }],
      }),
      onDelete: () =>
        HttpResponse.json({
          data: deleteResult({
            stamped: [
              {
                managed_database_id: 7,
                database_name: 'app_prod',
                from_version: '0020',
                to_version: '0019',
              },
            ],
          }),
        }),
    })

    await confirmar(user)
    await user.click(screen.getByRole('button', { name: /Eliminar 0007 y mover los punteros/ }))

    expect(
      await screen.findByRole('heading', { name: 'Versión 0007 eliminada' }),
    ).toBeInTheDocument()
    // Se pinta lo EJECUTADO, no lo planeado: entre el plan y el borrado pasaron hasta dos minutos.
    expect(screen.getByText(/Se escribió en estas 1 base\(s\)/)).toBeInTheDocument()
    expect(screen.getByText('app_prod')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Volver al blueprint' }))
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })
})
