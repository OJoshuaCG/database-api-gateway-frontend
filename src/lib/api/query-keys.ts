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
    reconcile: (id: number) => ['servers', id, 'reconcile'] as const,
    snapshot: (id: number, database: string, includeDataStats = false) =>
      ['servers', id, 'databases', database, 'snapshot', { includeDataStats }] as const,
  },
  serverUsers: {
    all: ['server-users'] as const,
    list: (params: QueryParams) => ['server-users', 'list', params] as const,
    detail: (id: number) => ['server-users', 'detail', id] as const,
    databases: (id: number) => ['server-users', id, 'databases'] as const,
    grants: (id: number, database?: string | null) =>
      ['server-users', id, 'grants', database ?? null] as const,
  },
  databaseModels: {
    all: ['database-models'] as const,
    list: (params: QueryParams) => ['database-models', 'list', params] as const,
    detail: (id: number) => ['database-models', 'detail', id] as const,
    databases: (id: number) => ['database-models', id, 'databases'] as const,
    migrations: (modelId: number) => ['database-models', modelId, 'migrations'] as const,
    migrationList: (modelId: number, params: QueryParams) =>
      ['database-models', modelId, 'migrations', 'list', params] as const,
    migrationDetail: (modelId: number, version: string) =>
      ['database-models', modelId, 'migrations', 'detail', version] as const,
  },
  managedDatabases: {
    all: ['managed-databases'] as const,
    list: (params: QueryParams) => ['managed-databases', 'list', params] as const,
    detail: (id: number) => ['managed-databases', 'detail', id] as const,
    migrationStatus: (id: number) => ['managed-databases', id, 'migrations', 'status'] as const,
    migrationHistory: (id: number, params: QueryParams) =>
      ['managed-databases', id, 'migrations', 'history', params] as const,
  },
  privileges: {
    all: ['privileges'] as const,
    list: (params: QueryParams) => ['privileges', 'list', params] as const,
  },
  permissionProfiles: {
    all: ['permission-profiles'] as const,
    list: (params: QueryParams) => ['permission-profiles', 'list', params] as const,
    detail: (id: number) => ['permission-profiles', 'detail', id] as const,
  },
  schemaComparisons: {
    all: ['schema-comparisons'] as const,
    detail: (id: number) => ['schema-comparisons', 'detail', id] as const,
    items: (id: number, params: QueryParams) => ['schema-comparisons', id, 'items', params] as const,
    itemsAll: (id: number, filters: QueryParams) =>
      ['schema-comparisons', id, 'items', 'all', filters] as const,
    preview: (id: number, mode: string, selectedItemIds: number[]) =>
      ['schema-comparisons', id, 'execute-preview', mode, selectedItemIds] as const,
  },
} as const
