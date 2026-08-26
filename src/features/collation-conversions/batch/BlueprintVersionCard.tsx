import { useState } from 'react'
import { Badge, Button, Input, Spinner } from '@/components/ui'
import { ApiError } from '@/lib/api/errors'
import type { CollationBlueprintVersionOut } from '@/lib/contracts'
import { collationMessage } from '../messages'

/**
 * Versión de contabilidad del lote.
 *
 * **Lo que esta tarjeta tiene que dejar clarísimo, porque es la parte que se malinterpreta: la
 * versión se STAMPEA, no se aplica.** Es el registro de algo que YA ocurrió — las bases se
 * convirtieron con sus jobs, cada uno leyendo su propio inventario. La versión existe para que el
 * blueprint tenga constancia, no para reproducir la conversión en otra base.
 *
 * Por eso el `note` de la respuesta se muestra **textual**: dice que una base agregada al
 * blueprint DESPUÉS la va a tener pendiente, y que aplicársela le convertiría las tablas sin
 * recrearle los objetos con la collation congelada — el `Illegal mix of collations` de nuevo.
 * Para esa base el camino es su propio job de conversión y después `stamp`.
 */
export function BlueprintVersionCard({
  alreadyCreatedId,
  isCreating,
  createError,
  result,
  onCreate,
}: {
  /** `blueprint_version_id` del lote: si ya existe, no se ofrece crear otra. */
  alreadyCreatedId: number | null
  isCreating: boolean
  createError: unknown
  result: CollationBlueprintVersionOut | null
  onCreate: (name: string | null) => void
}) {
  const [name, setName] = useState('')

  const apiError = createError instanceof ApiError ? createError : null
  const ctx = apiError?.collationContext
  const codeMessage = collationMessage(apiError?.code)

  if (result) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Versión {result.version} creada
          </h3>
          <Badge tone="success">Stampeada</Badge>
          <span className="text-sm text-muted-foreground">
            {result.statement_count} sentencia{result.statement_count === 1 ? '' : 's'}
          </span>
        </div>

        {/* TEXTUAL: lo redacta el backend porque es la advertencia que evita el mal uso. */}
        <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {result.note}
        </p>

        <p className="text-sm text-muted-foreground">
          Marcada como aplicada en {result.stamped.filter((s) => s.ok).length} de{' '}
          {result.stamped.length} bases.
        </p>

        {result.pending_stamp.length > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <p>
              <strong>La versión existe y es correcta</strong>, pero no se pudo marcar como
              aplicada en {result.pending_stamp.length} base
              {result.pending_stamp.length === 1 ? '' : 's'}: {result.pending_stamp.join(', ')}.
            </p>
            <p className="mt-1">
              No hay nada que rehacer: falta solo la marca, y se pone a mano desde las migraciones
              de cada base.
            </p>
          </div>
        )}
      </div>
    )
  }

  if (alreadyCreatedId !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Versión ya creada</h3>
        <p className="text-sm text-muted-foreground">
          Este lote ya tiene su versión de contabilidad (migración #{alreadyCreatedId}).
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">Dejar constancia en el blueprint</h3>
      <p className="text-sm text-muted-foreground">
        Crea una versión que registra esta conversión y la marca como aplicada en las bases del
        lote. <strong>No se ejecuta nada</strong>: las bases ya se convirtieron.
      </p>

      <Input
        label="Nombre de la versión (opcional)"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={isCreating}
        maxLength={200}
        hint="Si se deja vacío, el backend le pone uno."
      />

      {(codeMessage ?? apiError) && (
        <div className="flex flex-col gap-1 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
          <p>{codeMessage ?? apiError?.message}</p>
          {/*
            El detalle del rechazo es lo que lo vuelve accionable. Un «el lote no terminó bien»
            sin decir en cuáles obliga a revisar N filas a mano.
          */}
          {ctx?.unfinished && <p className="font-mono text-xs">Sin terminar: {ctx.unfinished.join(', ')}</p>}
          {ctx?.engines && <p className="font-mono text-xs">Motores presentes: {ctx.engines.join(', ')}</p>}
          {ctx?.missingDatabaseIds && (
            <p className="font-mono text-xs">
              No participaron del lote: {ctx.missingDatabaseIds.join(', ')}
            </p>
          )}
          {ctx?.databasesBehind && (
            <p className="font-mono text-xs">
              Atrasadas respecto de la versión {ctx.headVersion}: {ctx.databasesBehind.join(', ')}
            </p>
          )}
          {ctx?.databaseName && <p className="font-mono text-xs">Base: {ctx.databaseName}</p>}
          {ctx?.quarantinedDatabaseIds && (
            <p className="font-mono text-xs">
              En cuarentena: {ctx.quarantinedDatabaseIds.join(', ')}
            </p>
          )}
          {ctx?.bytes !== undefined && ctx.maxBytes !== undefined && (
            <p className="font-mono text-xs">
              {ctx.bytes} bytes, máximo {ctx.maxBytes}
            </p>
          )}
        </div>
      )}

      <div>
        <Button onClick={() => onCreate(name.trim() || null)} disabled={isCreating}>
          {isCreating && <Spinner />}
          Crear la versión
        </Button>
      </div>
    </div>
  )
}
