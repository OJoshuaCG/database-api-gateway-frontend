import { cn } from '@/lib/utils'

/**
 * Texto que reemplaza al código de un objeto de esquema (vista, rutina, trigger, evento) cuando el
 * servidor lo redactó (`redacted: true`): el rol de quien mira no tiene `schema.definitions`.
 */
export const REDACTED_DEFINITION_TEXT = 'Contenido oculto: tu rol no ve el código de este objeto'

/**
 * Aviso de «código oculto». Va EN LUGAR de un `CodeBlock` vacío: un bloque en blanco diría «este
 * objeto no tiene definición», que es falso. Nombra la capacidad en un `title` y no en el texto
 * visible para no cargar cada fila con jerga; quien la necesita la ve en «Mi acceso».
 */
export function RedactedDefinition({
  className,
  title,
}: {
  className?: string
  /** Nombre del objeto, para el nombre accesible cuando hay varios avisos en pantalla. */
  title?: string
}) {
  return (
    <p
      role="note"
      aria-label={title ? `${title}: código oculto` : undefined}
      title="Requiere la capacidad «schema.definitions» (operator y owner la tienen por rol)."
      className={cn(
        'rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground',
        className,
      )}
    >
      {REDACTED_DEFINITION_TEXT}
    </p>
  )
}
