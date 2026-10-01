import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckIcon,
  Checkbox,
  Combobox,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Spinner,
  StatusLegend,
} from '@/components/ui'
import {
  CAPABILITY_FLAG_LEGEND,
  CapabilityFlags,
  useCapabilityCatalog,
  useSession,
  catalogGlobalCapabilities,
  catalogRoles,
  diffCapabilities,
  globalCapabilityIds,
  groupByModule,
  isDestructive,
  roleCapabilityIds,
  scopeAxisLabel,
  sortByRisk,
  summarizeLabels,
} from '@/features/auth'
import type { CapabilityDescriptor } from '@/lib/contracts'

/** Una columna de la matriz: un rol o una capacidad global. */
interface Grantor {
  key: string
  kind: 'role' | 'global'
  grants: (row: CapabilityDescriptor) => boolean
}

interface RoleFilterOption {
  value: string | null
  label: string
}

/**
 * «Roles y capacidades» — qué otorga cada rol y cada capacidad global, leído del catálogo del
 * servidor (`GET /authz/catalog`).
 *
 * Existe porque la pregunta «¿qué puede hacer un operator?» no tenía respuesta en la UI: los
 * selectores de rol llevaban una frase escrita a mano que llegó a ser falsa. Acá no hay nada
 * escrito a mano salvo los nombres de los módulos: los conjuntos salen de las columnas `roles` y
 * `global_capabilities` de cada fila.
 */
export function RolesCapabilitiesPanel() {
  const { admin, isLoading: sessionLoading } = useSession()
  const catalogQuery = useCapabilityCatalog()
  const versionMissing = !sessionLoading && admin != null && !admin.catalog_version

  if (versionMissing) {
    return (
      <EmptyState
        title="El catálogo de capacidades no está disponible"
        description="Este backend no publica el catálogo de capacidades. Actualizalo para ver qué otorga cada rol."
      />
    )
  }
  if (catalogQuery.isError) {
    return (
      <ErrorState
        error={catalogQuery.error}
        title="No se pudo cargar el catálogo de capacidades"
        onRetry={() => void catalogQuery.refetch()}
      />
    )
  }
  if (!catalogQuery.data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Cargando el catálogo de capacidades…
      </div>
    )
  }
  return <RolesMatrix catalog={catalogQuery.data} />
}

function RolesMatrix({ catalog }: { catalog: CapabilityDescriptor[] }) {
  const roles = useMemo(() => catalogRoles(catalog), [catalog])
  const globals = useMemo(() => catalogGlobalCapabilities(catalog), [catalog])
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [onlyDestructive, setOnlyDestructive] = useState(false)
  const [onlyDisclosing, setOnlyDisclosing] = useState(false)

  const grantors = useMemo<Grantor[]>(
    () => [
      ...roles.map((key) => ({
        key,
        kind: 'role' as const,
        grants: (row: CapabilityDescriptor) => row.roles.includes(key),
      })),
      ...globals.map((key) => ({
        key,
        kind: 'global' as const,
        grants: (row: CapabilityDescriptor) => row.global_capabilities.includes(key),
      })),
    ],
    [roles, globals],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return catalog.filter(
      (row) =>
        (!query ||
          row.label.toLowerCase().includes(query) ||
          row.id.toLowerCase().includes(query) ||
          row.module.toLowerCase().includes(query)) &&
        (!onlyDestructive || isDestructive(row)) &&
        (!onlyDisclosing || row.discloses),
    )
  }, [catalog, search, onlyDestructive, onlyDisclosing])

  const columns = useMemo<ColumnDef<CapabilityDescriptor>[]>(() => {
    const selected = role === null ? null : grantors.find((grantor) => grantor.key === role)
    const grantColumns: ColumnDef<CapabilityDescriptor>[] = (selected ? [selected] : grantors).map(
      (grantor) => ({
        id: `grant-${grantor.key}`,
        header: selected ? '¿La otorga?' : grantor.key,
        enableSorting: false,
        cell: ({ row }) => <GrantMark granted={grantor.grants(row.original)} />,
      }),
    )
    return [
      {
        accessorKey: 'label',
        header: 'Capacidad',
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-foreground">{row.original.label}</span>
            <code className="font-mono text-xs text-muted-foreground">{row.original.id}</code>
            <CapabilityFlags capability={row.original} />
          </div>
        ),
      },
      {
        id: 'scope',
        header: 'Alcance',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {scopeAxisLabel(row.original.scope_axis)}
          </span>
        ),
      },
      ...grantColumns,
    ]
  }, [grantors, role])

  const roleOptions = useMemo<RoleFilterOption[]>(
    () => [
      { value: null, label: 'Todos' },
      ...grantors.map((grantor) => ({ value: grantor.key, label: grantor.key })),
    ],
    [grantors],
  )

  const groups = groupByModule(filtered)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Cada rol es un conjunto fijo de capacidades. Un permiso por entorno o servidor reemplaza el
        rol base ahí; no se suma.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {roles.map((key, index) => (
          <RoleCard
            key={key}
            role={key}
            previous={index > 0 ? roles[index - 1] : undefined}
            catalog={catalog}
          />
        ))}
      </div>

      {globals.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            Capacidades globales (se suman a cualquier rol)
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {globals.map((key) => (
              <GlobalCard key={key} globalCapability={key} catalog={catalog} />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
          <Input
            label="Buscar capacidad"
            placeholder="Nombre, id o módulo…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            hint={`${filtered.length} de ${catalog.length} capacidades`}
          />
          <Combobox<RoleFilterOption>
            items={roleOptions}
            value={roleOptions.find((option) => option.value === role) ?? null}
            onChange={(option) => setRole(option?.value ?? null)}
            itemToString={(option) => option.label}
            itemToKey={(option) => option.value ?? '__all__'}
            label="Rol"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox
            label="Solo destructivas"
            checked={onlyDestructive}
            onChange={(event) => setOnlyDestructive(event.target.checked)}
          />
          <Checkbox
            label="Solo las que divulgan datos"
            checked={onlyDisclosing}
            onChange={(event) => setOnlyDisclosing(event.target.checked)}
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Ninguna capacidad coincide"
          description="Probá con otra búsqueda o quitá los filtros."
        />
      ) : (
        <>
          <StatusLegend items={CAPABILITY_FLAG_LEGEND} title="Qué significa cada marca" />
          {groups.map((group) => (
            <section key={group.module} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
              <DataTable
                data={group.rows}
                columns={columns}
                enableGlobalFilter={false}
                getRowId={(row) => row.id}
              />
            </section>
          ))}
        </>
      )}
    </div>
  )
}

