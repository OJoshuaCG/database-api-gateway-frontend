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
const ServerUserDetailPage = lazyPage(() => import('@/features/servers'), 'ServerUserDetailPage')
const ServerUsersPage = lazyPage(() => import('@/features/server-users'), 'ServerUsersPage')
const ServerUserGrantsPage = lazyPage(
  () => import('@/features/server-users'),
  'ServerUserGrantsPage',
)
const DatabaseModelsPage = lazyPage(
  () => import('@/features/database-models'),
  'DatabaseModelsPage',
)
const SnapshotWizardPage = lazyPage(
  () => import('@/features/database-models'),
  'SnapshotWizardPage',
)
const BlueprintMigrationsPage = lazyPage(
  () => import('@/features/database-models'),
  'BlueprintMigrationsPage',
)
const NewModelMigrationPage = lazyPage(
  () => import('@/features/database-models'),
  'NewModelMigrationPage',
)
const ManagedDatabasesPage = lazyPage(
  () => import('@/features/managed-databases'),
  'ManagedDatabasesPage',
)
const ManagedDatabaseMigrationsPage = lazyPage(
  () => import('@/features/managed-databases'),
  'ManagedDatabaseMigrationsPage',
)
const SelectResultsPage = lazyPage(() => import('@/features/managed-databases'), 'SelectResultsPage')
const SchemaComparisonWizardPage = lazyPage(
  () => import('@/features/schema-comparisons'),
  'SchemaComparisonWizardPage',
)
const DatabaseCloneWizardPage = lazyPage(
  () => import('@/features/database-clones'),
  'DatabaseCloneWizardPage',
)
const CollationConversionWizardPage = lazyPage(
  () => import('@/features/collation-conversions'),
  'CollationConversionWizardPage',
)
const SqlConsolePage = lazyPage(() => import('@/features/sql-console'), 'SqlConsolePage')
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
          // `:host?` ausente = identidad sin host (rol de PostgreSQL, que no tiene). Username y
          // host viajan codificados, igual criterio que `:database` arriba.
          {
            path: 'servers/:serverId/users/:username/:host?',
            element: <ServerUserDetailPage />,
          },
          { path: 'server-users', element: <ServerUsersPage /> },
          { path: 'server-users/:userId/grants', element: <ServerUserGrantsPage /> },
          { path: 'database-models', element: <DatabaseModelsPage /> },
          { path: 'database-models/from-snapshot', element: <SnapshotWizardPage /> },
          { path: 'database-models/:modelId/migrations', element: <BlueprintMigrationsPage /> },
          {
            path: 'database-models/:modelId/migrations/new',
            element: <NewModelMigrationPage />,
          },
          { path: 'managed-databases', element: <ManagedDatabasesPage /> },
          {
            path: 'managed-databases/:databaseId/migrations',
            element: <ManagedDatabaseMigrationsPage />,
          },
          {
            path: 'managed-databases/:databaseId/migrations/:version/select-results',
            element: <SelectResultsPage />,
          },
          { path: 'schema-comparisons', element: <SchemaComparisonWizardPage /> },
          { path: 'database-clones', element: <DatabaseCloneWizardPage /> },
          // Identidad física (servidor+BD) por query string (`?serverId=&database=`), reentrada
          // por `?jobId=` — igual mecanismo que `database-clones`. Se llega solo desde la ficha
          // de la base de datos, sin entrada de sidebar propia.
          { path: 'collation-conversions', element: <CollationConversionWizardPage /> },
          // El servidor y la pestaña viajan como query params (`?server=2&tab=history`) para
          // poder enlazar la consola desde el detalle de un servidor.
          { path: 'sql-console', element: <SqlConsolePage /> },
          // Privilegios y Charsets/collations pasaron a ser pestañas de Administración: las
          // rutas propias quedan como redirect para no romper enlaces existentes.
          { path: 'privileges', element: <Navigate to="/admin?tab=privileges" replace /> },
          { path: 'permission-profiles', element: <PermissionProfilesPage /> },
          {
            path: 'charset-collation-options',
            element: <Navigate to="/admin?tab=charset-collation" replace />,
          },
          { path: 'admin', element: <AdminPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
