import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Modal,
  OneTimeSecretPanel,
  PageHeader,
  Pagination,
} from '@/components/ui'
import { PAGINATION, type ApiTokenOut, type ApiTokenCreatedOut } from '@/lib/contracts'
import { formatDateTime } from '@/lib/utils'
import { ApiTokenFormModal } from '../components/ApiTokenFormModal'
import { useApiTokens, useRevokeApiToken } from '../hooks/use-api-tokens'

export function ApiTokensPage() {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState<number>(PAGINATION.defaultSize)
  const [formOpen, setFormOpen] = useState(false)
  const [issued, setIssued] = useState<ApiTokenCreatedOut | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenOut | null>(null)

  const { data, isLoading, isFetching, isError, error, refetch } = useApiTokens({ page, size })
  const revoke = useRevokeApiToken()

  const columns = useMemo<ColumnDef<ApiTokenOut>[]>(
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
          // `token_id`, NO `id`: es lo que aparece en el rastro de auditoría, y sirve para cruzar
          // una fila `mcp.*` con el token que la originó.
          <code
            className="font-mono text-xs text-muted-foreground"
            title="Aparece en el registro de auditoría de cada llamada del agente."
          >
            {row.original.token_id}
          </code>
        ),
      },
      {
        id: 'scopes',
        header: 'Permisos',
        cell: ({ row }) =>
          // Los EFECTIVOS que devolvió el servidor, nunca los que pidió el operador: el servidor
          // intersecta con el techo de agente, así que mostrar el pedido convertiría esta columna
          // —que existe para revisar accesos— en una afirmación falsa.
          row.original.scopes.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">Ninguno</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.scopes.map((scope) => (
                <Badge key={scope} tone="neutral">
                  {scope}
                </Badge>
              ))}
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
        cell: ({ row }) =>
          row.original.active ? (
            <div className="flex justify-end">
              {/* Acción de dominio e irreversible: conserva el texto, no se reduce a un icono. */}
              <Button variant="danger-soft" size="sm" onClick={() => setRevokeTarget(row.original)}>
                Revocar
              </Button>
            </div>
          ) : null,
      },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tokens de agente"
        description="Credenciales portadoras para procesos automáticos. Cada token vive dentro de un proyecto y siempre tiene vencimiento."
        actions={<Button onClick={() => setFormOpen(true)}>Emitir token</Button>}
      />

      {isError ? (
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
                title="No hay tokens de agente"
                description="Emití uno para que un pipeline o un agente pueda consultar el gateway sin una sesión de usuario."
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
        <ApiTokenFormModal
          open
          onClose={() => setFormOpen(false)}
          onCreated={(created) => {
            // Igual que con la invitación: el formulario da paso INMEDIATO a la entrega. Es la
            // única vez que el bearer existe.
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
            secretLabel="token de agente"
            secret={issued.token}
            expiresLabel={issued.expires_at ? formatDateTime(issued.expires_at) : null}
            consequence="Si cerrás esto sin copiarlo, el token queda emitido y ocupando su fila, pero es inservible: vas a tener que revocarlo y emitir otro."
            handoffHint={`Configuralo en el destino como credencial portadora. Permisos efectivos: ${issued.scopes.join(', ') || 'ninguno'}.`}
            confirmLabel="Listo, volver al listado"
            onDone={() => setIssued(null)}
          />
        </Modal>
      )}

      {revokeTarget && (
        <ConfirmDialog
          open
          onClose={() => setRevokeTarget(null)}
          onConfirm={() =>
            revoke.mutate(revokeTarget.id, { onSuccess: () => setRevokeTarget(null) })
          }
          title="Revocar token de agente"
          description={`El acceso de «${revokeTarget.name}» se corta de inmediato y no se puede deshacer. Lo que use este token va a empezar a fallar.`}
          // Re-tipear el nombre: es irreversible y rompe un proceso automático que nadie está
          // mirando en ese momento. Mismo criterio que las confirmaciones sobre el motor.
          confirmWord={revokeTarget.name}
          confirmLabel="Revocar"
          isLoading={revoke.isPending}
        />
      )}
    </div>
  )
}

/**
 * `active` lo calcula el BACKEND (`revoked_at` nulo Y `expires_at` futuro), así que no se
 * recalcula acá. Pero un token inactivo tiene dos causas distintas y el operador necesita
 * distinguirlas: revocado es una decisión de alguien; vencido es el reloj.
 */
function TokenStateBadge({ token }: { token: ApiTokenOut }) {
  if (token.active) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="success">Activo</Badge>
        {token.expires_at && (
          <span className="text-xs text-muted-foreground">
            Vence {formatDateTime(token.expires_at)}
          </span>
        )}
      </div>
    )
  }
  if (token.revoked_at) {
    return <Badge tone="error">Revocado</Badge>
  }
  return <Badge tone="neutral">Vencido</Badge>
}
