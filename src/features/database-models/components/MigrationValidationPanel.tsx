import { Badge, Button, CodeBlock, Combobox, Spinner } from '@/components/ui'
import { toApiError } from '@/lib/api/errors'
import type { ManagedDatabaseOut, MigrationValidateOut } from '@/lib/contracts'
import { useModelDatabases } from '../hooks/use-database-models'
import { useValidateModelMigration } from '../hooks/use-model-migrations'

interface MigrationValidationPanelProps {
  modelId: number
  /** El SQL que hay ahora mismo en el formulario (vía `watch`). */
  upSql: string
  /** Collation declarado por el blueprint, para explicar los conflictos. */
  blueprintCollation?: string | null
}

/**
 * Validación del SQL de una migración **antes** de aplicarla (api-reference-v11 §1).
 *
 * Existe porque hasta ahora la única forma de saber si un delta era correcto era aplicarlo, y
 * para cuando fallaba ya había BDs en cuarentena. El caso que lo motivó —un `ALTER TABLE` sobre
 * una tabla que no existe— es sintácticamente impecable, así que **ningún análisis estático lo
 * detecta**: por eso se puede elegir una BD y contrastar contra su catálogo.
 *
 * La validación se dispara con un botón, nunca al teclear: el endpoint tiene rate limit y, con
 * BD elegida, abre una conexión al motor.
 */
export function MigrationValidationPanel({
  modelId,
  upSql,
  blueprintCollation,
}: MigrationValidationPanelProps) {
  const validate = useValidateModelMigration(modelId)
  // Solo se piden las BDs cuando ya hay algo que validar: en una migración nueva y vacía este
  // desplegable no aporta nada y sería una llamada de más al abrir el formulario.
  const databases = useModelDatabases(modelId, upSql.trim().length > 0)

  const result = validate.data
  const error = validate.error ? toApiError(validate.error) : null

  const run = (target: ManagedDatabaseOut | null) =>
    validate.mutate({ up_sql: upSql, managed_database_id: target?.id })

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">Validar SQL</span>
        <span className="text-xs text-muted-foreground">
          Comprueba sintaxis, traducción y riesgos sin aplicar nada.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={upSql.trim().length === 0}
          isLoading={validate.isPending}
          onClick={() => run(null)}
        >
          Validar
        </Button>
      </div>

      {(databases.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Combobox<ManagedDatabaseOut>
              label="Comprobar además contra una BD 🔌"
              hint="Verifica que las tablas que el SQL referencia existan de verdad. Es lo único que detecta un ALTER sobre una tabla inexistente."
              items={databases.data ?? []}
              value={null}
              onChange={(db) => db && run(db)}
              itemToString={(db) => db.name}
              itemToKey={(db) => db.id}
              placeholder="Elige una BD para comprobar…"
              disabled={validate.isPending || upSql.trim().length === 0}
            />
          </div>
        </div>
      )}

      {validate.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Analizando…
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs text-error">
          {error.message}
        </p>
      )}

      {result && !validate.isPending && (
        <ValidationResult result={result} blueprintCollation={blueprintCollation} />
      )}
    </div>
  )
}

function ValidationResult({
  result,
  blueprintCollation,
}: {
  result: MigrationValidateOut
  blueprintCollation?: string | null
}) {
  const declared = result.blueprint_collation ?? blueprintCollation ?? null
  const clean =
    result.parse_errors.length === 0 &&
    result.postgresql_blockers.length === 0 &&
    result.gateway_internal_tables.length === 0 &&
    result.missing_tables.length === 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {clean ? (
          <Badge tone="success">Sin problemas</Badge>
        ) : (
          <Badge tone="error">Revisa los avisos</Badge>
        )}
        {result.has_seed && <Badge tone="info">🌱 siembra datos</Badge>}
        {result.destructive_statements.length > 0 && (
          <Badge tone="warning">
            {result.destructive_statements.length} sentencia(s) destructiva(s)
          </Badge>
        )}
        {result.forced_collations.length > 0 && (
          <Badge tone="warning">COLLATE forzado: {result.forced_collations.join(', ')}</Badge>
        )}
        {!result.resumable && <Badge tone="neutral">no reanudable</Badge>}
        <span className="text-xs text-muted-foreground">
          {result.statements.length} sentencia(s)
        </span>
      </div>

      {/* Errores de sintaxis: es el aviso que más urge, va primero y con la sentencia entera. */}
      {result.parse_errors.map((e) => (
        <div key={e.seq} className="rounded-lg border border-error/40 bg-error/5 p-3">
          <p className="text-xs font-medium text-error">Sentencia #{e.seq + 1} no parsea</p>
          <p className="mt-1 text-xs text-error">{e.message}</p>
          <div className="mt-2">
            <CodeBlock code={result.statements[e.seq]?.sql ?? ''} hideLineNumbers />
          </div>
        </div>
      ))}

      {result.missing_tables.length > 0 && (
        <div className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs text-error">
          <p className="font-medium">
            Estas tablas no existen en {result.checked_database}: {result.missing_tables.join(', ')}
          </p>
          <p className="mt-1">
            Aplicar así fallaría en esa BD. La comparación ignora mayúsculas, así que un nombre
            listado aquí realmente no está.
          </p>
        </div>
      )}

      {result.catalog_error && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          No se pudo leer el catálogo de {result.checked_database}: {result.catalog_error}. El
          análisis estático de arriba sí es válido.
        </p>
      )}

      {result.postgresql_blockers.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          <p className="font-medium">No se traduce con certeza a PostgreSQL</p>
          <ul className="mt-1 list-inside list-disc">
            {result.postgresql_blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="mt-1">
            Aplicar a una BD PostgreSQL daría 422. Define un <code>up_sql_postgresql</code>{' '}
            explícito.
          </p>
        </div>
      )}

      {result.collation_conflicts.length > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          Esta migración fuerza <strong>{result.collation_conflicts.join(', ')}</strong>, pero el
          blueprint declara <strong>{declared}</strong>. Las BDs que lo replican quedarían con
          columnas fuera del esquema de referencia.
        </p>
      )}

      {result.gateway_internal_tables.length > 0 && (
        <p className="rounded-lg border border-error/40 bg-error/5 p-3 text-xs text-error">
          El SQL nombra tablas internas del gateway ({result.gateway_internal_tables.join(', ')}):
          el backend lo rechaza.
        </p>
      )}
    </div>
  )
}
