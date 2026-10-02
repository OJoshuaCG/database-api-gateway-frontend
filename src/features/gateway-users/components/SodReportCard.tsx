import { useId, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Callout,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  StatusLegend,
} from '@/components/ui'
import {
  ForbiddenState,
  SOD_RULE_EXPLANATION,
  formatSodInstant,
  isAccessForbidden,
  sodRuleLabel,
  useSodReport,
} from '@/features/auth'
import type { SodException, SodUncovered } from '@/lib/contracts'
import { gatewayUserAccessPath } from '@/lib/routes'

/** La persona, con enlace a sus accesos (ahí se separan las funciones) y su estado. */
function UserCell({
  id,
  username,
  active,
}: {
  id: number
  username: string
  active?: boolean | null
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Link
        to={gatewayUserAccessPath(id)}
        className="font-mono font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {username || `#${id}`}
      </Link>
      {active === false && <Badge tone="neutral">Desactivada</Badge>}
    </div>
  )
}

/**
 * «Separación de funciones» — `GET /authz/sod-report` (v29 §8.6), pestaña `?tab=sod` de
 * `GatewayUsersPage`. Solo para `access.admin`: quien la monta lo decide.
 *
 * Dos listas, en orden de urgencia:
 * 1. **Sin excepción**: cuentas que violan una regla y ninguna excepción cubre. El servidor ya les
 *    descartó `security_officer` al leer: alguien perdió funciones, quizás sin saberlo.
 * 2. **Excepciones vigentes**: heredadas (sin vencimiento) y de emergencia (vencen en 7 días como
 *    mucho). `still_violating` se resalta: la cuenta sigue combinando las funciones, que es
 *    exactamente lo que hay que resolver. Una que ya no viola la regla sobra y se cierra sola.
 */
