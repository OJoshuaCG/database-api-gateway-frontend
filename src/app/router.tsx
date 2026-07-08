import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { NotFoundPage } from '@/components/NotFoundPage'
import { LoginPage, ProtectedRoute } from '@/features/auth'
import { ServerDetailPage, ServersPage } from '@/features/servers'
import { ServerUsersPage } from '@/features/server-users'
import {
  BlueprintMigrationsPage,
  DatabaseModelsPage,
  SnapshotWizardPage,
} from '@/features/database-models'
import { ManagedDatabasesPage } from '@/features/managed-databases'
import { PrivilegesPage } from '@/features/privileges'
import { PermissionProfilesPage } from '@/features/permission-profiles'
import { AdminPage } from '@/features/admin'

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
          { path: 'server-users', element: <ServerUsersPage /> },
          { path: 'database-models', element: <DatabaseModelsPage /> },
          { path: 'database-models/from-snapshot', element: <SnapshotWizardPage /> },
          { path: 'database-models/:modelId/migrations', element: <BlueprintMigrationsPage /> },
          { path: 'managed-databases', element: <ManagedDatabasesPage /> },
          { path: 'privileges', element: <PrivilegesPage /> },
          { path: 'permission-profiles', element: <PermissionProfilesPage /> },
          { path: 'admin', element: <AdminPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
