import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Modal } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { EngineType } from '@/lib/contracts'
import { engineLabel, type ServerDatabaseRow } from '../logic'
import { DatabaseGranteesPanel } from './DatabaseGranteesPanel'

type Tab = 'grantees' | 'summary'

const TABS: { id: Tab; label: string }[] = [
  { id: 'grantees', label: 'Usuarios con permisos' },
  { id: 'summary', label: 'Resumen' },
]

interface ServerDatabaseDetailModalProps {
  open: boolean
  onClose: () => void
  serverId: number
  engine: EngineType
  /** Fila del listado: nombre físico + su cruce con el inventario. */
  row: ServerDatabaseRow
  /** Abre el flujo de borrado (lo orquesta el padre). */
  onRequestDelete: () => void
}

/**
 * Ficha de una base de datos física del servidor. Todo lo que muestra ya está en `row` salvo los
 * grantees, que se consultan al motor desde la pestaña correspondiente.
 */
export function ServerDatabaseDetailModal({
  open,
  onClose,
  serverId,
  engine,
  row,
  onRequestDelete,
}: ServerDatabaseDetailModalProps) {
  const [tab, setTab] = useState<Tab>('grantees')
  const managed = row.managed

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row.name}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="danger" onClick={onRequestDelete}>
            Eliminar base de datos 🔌
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Motor: {engineLabel(engine)}</span>
          <span aria-hidden>·</span>
          {row.isManaged ? (
            <>
              <Badge tone="success">Gestionada</Badge>
              <Link
                to="/managed-databases"
                className="text-xs font-medium text-primary hover:underline"
              >
                ver registro →
              </Link>
            </>
          ) : (
            <Badge tone="warning">No gestionada</Badge>
          )}
        </div>

        <div className="flex gap-1 border-b border-border" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={
                tab === item.id
                  ? '-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary'
                  : '-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'grantees' && <DatabaseGranteesPanel serverId={serverId} database={row.name} />}

        {tab === 'summary' && (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label="Nombre">
              <span className="font-mono text-xs">{row.name}</span>
            </Fact>
            <Fact label="Motor">{engineLabel(engine)}</Fact>
            <Fact label="Inventario">
              {row.isManaged ? 'Registrada en el gateway' : 'No registrada'}
            </Fact>
            {managed ? (
              <>
                <Fact label="Id del registro">#{managed.id}</Fact>
                <Fact label="Estado">{managed.status}</Fact>
                <Fact label="Origen">{managed.origin ?? '—'}</Fact>
                <Fact label="Charset">{managed.charset ?? '—'}</Fact>
                <Fact label="Collation">{managed.collation ?? '—'}</Fact>
                <Fact label="Creado">{formatDateTime(managed.created_at)}</Fact>
                <Fact label="Actualizado">{formatDateTime(managed.updated_at)}</Fact>
                <div className="sm:col-span-2">
                  <Fact label="Notas">{managed.notes ?? '—'}</Fact>
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">
                  Esta base no está registrada en el inventario del gateway.
                </p>
              </div>
            )}
          </dl>
        )}
      </div>
    </Modal>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}