/** «Sí» o «—», siempre con texto visible; el lector de pantalla oye «No» en vez de «guion». */
function GrantMark({ granted }: { granted: boolean }) {
  return granted ? (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
      <CheckIcon />
      Sí
    </span>
  ) : (
    <span className="text-sm text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">No</span>
    </span>
  )
}

function riskCounts(ids: readonly string[], catalog: readonly CapabilityDescriptor[]) {
  const rows = sortByRisk(ids, catalog)
  return {
    destructive: rows.filter(isDestructive).length,
    disclosing: rows.filter((row) => row.discloses).length,
  }
}

function RiskBadges({ ids, catalog }: { ids: readonly string[]; catalog: CapabilityDescriptor[] }) {
  const counts = riskCounts(ids, catalog)
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={counts.destructive > 0 ? 'error' : 'neutral'}>
        {counts.destructive} destructiva(s)
      </Badge>
      <Badge tone={counts.disclosing > 0 ? 'warning' : 'neutral'}>
        {counts.disclosing} divulgan datos
      </Badge>
    </span>
  )
}

function RoleCard({
  role,
  previous,
  catalog,
}: {
  role: string
  previous?: string
  catalog: CapabilityDescriptor[]
}) {
  const granted = roleCapabilityIds(catalog, role)
  const labels = (ids: readonly string[]) => sortByRisk(ids, catalog).map((row) => row.label)
  const added = previous
    ? diffCapabilities(roleCapabilityIds(catalog, previous), granted).gained
    : []
  const excluded = catalog.filter((row) => !granted.includes(row.id)).map((row) => row.id)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{role}</CardTitle>
        <CardDescription>
          Otorga {granted.length} de {catalog.length}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
        <RiskBadges ids={granted} catalog={catalog} />
        {previous && added.length > 0 && (
          <p>
            Respecto de {previous} suma: {summarizeLabels(labels(added))}.
          </p>
        )}
        {excluded.length > 0 && <p>No incluye: {summarizeLabels(labels(excluded))}.</p>}
      </CardContent>
    </Card>
  )
}

function GlobalCard({
  globalCapability,
  catalog,
}: {
  globalCapability: string
  catalog: CapabilityDescriptor[]
}) {
  const granted = globalCapabilityIds(catalog, globalCapability)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{globalCapability}</CardTitle>
        <CardDescription>
          Suma {granted.length} capacidad(es), en todo el gateway y sin importar el rol.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {summarizeLabels(
          sortByRisk(granted, catalog).map((row) => row.label),
          granted.length,
        )}
        .
      </CardContent>
    </Card>
  )
}
