import type { QueryParams } from './client'

/**
 * Fábrica centralizada de query keys. Estructura jerárquica para invalidaciones
 * dirigidas (p. ej. `queryKeys.servers.all` invalida lista + detalles + introspección).
 */
export const queryKeys = {
  auth: {
    me: () => ['auth', 'me'] as const,
  },
  health: {
    liveness: () => ['health', 'liveness'] as const,
    readiness: () => ['health', 'readiness'] as const,
  },
  servers: {
    all: ['servers'] as const,
    list: (params: QueryParams) => ['servers', 'list', params] as const,
    detail: (id: number) => ['servers', 'detail', id] as const,
    databases: (id: number) => ['servers', id, 'databases'] as const,
    engineUsers: (id: number) => ['servers', id, 'engine-users'] as const,
    tables: (id: number, database: string) =>
      ['servers', id, 'databases', database, 'tables'] as const,
    tableSchema: (id: number, database: string, table: string) =>
      ['servers', id, 'databases', database, 'tables', table, 'schema'] as const,
  },
  serverUsers: {
    all: ['server-users'] as const,
    list: (params: QueryParams) => ['server-users', 'list', params] as const,
    detail: (id: number) => ['server-users', 'detail', id] as const,
    databases: (id: number) => ['server-users', id, 'databases'] as const,
  },
  databaseModels: {
    all: ['database-models'] as const,
    list: (params: QueryParams) => ['database-models', 'list', params] as const,
    detail: (id: number) => ['database-models', 'detail', id] as const,
    databases: (id: number) => ['database-models', id, 'databases'] as const,
  },
  managedDatabases: {
    all: ['managed-databases'] as const,
    list: (params: QueryParams) => ['managed-databases', 'list', params] as const,
    detail: (id: number) => ['managed-databases', 'detail', id] as const,
  },
  privileges: {
    all: ['privileges'] as const,
    list: (params: QueryParams) => ['privileges', 'list', params] as const,
  },
} as const
