import { Badge, Callout, ErrorState, Input, Spinner } from '@/components/ui'
import { itemStatusLabel, itemStatusTone } from '../logic'
import type { CloneBatchWizard } from '../use-clone-batch-wizard'

/**
 * Paso 3 — revisar el conjunto y confirmarlo con UN solo gesto.
 *
 * El gesto es re-tipear el nombre del SERVIDOR destino, no el de cada base. Con doce bases,
 * doce re-tipeos se vuelven copiar y pegar sin leer, y además protegen el eje equivocado: en un
 * lote el error catastrófico no es escribir mal un nombre, es que la lista entera apunte al
 * servidor que no era. El otro eje lo cierra el `confirm_token`, que ata el conjunto exacto de
 * filas: si cambia una, la confirmación deja de valer.
 */
export function ConfirmStep({ wizard }: { wizard: CloneBatchWizard }) {
  const { batch, items } = wizard

  if (batch.isLoading && !batch.data) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner /> Preparando el lote…
      </div>
    )
  }
  if (batch.isError && !batch.data) {
    return <ErrorState error={batch.error} title="No se pudo leer el plan del lote" />
  }
  if (!batch.data) return null

  const filas = items.data?.items ?? []
  const bloqueadas = filas.filter((row) => row.status === 'blocked')
  const ejecutables = filas.filter((row) => row.status !== 'blocked')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Confirmar el lote</h2>
        <p className="text-sm text-muted-foreground">
          Se clonarán {ejecutables.length} bases hacia{' '}
          <strong className="text-foreground">{wizard.targetServerName}</strong>, de a una por vez.
        </p>
      </div>

      {bloqueadas.length > 0 && (
        <Callout tone="warning" title={`${bloqueadas.length} bases no se van a clonar`}>
          <div className="flex flex-col gap-1">
            {bloqueadas.map((row) => (
              <p key={row.id} className="text-xs">
                <strong>{row.source_database_name}</strong> → {row.target_database_name}:{' '}
                {row.error}
              </p>
            ))}
          </div>
        </Callout>
      )}

      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-3">
        {ejecutables.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 break-all text-foreground">
              {row.source_database_name} <span className="text-muted-foreground">→</span>{' '}
              {row.target_database_name}
            </span>
            <Badge tone={row.target_mode === 'new' ? 'neutral' : 'warning'}>
              {row.target_mode === 'new' ? 'se crea' : 'existente'}
            </Badge>
          </div>
        ))}
      </div>

      <Callout tone="danger" title="Esto se ejecuta sobre bases de datos reales">
        Una vez confirmado, el lote arranca y no se puede deshacer más allá de cancelarlo — las
        bases ya copiadas quedan como estén.
      </Callout>

      <Input
        label="Escribí el nombre del servidor destino para confirmar"
        placeholder={wizard.targetServerName}
        value={wizard.confirmServerName}
        onChange={(event) => wizard.setConfirmServerName(event.target.value)}
        error={
          wizard.confirmServerName.length > 0 && !wizard.confirmMatches
            ? 'No coincide con el nombre del servidor destino.'
            : undefined
        }
        hint="Es la única confirmación del lote; no hace falta re-tipear cada base."
      />

      {wizard.execute.isError && (
        <ErrorState error={wizard.execute.error} title="No se pudo encolar el lote" />
      )}

      {/* Estado de las filas mientras el lote sigue sin confirmar (todas 'pending'). */}
      {filas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Estado actual:{' '}
          {[...new Set(filas.map((row) => row.status))].map((status) => (
            <Badge key={status} tone={itemStatusTone(status)}>
              {itemStatusLabel(status)}
            </Badge>
          ))}
        </p>
      )}
    </div>
  )
}
