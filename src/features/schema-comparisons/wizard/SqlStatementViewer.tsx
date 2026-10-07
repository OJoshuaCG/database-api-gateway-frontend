import { Badge, CodeBlock, RedactedDefinition } from '@/components/ui'
import type { SchemaComparisonItemOut } from '@/lib/contracts'

/** DDL exacto de un ítem del diff (solo lectura), más su rollback inferido si existe. */
export function SqlStatementViewer({ item }: { item: SchemaComparisonItemOut }) {
  // Sin `schema.definitions` el servidor manda el código vacío y marcado: se dice en vez de pintar
  // un bloque en blanco, que parecería un objeto sin definición.
  if (item.redacted) return <RedactedDefinition title={item.object_name} />
  return (
    <div className="flex flex-col gap-3">
      <CodeBlock title="DDL a ejecutar en el target" code={item.sql} maxHeightClass="max-h-56" />
      {item.down_sql ? (
        <CodeBlock
          title="Rollback (down_sql)"
          code={item.down_sql}
          maxHeightClass="max-h-56"
          extra={
            item.down_confirmed ? (
              <Badge tone="success">confiable</Badge>
            ) : (
              <Badge tone="warning">sin confirmar</Badge>
            )
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Sin rollback inferido con certeza para este ítem.
        </p>
      )}
    </div>
  )
}
