import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge, DataTable, EmptyState, ErrorState, type BadgeTone } from '@/components/ui'
import type { CollationDriftRowOut, CollationDriftStatus } from '@/lib/contracts'
import { useCollationDrift } from '../hooks/use-collation-batches'

/**
 * Deriva de collation de un blueprint: lo DECLARADO contra lo que el inventario del gateway
 * registró en cada base.
 *
 * ⚠️ **Esto NO lee el motor.** Es la caché del gateway, y por eso el endpoint no tiene rate limit
 * ni 🔌. `source_note` lo dice y se muestra **textual**: esta pantalla se usa para decidir
 * conversiones, así que presentarla como si fuera la verdad del motor sería peor que no tenerla.
 */

/**
 * Cómo se pinta cada estado, y por qué **`unknown` no comparte tono con `ok`**.
 *
 * Pintarlos igual le diría al operador «todo está bien» sobre bases de las que no se sabe nada:
 * el inventario nunca registró su collation. Es una afirmación distinta de «coincide», y la
 * diferencia importa justo cuando se decide si hace falta convertir.
 *
 * `not_applicable` es PostgreSQL: allá el concepto es `encoding` + `lc_collate`, que no son
 * equivalentes a charset/collation de MySQL. No es un problema, es que la pregunta no aplica.
 */
const STATUS_META: Record<CollationDriftStatus, { label: string; tone: BadgeTone; hint: string }> = {
  ok: {
    label: 'Coincide',
    tone: 'success',
    hint: 'La collation registrada coincide con la declarada en el blueprint.',
  },
  drifted: {
    label: 'Derivada',
    tone: 'error',
    hint: 'La collation registrada NO coincide con la declarada.',
  },
  unknown: {
    label: 'Sin dato',
    tone: 'warning',
    hint: 'El inventario no tiene registrada la collation de esta base. No se sabe si coincide.',
  },
  undeclared: {
    label: 'Sin declarar',
    tone: 'neutral',
    hint: 'El blueprint no declara charset/collation, así que no hay contra qué comparar.',
  },
  not_applicable: {
    label: 'No aplica',
    tone: 'neutral',
    hint: 'PostgreSQL usa encoding + lc_collate, que no son equivalentes a charset/collation.',
  },
}

/** De dónde salió el dato de la fila. Ver el porqué en el JSDoc de la columna. */
const SOURCE_LABEL: Record<CollationDriftRowOut['source_of_truth'], string> = {
  adopted: 'Adoptada',
  provisioned: 'Aprovisionada',
  unknown: 'Sin origen',
}

export function CollationDriftPanel({ modelId }: { modelId: number }) {
  const drift = useCollationDrift(modelId, true)

  const columns = useMemo<ColumnDef<CollationDriftRowOut>[]>(
    () => [
      {
        id: 'database_name',
        header: 'Base de datos',
        accessorKey: 'database_name',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{row.original.database_name}</span>
            <span className="text-xs text-muted-foreground">{row.original.server_name}</span>
          </div>
        ),
      },
      {
        id: 'environment_slug',
        header: 'Entorno',
        accessorKey: 'environment_slug',
        cell: ({ row }) =>
          row.original.environment_slug ? (
            <span className="text-sm text-foreground">{row.original.environment_slug}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Sin clasificar</span>
          ),
      },
      {
        id: 'collation',
        header: 'Collation registrada',
        accessorKey: 'collation',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-sm text-foreground">
              {row.original.collation ?? '—'}
            </span>
            {row.original.charset && (
              <span className="font-mono text-xs text-muted-foreground">
                {row.original.charset}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Estado',
        accessorKey: 'status',
        cell: ({ row }) => {
          const meta = STATUS_META[row.original.status]
          return (
            <Badge tone={meta.tone} title={meta.hint}>
              {meta.label}
            </Badge>
          )
        },
      },
      {
        id: 'source_of_truth',
        header: 'Origen del dato',
        accessorKey: 'source_of_truth',
        /**
         * No es metadato ocioso. `charset`/`collation` siguen siendo escribibles a mano por
         * `PATCH /managed-databases/{id}`, así que una fila puede decir «Coincide» porque alguien
         * lo tipeó, sin que nadie haya leído nunca el motor (deuda
         * `T-260824-lz-charset-managed-patch`). Con esta columna el operador puede distinguir un
         * «coincide» respaldado por una adopción real de uno declarado a mano.
         */
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {SOURCE_LABEL[row.original.source_of_truth]}
          </span>
        ),
      },
    ],
    [],
  )

  if (drift.isError && !drift.data) {
    return <ErrorState error={drift.error} title="No se pudo cargar la deriva de collation" />
  }

  const data = drift.data

  return (
    <div className="flex flex-col gap-4">
      {data && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Declarado en el blueprint
            </span>
            {data.declared ? (
              <span className="font-mono text-sm text-foreground">
                {data.declared.collation ?? '—'}
                {data.declared.charset && (
                  <span className="text-muted-foreground"> · {data.declared.charset}</span>
                )}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                Sin declarar. Se declara editando el blueprint.
              </span>
            )}
          </div>
          {/*
            `source_note` va TEXTUAL y no parafraseado: lo redacta el backend porque es él quien
            sabe de dónde salió el dato, y esta pantalla se usa para decidir conversiones sobre
            bases reales.
          */}
          <p className="text-xs text-muted-foreground">{data.source_note}</p>
        </div>
      )}

      <DataTable
        data={data?.databases ?? []}
        columns={columns}
        isLoading={drift.isLoading}
        isFetching={drift.isFetching}
        getRowId={(row) => String(row.managed_database_id)}
        searchPlaceholder="Buscar base de datos…"
        emptyState={
          <EmptyState
            title="El blueprint no tiene bases asociadas"
            description="Cuando se le asocien bases de datos gestionadas, acá se ve si su collation coincide con la declarada."
          />
        }
      />
    </div>
  )
}
