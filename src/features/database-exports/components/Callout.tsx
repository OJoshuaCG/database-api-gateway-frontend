import { Callout } from '@/components/ui'

/**
 * Bandas propias de la exportación de bases. El `Callout` genérico vive en
 * `src/components/ui/Callout.tsx` desde que las versiones de blueprint necesitaron bandas
 * también; acá quedan las dos que son de ESTA feature y no tienen sentido fuera de ella.
 */

/**
 * Lista de avisos del preview. **Se muestran todos, no solo el primero**: ahí viven a la vez el
 * aviso de consistencia del motor, las tablas sin clave primaria, el `.zip` implícito y los filtros
 * `where` definidos para tablas que no están en la selección de datos. Quedarse con el primero
 * esconde exactamente el que el operador necesitaba leer.
 */
export function WarningList({ warnings, title }: { warnings: readonly string[]; title: string }) {
  if (warnings.length === 0) return null
  return (
    <Callout tone="warning" title={title}>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {/* La `key` lleva el índice porque el backend puede repetir un aviso literal (dos tablas sin
            clave primaria dan el mismo texto) y una key duplicada reconcilia mal. */}
        {warnings.map((warning, index) => (
          <li key={`${index}:${warning}`}>{warning}</li>
        ))}
      </ul>
    </Callout>
  )
}

/**
 * Banda permanente sobre la naturaleza de la operación. El módulo **no tiene enmascarado de datos**:
 * lo que sale, sale en claro. No es un descuido, es un alcance decidido, y los controles
 * compensatorios son la confirmación de doble factor, el TTL corto, la descarga de un solo uso y
 * sobre todo la auditoría de cada descarga.
 *
 * Va como banda y no como tooltip a propósito: un tooltip se descubre por accidente, y esto tiene
 * que leerse antes de decidir.
 */
export function PlainDataNotice({ className }: { className?: string }) {
  return (
    <Callout
      tone="info"
      title="Esta exportación extrae los datos sin enmascarar"
      className={className}
    >
      <p>
        El artefacto contiene los valores reales en claro. Cada descarga queda registrada en la
        auditoría del gateway.
      </p>
    </Callout>
  )
}
