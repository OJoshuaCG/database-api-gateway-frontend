import { Link } from 'react-router-dom'
import { BanIcon, Button, CodeBlock } from '@/components/ui'
import { type QueryReasonOut } from '@/lib/contracts'
import { BLOCKED_RATIONALE, reasonLink } from '../messages'

export interface BlockedNoticeProps {
  reasons: QueryReasonOut[]
  serverId: number
  /** Las sentencias del lote clasificadas como `blocked`, para señalar cuál es cuál. */
  statements?: { seq: number; sql: string }[]
}

/**
 * Aviso del nivel `blocked`: la consola no ejecuta esto ni con confirmación.
 *
 * Deliberadamente no ofrece reintentar ni «confirmar igual». No es un fallo transitorio que se
 * pueda insistir, es una prohibición estable de la política del gateway, y un botón de reintento
 * solo enseñaría a pulsarlo dos veces antes de leer. Lo que sí ofrece —y es lo que convierte el
 * muro en una salida— es el enlace al módulo del gateway que sí hace esa operación, con sus
 * propios guards y su auditoría.
 */
export function BlockedNotice({ reasons, serverId, statements }: BlockedNoticeProps) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-error/30 bg-error/5 p-3"
    >
      <div className="flex items-start gap-2">
        <BanIcon className="mt-0.5 h-4 w-4 shrink-0 text-error" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-error">
            Esta operación no se ejecuta desde la consola
          </p>
          <p className="text-sm text-foreground">
            No hay confirmación que la habilite: nunca se va a tocar el motor con este SQL.
          </p>
        </div>
      </div>

      <ul className="flex list-none flex-col gap-2">
        {reasons.map((reason, index) => {
          const link = reasonLink(reason.code, serverId)
          return (
            <li
              // El backend puede repetir un código con mensajes distintos (una sentencia por
              // motivo), así que el índice entra en la clave.
              key={`${reason.code}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2.5"
            >
              {/* El mensaje viene ya redactado en español por el backend: se muestra tal cual
                  para que la consola y la API no digan cosas distintas del mismo bloqueo. */}
              <span className="min-w-0 flex-1 text-sm text-foreground">{reason.message}</span>
              {link && (
                <Link to={link.to}>
                  <Button variant="outline" size="sm">
                    {link.label}
                  </Button>
                </Link>
              )}
            </li>
          )
        })}
      </ul>

      {statements && statements.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sentencias prohibidas del lote
          </p>
          {statements.map((statement) => (
            <CodeBlock
              key={statement.seq}
              code={statement.sql}
              title={`#${statement.seq + 1}`}
              maxHeightClass="max-h-40"
              hideLineNumbers
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{BLOCKED_RATIONALE}</p>
    </section>
  )
}
