import type { ReactNode } from 'react'
import { Badge } from '@/components/ui'
import type { SchemaComparisonItemOut } from '@/lib/contracts'

function SqlBlock({ title, sql, extra }: { title: string; sql: string; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {extra}
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-foreground">
        {sql}
      </pre>
    </div>
  )
}

/** DDL exacto de un ítem del diff (solo lectura), más su rollback inferido si existe. */
export function SqlStatementViewer({ item }: { item: SchemaComparisonItemOut }) {
  return (
    <div className="flex flex-col gap-3">
      <SqlBlock title="DDL a ejecutar en el target" sql={item.sql} />
      {item.down_sql ? (
        <SqlBlock
          title="Rollback (down_sql)"
          sql={item.down_sql}
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
