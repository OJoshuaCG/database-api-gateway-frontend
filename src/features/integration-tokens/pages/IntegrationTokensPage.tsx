import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Modal,
  OneTimeSecretPanel,
  PageHeader,
  PencilIcon,
  Pagination,
} from '@/components/ui'
import { ForbiddenState, isAccessForbidden, useCapabilities, useSession } from '@/features/auth'
import {
  CAPABILITIES,
  PAGINATION,
  type IntegrationTokenCreatedOut,
  type IntegrationTokenOut,
} from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils'
import { EditIntegrationTokenModal } from '../components/EditIntegrationTokenModal'
import { IntegrationTokenFormModal } from '../components/IntegrationTokenFormModal'
import { useIntegrationScopeCeiling } from '../hooks/use-integration-scope-ceiling'
import { useIntegrationTokens, useRevokeIntegrationToken } from '../hooks/use-integration-tokens'
import { tokenHasDestructiveScope } from '../integration-token-model'
import { DESTRUCTIVE_BADGE_LABEL, SUSPENDED_BADGE_LABEL } from '../messages'

export function IntegrationTokensPage() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState<number>(PAGINATION.defaultSize)
  const [formOpen, setFormOpen] = useState(false)
  const [issued, setIssued] = useState<IntegrationTokenCreatedOut | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<IntegrationTokenOut | null>(null)
  const [editTarget, setEditTarget] = useState<IntegrationTokenOut | null>(null)

  // El módulo va detrás de `access.admin` (ve los tokens de TODOS, pero solo edita los propios) o
  // de `integration_tokens.own`. Es una pista de UI (ADR-0007): el servidor decide. Sin ninguna la
  // pantalla muestra el 403 compartido y ni pide el listado, que sería un 403 seguro.
  const { can } = useCapabilities()
  const canSeeAllTokens = can(CAPABILITIES.accessAdmin)
  const canManage = canSeeAllTokens || can(CAPABILITIES.integrationTokensOwn)
  // Antes de que llegue la sesión `can()` falla abierto: se espera para no pedir un 403 seguro.
  const { admin } = useSession()
  const canRequest = admin !== null && canManage
  const { data, isLoading, isFetching, isError, error, refetch } = useIntegrationTokens(
    { page, size },
    canRequest,
  )
  const ceiling = useIntegrationScopeCeiling(canRequest)
  const revoke = useRevokeIntegrationToken()
  const forbidden = !canManage || isAccessForbidden(error)
  const apiDisabled = ceiling.data?.enabled === false

  const columns = useMemo<ColumnDef<IntegrationTokenOut>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{row.original.name}</span>
            {row.original.note && (
              <span className="text-xs text-muted-foreground">{row.original.note}</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'token_id',
        header: 'ID público',
        cell: ({ row }) => (
          // `token_id`, NO `id`: es el que aparece en el rastro de auditoría de cada llamada.
          <code className="font-mono text-xs text-muted-foreground">{row.original.token_id}</code>
        ),
      },
      {
        id: 'scopes',
        header: 'Permisos',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1.5">
            {tokenHasDestructiveScope(row.original) && (
              <div>
                <Badge tone="error">{DESTRUCTIVE_BADGE_LABEL}</Badge>
              </div>
            )}
            {/* Los EFECTIVOS que devolvió el servidor: es la columna con la que se revisan accesos. */}
            {row.original.scopes.length === 0 ? (
              <span className="text-xs italic text-muted-foreground">Ninguno</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {row.original.scopes.map((scope) => (
                  <Badge key={scope} tone="neutral">
                    {scope}
                  </Badge>
                ))}
              </div>
            )}
            {row.original.suspended_scopes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {row.original.suspended_scopes.map((scope) => (
                  <span key={scope} className="flex items-center gap-1">
                    <code className="font-mono text-xs text-muted-foreground">{scope}</code>
                    <Badge tone="warning">{SUSPENDED_BADGE_LABEL}</Badge>
                  </span>
                ))}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'estado',
        header: 'Estado',
        cell: ({ row }) => <TokenStateBadge token={row.original} />,
      },
      {
        accessorKey: 'last_used_at',
        header: 'Último uso',
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.last_used_at ? formatDateTime(row.original.last_used_at) : 'Nunca'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          if (!row.original.active) return null
          // El servidor edita solo tokens propios (404 para los ajenos): no se ofrece lo que
          // seguro falla. Revocar sí lo puede hacer quien administra accesos.
          const isOwnToken = admin !== null && row.original.created_by_admin_id === admin.id
          return (
            <div className="flex items-center justify-end gap-2">
              {isOwnToken && (
                <IconButton
                  label={`Editar ${row.original.name}`}
                  icon={<PencilIcon />}
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setEditTarget(row.original)}
                />
              )}
              <Button variant="danger-soft" size="sm" onClick={() => setRevokeTarget(row.original)}>
                Revocar
              </Button>
            </div>
          )
        },
      },
    ],
    [admin],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tokens de integración"
        description={
          canSeeAllTokens
            ? 'Credenciales portadoras para que tus proyectos web operen el gateway con permisos acotados. Siempre tienen vencimiento y una lista de servidores.'
            : 'Credenciales portadoras para que tus proyectos web operen el gateway con permisos acotados. Acá ves y administrás solo los tokens que emitiste vos.'
        }
        actions={
          forbidden ? undefined : (
            <Button onClick={() => setFormOpen(true)} disabled={apiDisabled}>
              Emitir token
            </Button>
          )
        }
      />

      {apiDisabled && !forbidden && (
        <Callout tone="warning" title="API de integración apagada">
          La API de integración está apagada en este servidor. Podés listar y revocar tokens, pero
          no emitirlos ni editarlos.
        </Callout>
      )}

      {forbidden ? (
        <ForbiddenState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            isFetching={isFetching}
            searchPlaceholder="Buscar token…"
            emptyState={
              <EmptyState
                title="No hay tokens de integración"
                description="Emití uno para que tu proyecto web pueda operar el gateway sin una sesión de usuario."
              />
            }
          />
          {data && data.pagination.pages > 1 && (
            <Pagination
              page={data.pagination.page}
              pages={data.pagination.pages}
              total={data.pagination.total}
              size={data.pagination.size}
              hasNext={data.pagination.has_next}
              hasPrev={data.pagination.has_prev}
              onPageChange={setPage}
              onSizeChange={(next) => {
                setSize(next)
                setPage(1)
              }}
              isFetching={isFetching}
            />
          )}
        </>
      )}

      {formOpen && (
        <IntegrationTokenFormModal
          open
          onClose={() => setFormOpen(false)}
          onCreated={(created) => {
            // El formulario da paso INMEDIATO a la entrega: es la única vez que el bearer existe.
            setFormOpen(false)
            setIssued(created)
          }}
        />
      )}

      {issued && (
        <Modal
          open
          // Sin «✕» ni cierre por backdrop: cerrar sin copiar deja un token emitido e inservible.
          dismissible={false}
          onClose={() => undefined}
          title={`Token «${issued.name}» emitido`}
          size="lg"
        >
          <OneTimeSecretPanel
            secretLabel="token de integración"
            secret={issued.token}
            expiresLabel={issued.expires_at ? formatDateTime(issued.expires_at) : null}
            consequence="Si cerrás esto sin copiarlo, el token queda emitido y ocupando su fila, pero es inservible: vas a tener que revocarlo y emitir otro."
            handoffHint={`Configuralo en tu proyecto como credencial portadora. Permisos efectivos: ${issued.scopes.join(', ') || 'ninguno'}.`}
            confirmLabel="Listo, volver al listado"
            onDone={() => setIssued(null)}
          />
        </Modal>
      )}

      {editTarget && (
        <EditIntegrationTokenModal open token={editTarget} onClose={() => setEditTarget(null)} />
      )}

      {revokeTarget && (
        <ConfirmDialog
          open
          onClose={() => setRevokeTarget(null)}
          onConfirm={() =>
            revoke.mutate(revokeTarget.id, { onSuccess: () => setRevokeTarget(null) })
          }
          title="Revocar token de integración"
          description={`El acceso de «${revokeTarget.name}» se corta de inmediato y no se puede deshacer. El proyecto que use este token va a empezar a fallar.`}
          // Re-tipear el nombre: es irreversible y rompe una integración que nadie mira en ese momento.
          confirmWord={revokeTarget.name}
          confirmLabel="Revocar"
          isLoading={revoke.isPending}
        />
      )}
    </div>
  )
}

/**
 * `active` lo calcula el BACKEND (`revoked_at` nulo Y `expires_at` futuro). Un token inactivo tiene
 * dos causas distintas: revocado es una decisión de alguien; vencido es el reloj.
 */
function TokenStateBadge({ token }: { token: IntegrationTokenOut }) {
  if (token.active) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="success">Activo</Badge>
        <span className="text-xs text-muted-foreground">
          {token.expires_at ? `Vence ${formatDateTime(token.expires_at)}` : 'Sin vencimiento'}
        </span>
      </div>
    )
  }
  if (token.revoked_at) {
    return <Badge tone="error">Revocado</Badge>
  }
  return <Badge tone="neutral">Vencido</Badge>
}
