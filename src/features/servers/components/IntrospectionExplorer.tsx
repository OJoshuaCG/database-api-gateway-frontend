import { useState } from 'react'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
  EmptyState,
  ErrorState,
  Spinner,
} from '@/components/ui'
import {
  useEngineUsers,
  useServerDatabases,
  useTableSchema,
  useTables,
} from '../hooks/use-introspection'

/** Explorador de estructura (solo lectura, nunca filas) de un servidor alcanzable 🔌. */
export function IntrospectionExplorer({ serverId }: { serverId: number }) {
  const [database, setDatabase] = useState<string | null>(null)
  const [table, setTable] = useState<string | null>(null)

  const databases = useServerDatabases(serverId, true)
  const engineUsers = useEngineUsers(serverId, true)
  const tables = useTables(serverId, database, true)
  const schema = useTableSchema(serverId, database, table, true)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Estructura del servidor</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {databases.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Cargando bases de datos…
            </div>
          ) : databases.isError ? (
            <ErrorState error={databases.error} onRetry={() => void databases.refetch()} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Combobox<string>
                items={databases.data ?? []}
                value={database}
                onChange={(value) => {
                  setDatabase(value)
                  setTable(null)
                }}
                itemToString={(item) => item}
                itemToKey={(item) => item}
                label="Base de datos"
                placeholder="Selecciona una base de datos"
                clearable
              />
              <Combobox<string>
                items={tables.data ?? []}
                value={table}
                onChange={setTable}
                itemToString={(item) => item}
                itemToKey={(item) => item}
                label="Tabla"
                placeholder={database ? 'Selecciona una tabla' : 'Elige una base de datos primero'}
                disabled={!database}
                isLoading={tables.isFetching}
                clearable
              />
            </div>
          )}

          {database && tables.isError && (
            <ErrorState error={tables.error} onRetry={() => void tables.refetch()} />
          )}
          {database && !tables.isLoading && !tables.isError && (tables.data?.length ?? 0) === 0 && (
            <EmptyState title="Esta base de datos no tiene tablas" />
          )}

          {table && <TableSchemaView state={schema} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios del motor</CardTitle>
        </CardHeader>
        <CardContent>
          {engineUsers.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Cargando usuarios…
            </div>
          ) : engineUsers.isError ? (
            <ErrorState error={engineUsers.error} onRetry={() => void engineUsers.refetch()} />
          ) : (engineUsers.data?.length ?? 0) === 0 ? (
            <EmptyState title="No se encontraron usuarios en el motor" />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {engineUsers.data?.map((user) => (
                <li key={`${user.username}@${user.host ?? ''}`}>
                  <Badge tone="neutral">
                    {user.username}
                    {user.host ? `@${user.host}` : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

type SchemaState = ReturnType<typeof useTableSchema>

function TableSchemaView({ state }: { state: SchemaState }) {
  if (state.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando esquema…
      </div>
    )
  }
  if (state.isError) {
    return <ErrorState error={state.error} onRetry={() => void state.refetch()} />
  }
  if (!state.data) return null

  const { columns, primary_key, foreign_keys, indexes } = state.data

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Columna</th>
              <th className="px-3 py-2 font-semibold">Tipo</th>
              <th className="px-3 py-2 font-semibold">Nulo</th>
              <th className="px-3 py-2 font-semibold">Atributos</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column.name} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium text-foreground">{column.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{column.type}</td>
                <td className="px-3 py-2 text-muted-foreground">{column.nullable ? 'Sí' : 'No'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {column.primary_key && <Badge tone="primary">PK</Badge>}
                    {column.autoincrement && <Badge tone="neutral">auto</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SchemaFacts title="Clave primaria" items={primary_key} empty="—" />
        <SchemaFacts
          title="Índices"
          items={indexes.map((index) => `${index.name}${index.unique ? ' (único)' : ''}`)}
          empty="Sin índices"
        />
        <SchemaFacts
          title="Claves foráneas"
          items={foreign_keys.map(
            (fk) =>
              `${fk.columns.join(', ')} → ${fk.referred_table}(${fk.referred_columns.join(', ')})`,
          )}
          empty="Sin claves foráneas"
        />
      </div>
    </div>
  )
}

function SchemaFacts({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-sm text-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
