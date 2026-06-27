import type { ReactNode } from 'react'
import { Badge } from '@/components/ui'
import type { ModelMigrationOut } from '@/lib/contracts'

function SqlBlock({ title, sql, extra }: { title: string; sql: string; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {extra}
      </div>
      <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-foreground">
        {sql}
      </pre>
    </div>
  )
}

/** Vista de solo lectura del SQL traducido y el rollback de una migración (§8). */
export function MigrationSqlView({ migration }: { migration: ModelMigrationOut }) {
  const rollback = migration.down_sql ?? migration.down_sql_suggested

  return (
    <div className="flex flex-col gap-4">
      <SqlBlock
        title="MySQL / MariaDB"
        sql={migration.translated.mysql}
        extra={migration.up_sql_mysql ? <Badge tone="warning">override manual</Badge> : null}
      />
      <SqlBlock
        title="PostgreSQL"
        sql={migration.translated.postgresql}
        extra={
          migration.up_sql_postgresql ? <Badge tone="warning">override manual</Badge> : null
        }
      />
      {rollback ? (
        <SqlBlock
          title="Rollback (down_sql)"
          sql={rollback}
          extra={
            migration.down_sql ? (
              <Badge tone="success">confirmado</Badge>
            ) : (
              <Badge tone="warning">sugerido (sin confirmar)</Badge>
            )
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Sin rollback. El rollback responderá 409 hasta que confirmes un down_sql.
        </p>
      )}
      <p className="text-xs text-muted-foreground">checksum: {migration.checksum}</p>
    </div>
  )
}
