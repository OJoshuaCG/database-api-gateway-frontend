import { Badge, Callout } from '@/components/ui'
import type { GrantOutcomeRow } from './grant-logic'

interface GrantOutcomesProps {
  title: string
  rows: GrantOutcomeRow[]
}

/**
 * Resultado por base de la última operación.
 *
 * Existe porque **el status HTTP no alcanza para saber si salió bien**: el bulk de perfiles
 * responde 200 aunque todas las bases hayan fallado (v21 §11), y el fan-out de privilegios
 * sueltos son N llamadas independientes de las que unas pueden fallar y otras no (§12). Una
 * pantalla que solo mostrara un toast de éxito reportaría un lote entero fallido como aplicado.
 *
 * Los `errors` se muestran **siempre**, incluso con grants aplicados: el perfil puede quedar
 * aplicado a medias y **nunca hay rollback** de lo ya otorgado (§9).
 */
export function GrantOutcomes({ title, rows }: GrantOutcomesProps) {
  if (rows.length === 0) return null

  const failed = rows.filter((row) => !row.ok)
  const ok = rows.length - failed.length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge tone={failed.length === 0 ? 'success' : ok === 0 ? 'error' : 'warning'}>
          {ok} de {rows.length} sin errores
        </Badge>
      </div>

      {failed.length > 0 && (
        <Callout tone="danger" title={`${failed.length} destino(s) con errores`}>
          Lo que sí se otorgó <strong>queda otorgado</strong>: no hay rollback. Corregí lo que falló
          y volvé a aplicar solo sobre esos destinos.
        </Callout>
      )}

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.label} className="flex flex-col gap-1 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={row.ok ? 'success' : 'error'}>{row.ok ? 'OK' : 'Error'}</Badge>
              <span className="font-mono text-sm text-foreground">{row.label}</span>
              {row.detail && <span className="text-xs text-muted-foreground">{row.detail}</span>}
            </div>
            {row.skippedLevels && (
              <p className="text-xs text-muted-foreground">
                Niveles omitidos (sin objeto mapeado): {row.skippedLevels.join(', ')}
              </p>
            )}
            {row.errors?.map((error, index) => (
              <p key={index} className="text-xs text-error">
                {error}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