export function SodReportCard() {
  const ids = useId()
  const headingId = `${ids}-titulo`
  const report = useSodReport()

  const uncoveredColumns = useMemo<ColumnDef<SodUncovered>[]>(
    () => [
      {
        id: 'user',
        header: 'Persona',
        cell: ({ row }) => (
          <UserCell
            id={row.original.user.id}
            username={row.original.user.username}
            active={row.original.user_active}
          />
        ),
      },
      {
        id: 'rules',
        header: 'Combina',
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.rules.map((rule) => (
              <Badge key={rule} tone="error">
                {sodRuleLabel(rule)}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        id: 'effect',
        header: 'Efecto',
        cell: () => (
          <span className="text-sm text-muted-foreground">
            Funciones de oficial de seguridad desactivadas.
          </span>
        ),
      },
    ],
    [],
  )

  const exceptionColumns = useMemo<ColumnDef<SodException>[]>(
    () => [
      {
        id: 'user',
        header: 'Persona',
        cell: ({ row }) => (
          <UserCell
            id={row.original.user.id}
            username={row.original.user.username}
            active={row.original.user_active}
          />
        ),
      },
      {
        id: 'rule',
        header: 'Regla',
        cell: ({ row }) => (
          <span className="text-sm text-foreground">{sodRuleLabel(row.original.rule)}</span>
        ),
      },
      {
        id: 'kind',
        header: 'Excepción',
        cell: ({ row }) => {
          const exception = row.original
          const heredada = exception.kind === 'grandfathered'
          return (
            <div className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
              <Badge tone={heredada ? 'neutral' : 'warning'}>
                {heredada
                  ? 'Heredada'
                  : exception.kind === 'override'
                    ? 'Emergencia'
                    : exception.kind}
              </Badge>
              {exception.since && <span>Desde {formatSodInstant(exception.since)}</span>}
              <span>
                {exception.expires_at
                  ? `Vence ${formatSodInstant(exception.expires_at)}`
                  : 'Sin vencimiento'}
              </span>
            </div>
          )
        },
      },
      {
        id: 'reason',
        header: 'Motivo',
        cell: ({ row }) => {
          const exception = row.original
          return (
            <div className="flex flex-col gap-1">
              {/* La heredada trae el motivo literal `grandfathered`: se dice qué significa. */}
              <span className="text-sm text-foreground">
                {exception.kind === 'grandfathered' && exception.reason === 'grandfathered'
                  ? 'Combinación anterior a la regla.'
                  : exception.reason}
              </span>
              {exception.requested_by && (
                <span className="text-xs text-muted-foreground">
                  Declaró {exception.requested_by.username}
                  {exception.approved_by ? ` · aprobó ${exception.approved_by.username}` : ''}
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'status',
        header: 'Estado',
        cell: ({ row }) =>
          row.original.still_violating ? (
            <Badge tone="error">Sigue combinando</Badge>
          ) : (
            <Badge tone="success">Ya separada</Badge>
          ),
      },
    ],
    [],
  )

  const exceptions = report.data?.exceptions ?? []
  const uncovered = report.data?.uncovered ?? []
  const stillViolating = exceptions.filter((exception) => exception.still_violating).length

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            Separación de funciones
          </h2>
          <p className="text-sm text-muted-foreground">{SOD_RULE_EXPLANATION}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {isAccessForbidden(report.error) ? (
            <ForbiddenState title="No tenés acceso al reporte de separación de funciones" />
          ) : report.isError ? (
            <ErrorState error={report.error} onRetry={() => void report.refetch()} />
          ) : (
            <>
              {uncovered.length > 0 && (
                <Callout
                  tone="danger"
                  title={
                    uncovered.length === 1
                      ? '1 cuenta combina funciones sin excepción'
                      : `${uncovered.length} cuentas combinan funciones sin excepción`
                  }
                >
                  El servidor ya les desactivó lo que da oficial de seguridad (servidores,
                  catálogos, entornos y cifrado). Separá las funciones desde sus accesos.
                </Callout>
              )}

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Cuentas sin excepción</h3>
                <DataTable<SodUncovered>
                  data={uncovered}
                  columns={uncoveredColumns}
                  isLoading={report.isLoading}
                  isFetching={report.isFetching}
                  enableGlobalFilter={false}
                  getRowId={(row) => String(row.user.id)}
                  emptyState={
                    <EmptyState
                      title="Ninguna cuenta combina funciones sin excepción"
                      description="Toda combinación que existe está cubierta por una excepción vigente, o no hay ninguna."
                    />
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Excepciones vigentes
                  {stillViolating > 0 && (
                    <span className="ml-2 inline-flex">
                      <Badge tone="error">{stillViolating} por resolver</Badge>
                    </span>
                  )}
                </h3>
                <DataTable<SodException>
                  data={exceptions}
                  columns={exceptionColumns}
                  isLoading={report.isLoading}
                  isFetching={report.isFetching}
                  enableGlobalFilter={false}
                  getRowId={(row) => String(row.id)}
                  emptyState={
                    <EmptyState
                      title="No hay excepciones vigentes"
                      description="Ninguna cuenta tiene una combinación heredada ni una excepción de emergencia."
                    />
                  }
                />
                <StatusLegend
                  title="Qué significa cada excepción"
                  items={[
                    ...(exceptions.some((exception) => exception.kind === 'grandfathered')
                      ? [
                          {
                            key: 'grandfathered',
                            label: 'Heredada',
                            tone: 'neutral' as const,
                            description:
                              'La combinación existía antes de la regla. No vence: sigue hasta que alguien separe las funciones.',
                          },
                        ]
                      : []),
                    ...(exceptions.some((exception) => exception.kind === 'override')
                      ? [
                          {
                            key: 'override',
                            label: 'Emergencia',
                            tone: 'warning' as const,
                            description:
                              'Declarada a mano con motivo, auditada. Al vencer, el servidor desactiva las funciones de oficial de seguridad de la cuenta.',
                          },
                        ]
                      : []),
                    ...(stillViolating > 0
                      ? [
                          {
                            key: 'still',
                            label: 'Sigue combinando',
                            tone: 'error' as const,
                            description:
                              'La cuenta todavía tiene las dos funciones: es lo que hay que resolver.',
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </>
          )}
        </CardContent>
      </section>
    </Card>
  )
}
