import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { NotFoundPage } from '@/components/NotFoundPage'
import { LoginPage, ProtectedRoute } from '@/features/auth'

/**
 * Las vistas se cargan por ruta (`React.lazy` + el `Suspense` del `AppShell`). Sin esto, la app
 * entera —incluidos los cuatro asistentes pesados (comparar esquemas, clonar, snapshot,
 * migraciones), que la mayoría de las sesiones no abre— viajaba en un único bundle.
 *
 * Se importa **el barrel** de cada feature, no sus módulos internos: el barrel es la API pública
 * de la feature (ver `docs/architecture.md`). Lo que dos features comparten (p. ej.
 * `PrivilegeMultiSelect`) lo hoistea el bundler a un chunk común, no se duplica.
 *
 * `auth` y el shell quedan **eager** a propósito: son el primer render (login/guarda de sesión),
 * así que diferirlos solo añadiría un salto de red antes de poder pintar nada.
 */
const lazyPage = <M, K extends keyof M>(load: () => Promise<M>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] as React.ComponentType })))

const ServersPage = lazyPage(() => import('@/features/servers'), 'ServersPage')
const ServerDetailPage = lazyPage(() => import('@/features/servers'), 'ServerDetailPage')
const ServerDatabaseDetailPage = lazyPage(
  () => import('@/features/server-databases'),
  'ServerDatabaseDetailPage',
)
const ServerUsersPage = lazyPage(() => import('@/features/server-users'), 'ServerUsersPage')
const ServerUserGrantsPage = lazyPage(
  () => import('@/features/server-users'),
  'ServerUserGrantsPage',
)
const DatabaseModelsPage = lazyPage(() => import('@/features/database-models'), 'DatabaseModelsPage')
const SnapshotWizardPage = lazyPage(() => import('@/features/database-models'), 'SnapshotWizardPage')
const BlueprintMigrationsPage = lazyPage(
  () => import('@/features/database-models'),
  'BlueprintMigrationsPage',
)
const ManagedDatabasesPage = lazyPage(
  () => import('@/features/managed-databases'),
  'ManagedDatabasesPage',
)
const ManagedDatabaseMigrationsPage = lazyPage(
  () => import('@/features/managed-databases'),
  'ManagedDatabaseMigrationsPage',
)
const SchemaComparisonWizardPage = lazyPage(
  () => import('@/features/schema-comparisons'),
  'SchemaComparisonWizardPage',
)
const DatabaseCloneWizardPage = lazyPage(
  () => import('@/features/database-clones'),
  'DatabaseCloneWizardPage',
)
const PrivilegesPage = lazyPage(() => import('@/features/privileges'), 'PrivilegesPage')
const PermissionProfilesPage = lazyPage(
  () => import('@/features/permission-profiles'),
  'PermissionProfilesPage',
)
const AdminPage = lazyPage(() => import('@/features/admin'), 'AdminPage')

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/servers" replace /> },
          { path: 'servers', element: <ServersPage /> },
          { path: 'servers/:serverId', element: <ServerDetailPage /> },
          // El nombre de la BD viaja codificado: puede llevar `.`, `-` o `$` (nombres legados).
          { path: 'servers/:serverId/databases/:database', element: <ServerDatabaseDetailPage /> },
          { path: 'server-users', element: <ServerUsersPage /> },
          { path: 'server-users/:userId/grants', element: <ServerUserGrantsPage /> },
          { path: 'database-models', element: <DatabaseModelsPage /> },
          { path: 'database-models/from-snapshot', element: <SnapshotWizardPage /> },
          { path: 'database-models/:modelId/migrations', element: <BlueprintMigrationsPage /> },
          { path: 'managed-databases', element: <ManagedDatabasesPage /> },
          {
            path: 'managed-databases/:databaseId/migrations',
            element: <ManagedDatabaseMigrationsPage />,
          },
          { path: 'schema-comparisons', element: <SchemaComparisonWizardPage /> },
          { path: 'database-clones', element: <DatabaseCloneWizardPage /> },
          { path: 'privileges', element: <PrivilegesPage /> },
          { path: 'permission-profiles', element: <PermissionProfilesPage /> },
          { path: 'admin', element: <AdminPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
