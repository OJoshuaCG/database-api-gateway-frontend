import { Badge, CodeBlock } from '@/components/ui'
import type { ModelMigrationOut } from '@/lib/contracts'

/** Vista de solo lectura del SQL traducido y el rollback de una migración (§8). */
export function MigrationSqlView({ migration }: { migration: ModelMigrationOut }) {
  const rollback = migration.down_sql ?? migration.down_sql_suggested

  return (
    <div className="flex flex-col gap-4">
      {migration.translated.mysql ? (
        <CodeBlock
          title="MySQL / MariaDB"
          code={migration.translated.mysql}
          extra={migration.up_sql_mysql ? <Badge tone="warning">override manual</Badge> : null}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Sin traducción para MySQL/MariaDB.</p>
      )}
      {migration.translated.postgresql ? (
        <CodeBlock
          title="PostgreSQL"
          code={migration.translated.postgresql}
          extra={migration.up_sql_postgresql ? <Badge tone="warning">override manual</Badge> : null}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Sin traducción para PostgreSQL.</p>
      )}
      {rollback ? (
        <CodeBlock
          title="Rollback (down_sql)"
          code={rollback}
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
