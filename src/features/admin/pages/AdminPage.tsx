import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  PageHeader,
} from '@/components/ui'
import { PrivilegesPage } from '@/features/privileges'
import { CharsetCollationOptionsPage } from '@/features/charset-collation-options'
import { useRotateCrypto } from '../hooks/use-crypto-rotation'

const TABS = ['crypto', 'privileges', 'charset-collation'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

export function AdminPage() {
  // La pestaña vive en la URL (`?tab=`), igual que en `ServerDetailPage`: hace enlazable una
  // pestaña concreta y un valor desconocido cae en `crypto` en vez de dejar la página vacía.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'crypto'
  const setTab = (next: Tab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous)
      updated.set('tab', next)
      return updated
    })
  }

  const [confirmOpen, setConfirmOpen] = useState(false)
  const rotate = useRotateCrypto()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Administración"
        description="Operaciones sensibles sobre la plataforma y catálogos globales."
      />

      <div className="flex gap-1 border-b border-border" role="tablist">
        <TabButton active={tab === 'crypto'} onClick={() => setTab('crypto')}>
          Cifrado
        </TabButton>
        <TabButton active={tab === 'privileges'} onClick={() => setTab('privileges')}>
          Privilegios
        </TabButton>
        <TabButton active={tab === 'charset-collation'} onClick={() => setTab('charset-collation')}>
          Charsets y collations
        </TabButton>
      </div>

      {tab === 'crypto' && (
        <Card>
          <CardHeader>
            <CardTitle>Rotación de cifrado (DEK)</CardTitle>
            <CardDescription>
              Rota la clave de datos y re-cifra todas las credenciales almacenadas (servidores y
              usuarios), sin cambiar la SECRET_KEY ni reiniciar la aplicación.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {rotate.data && (
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">
                  {rotate.data.servers_reencrypted} servidor(es) re-cifrados
                </Badge>
                <Badge tone="success">
                  {rotate.data.server_users_reencrypted} usuario(s) re-cifrados
                </Badge>
              </div>
            )}
            <div>
              <Button onClick={() => setConfirmOpen(true)} isLoading={rotate.isPending}>
                Rotar clave de cifrado
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'privileges' && <PrivilegesPage />}
      {tab === 'charset-collation' && <CharsetCollationOptionsPage />}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() =>
          rotate.mutate(undefined, {
            onSuccess: () => setConfirmOpen(false),
          })
        }
        title="Rotar la clave de cifrado"
        description="Se re-cifrarán todas las credenciales. La operación puede tardar según el volumen de datos."
        confirmLabel="Rotar ahora"
        tone="primary"
        isLoading={rotate.isPending}
      />
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary'
          : 'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </button>
  )
}
