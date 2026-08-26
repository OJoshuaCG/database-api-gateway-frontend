import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { ApiError } from '@/lib/api/errors'
import type { CollationBlueprintVersionOut } from '@/lib/contracts'
import { BlueprintVersionCard } from './BlueprintVersionCard'

/**
 * La versión de contabilidad es la parte que se malinterpreta: parece una migración y no lo es.
 * Lo que se prueba acá es que la pantalla no deje lugar a esa lectura — que el `note` del backend
 * salga **textual**, y que un `stamp` fallido no se lea como "la versión se perdió".
 */

const RESULT: CollationBlueprintVersionOut = {
  batch_id: 42,
  model_id: 7,
  version: 12,
  migration_id: 300,
  statement_count: 47,
  stamped: [
    { managed_database_id: 55, ok: true, error: null },
    { managed_database_id: 56, ok: false, error: 'timeout' },
  ],
  pending_stamp: [56],
  note: 'Una base agregada al blueprint después tendrá esta versión PENDIENTE, y aplicarla le convertiría las tablas sin recrear sus objetos.',
}

describe('BlueprintVersionCard', () => {
  it('muestra el note del backend TEXTUAL, sin parafrasear', () => {
    // No es celo editorial: ese texto es la advertencia que evita que alguien intente aplicar la
    // versión a una base nueva y provoque el Illegal mix of collations que el módulo previene.
    renderWithProviders(
      <BlueprintVersionCard
        alreadyCreatedId={null}
        isCreating={false}
        createError={null}
        result={RESULT}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByText(RESULT.note)).toBeInTheDocument()
  })

  it('dice "stampeada", no "aplicada"', () => {
    renderWithProviders(
      <BlueprintVersionCard
        alreadyCreatedId={null}
        isCreating={false}
        createError={null}
        result={RESULT}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByText('Stampeada')).toBeInTheDocument()
  })

  it('un stamp fallido NO se lee como que la versión se perdió', () => {
    // `pending_stamp` es la marca que falta, no la versión. Si la UI sugiriera reintentar la
    // creación, el operador crearía una segunda versión idéntica sobre el mismo lote.
    renderWithProviders(
      <BlueprintVersionCard
        alreadyCreatedId={null}
        isCreating={false}
        createError={null}
        result={RESULT}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByText(/La versión existe y es correcta/i)).toBeInTheDocument()
    expect(screen.getByText(/falta solo la marca/i)).toBeInTheDocument()
  })

  it('no ofrece crear otra si el lote ya tiene su versión', () => {
    renderWithProviders(
      <BlueprintVersionCard
        alreadyCreatedId={300}
        isCreating={false}
        createError={null}
        result={null}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /crear la versión/i })).not.toBeInTheDocument()
  })

  it('un rechazo muestra el detalle accionable, no solo la frase', () => {
    // "El lote no terminó bien en todas sus bases" sin decir en cuáles obliga a revisar N filas.
    renderWithProviders(
      <BlueprintVersionCard
        alreadyCreatedId={null}
        isCreating={false}
        createError={
          new ApiError({
            status: 409,
            message: 'x',
            code: 'collation.version_batch_not_complete',
            collationContext: { unfinished: ['tienda_prod', 'tienda_qa'] },
          })
        }
        result={null}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByText(/El lote no terminó bien en todas sus bases/i)).toBeInTheDocument()
    expect(screen.getByText(/tienda_prod, tienda_qa/)).toBeInTheDocument()
  })
})
