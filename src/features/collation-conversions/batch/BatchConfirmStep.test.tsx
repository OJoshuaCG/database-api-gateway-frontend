import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ApiError } from '@/lib/api/errors'
import type { CollationBatchPlanOut } from '@/lib/contracts'
import { BatchConfirmStep } from './BatchConfirmStep'

/**
 * La pantalla de confirmación del lote es la última barrera antes de reescribir tablas en N bases
 * de datos reales. Lo que se prueba acá no es que renderice: es que **no deje ejecutar** hasta
 * tener lo que el contrato exige, y que muestre lo que, callado, haría creer al operador algo
 * falso (`capped`, `runs_serially`).
 */

const PLAN: CollationBatchPlanOut = {
  batch_id: 42,
  model_id: 7,
  model_slug: 'tienda',
  target_charset: 'utf8mb4',
  target_collation: 'utf8mb4_0900_ai_ci',
  total_eligible: 5,
  max_databases: 2,
  capped: true,
  batch_token: 'tok-abc',
  expires_at: '2026-08-26T10:00:00Z',
  runs_serially: true,
  databases: [
    {
      managed_database_id: 55,
      server_id: 3,
      database_name: 'tienda_prod',
      batch_seq: 1,
      job_id: 101,
      ok: true,
      error: null,
      error_code: null,
      tables_to_convert: 40,
      objects_to_recreate: 6,
      include_database_default: true,
      missing_tables: [],
      warnings: [],
      confirm_token: 'ct-1',
    },
    {
      managed_database_id: 56,
      server_id: 4,
      database_name: 'analitica',
      batch_seq: 2,
      job_id: null,
      ok: false,
      error: 'no aplica',
      error_code: 'collation.engine_not_applicable',
      tables_to_convert: 0,
      objects_to_recreate: 0,
      include_database_default: false,
      missing_tables: [],
      warnings: [],
      confirm_token: null,
    },
  ],
}

function setup(executeError: unknown = null) {
  const onExecute = vi.fn()
  renderWithProviders(
    <BatchConfirmStep
      plan={PLAN}
      isExecuting={false}
      executeError={executeError}
      onExecute={onExecute}
      onReplan={vi.fn()}
    />,
  )
  return { onExecute }
}

describe('BatchConfirmStep', () => {
  it('no deja ejecutar hasta que el slug del blueprint coincida', async () => {
    const user = userEvent.setup()
    const { onExecute } = setup()

    const boton = screen.getByRole('button', { name: /convertir 2 bases/i })
    expect(boton).toBeDisabled()

    await user.type(screen.getByLabelText(/identificador del blueprint/i), 'tiend')
    expect(boton).toBeDisabled()

    await user.type(screen.getByLabelText(/identificador del blueprint/i), 'a')
    expect(boton).toBeEnabled()

    await user.click(boton)
    expect(onExecute).toHaveBeenCalledOnce()
  })

  it('manda el conjunto previsualizado ENTERO, sin filtrar las que no aplican', async () => {
    // El backend valida esto fail-closed. Recortarlo acá "porque esas no se van a convertir"
    // sería adivinar su criterio, y produce un 422 que parece un bug del servidor.
    const user = userEvent.setup()
    const { onExecute } = setup()
    await user.type(screen.getByLabelText(/identificador del blueprint/i), 'tienda')
    await user.click(screen.getByRole('button', { name: /convertir 2 bases/i }))
    expect(onExecute.mock.calls[0]?.[0]).toMatchObject({ database_ids: [55, 56] })
  })

  it('muestra que el tope dejó bases afuera', () => {
    // Silenciarlo haría creer que se convirtió el blueprint entero.
    setup()
    expect(screen.getByText(/5/)).toBeInTheDocument()
    expect(screen.getByText(/quedan sin convertir|Las demás quedan sin convertir/i)).toBeInTheDocument()
  })

  it('avisa que el lote corre en serie', () => {
    // Sin esto el monitor parece colgado: una base "en curso" y el resto quieto durante horas.
    setup()
    expect(screen.getByText(/una después de otra/i)).toBeInTheDocument()
  })

  it('una base de otro motor NO se pinta como error', () => {
    // Es el sistema funcionando, no algo roto. Pintarla de rojo junto a las falladas obliga a
    // leer N frases para saber cuáles necesitan acción.
    setup()
    expect(screen.getByText('No aplica')).toBeInTheDocument()
    expect(screen.queryByText('Error')).not.toBeInTheDocument()
  })

  it('el 422 de confirmación pide re-tipear SOLO las bases que el backend nombró', async () => {
    const user = userEvent.setup()
    const error = new ApiError({
      status: 422,
      message: 'Escribí el nombre exacto…',
      code: 'collation.batch_confirmation_required',
      collationContext: { requiresConfirmation: [55] },
    })
    const { onExecute } = setup(error)

    // Solo la 55 pide re-tipeo; la 56 no.
    expect(screen.getByLabelText(/escribí "tienda_prod"/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/escribí "analitica"/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/identificador del blueprint/i), 'tienda')
    const boton = screen.getByRole('button', { name: /convertir 2 bases/i })
    // Con el slug puesto pero sin el re-tipeo, sigue bloqueado: son controles independientes.
    expect(boton).toBeDisabled()

    await user.type(screen.getByLabelText(/escribí "tienda_prod"/i), 'tienda_prod')
    expect(boton).toBeEnabled()

    await user.click(boton)
    expect(onExecute.mock.calls[0]?.[0]).toMatchObject({
      confirmations: { '55': 'tienda_prod' },
    })
  })

  it('un re-tipeo equivocado no habilita el botón', async () => {
    const user = userEvent.setup()
    setup(
      new ApiError({
        status: 422,
        message: 'x',
        code: 'collation.batch_confirmation_required',
        collationContext: { requiresConfirmation: [55] },
      }),
    )
    await user.type(screen.getByLabelText(/identificador del blueprint/i), 'tienda')
    await user.type(screen.getByLabelText(/escribí "tienda_prod"/i), 'tienda_pro')
    expect(screen.getByRole('button', { name: /convertir 2 bases/i })).toBeDisabled()
  })

  it('el desajuste de conjuntos muestra los dos lados, no solo la frase', () => {
    // Un "el conjunto cambió" sin decir en qué es un muro. Con los dos conjuntos a la vista, el
    // operador ve exactamente cuál sobra o falta.
    setup(
      new ApiError({
        status: 422,
        message: 'El conjunto cambió',
        code: 'collation.batch_database_set_mismatch',
        collationContext: { plannedDatabaseIds: [55, 56], receivedDatabaseIds: [55] },
      }),
    )
    expect(screen.getByText(/Planificadas: 55, 56/)).toBeInTheDocument()
    expect(screen.getByText(/Enviadas: 55/)).toBeInTheDocument()
  })
})
