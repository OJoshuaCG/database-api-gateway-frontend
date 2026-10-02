import type { z } from 'zod'
import { capabilityDescriptorSchema, type CapabilityDescriptor } from '@/lib/contracts'
/**
 * Catálogo de capacidades tal como lo publica `GET /authz/catalog` (generado en 0b43532 con
 * `capability_matrix()` y alineado con c5edee5 del backend, donde `collation.execute` pasó a ser
 * solo de `owner` y destructiva; con la llegada de `engine_users.credentials`: solo `owner`,
 * divulga, con step-up y, otorgada suelta, sensible; y con la partición de `gateway.admin` (v29)
 * en `access.admin`, solo de `access_admin`, y `policy.admin`, solo de `security_officer`), para
 * tests. **Solo fixtures**: la UI nunca lee esto, lo deriva del catálogo real. Si el backend
 * cambia un rol, este archivo se regenera desde ahí.
 */
const CATALOG_RAW: z.input<typeof capabilityDescriptorSchema>[] = [
  {
    id: 'self.read',
    module: 'self',
    level: 'read',
    label: 'Ver su propia identidad y capacidades',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'global',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'servers.read',
    module: 'servers',
    level: 'read',
    label: 'Ver el inventario de servidores',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'server',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'servers.admin',
    module: 'servers',
    level: 'admin',
    label: 'Registrar, editar y dar de baja servidores',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'global',
    roles: [],
    global_capabilities: ['security_officer'],
  },
  {
    id: 'engine_users.read',
    module: 'engine_users',
    level: 'read',
    label: 'Ver los usuarios del motor',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'server',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'engine_users.write',
    module: 'engine_users',
    level: 'write',
    label: 'Crear, editar y otorgar privilegios a usuarios del motor',
    mutates: true,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'server',
    roles: ['operator', 'owner'],
    global_capabilities: [],
  },
  {
    id: 'engine_users.drop',
    module: 'engine_users',
    level: 'drop',
    label: 'Borrar usuarios del motor',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'server',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'engine_users.secrets',
    module: 'engine_users',
    level: 'secrets',
    label: 'Revelar contraseñas de usuarios del motor',
    mutates: false,
    discloses: true,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'server',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'engine_users.credentials',
    module: 'engine_users',
    level: 'credentials',
    label: 'Elegir o definir contraseñas de usuarios del motor',
    mutates: true,
    discloses: true,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'server',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'databases.read',
    module: 'databases',
    level: 'read',
    label: 'Ver bases y su estructura',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: true,
    scope_axis: 'environment',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'databases.write',
    module: 'databases',
    level: 'write',
    label: 'Crear y editar bases gestionadas',
    mutates: true,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['operator', 'owner'],
    global_capabilities: [],
  },
  {
    id: 'databases.drop',
    module: 'databases',
    level: 'drop',
    label: 'Borrar bases de datos',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'blueprints.read',
    module: 'blueprints',
    level: 'read',
    label: 'Ver blueprints y sus versiones',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: true,
    scope_axis: 'environment',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'blueprints.write',
    module: 'blueprints',
    level: 'write',
    label: 'Crear y editar versiones de blueprint',
    mutates: true,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['operator', 'owner'],
    global_capabilities: [],
  },
  {
    id: 'blueprints.apply',
    module: 'blueprints',
    level: 'apply',
    label: 'Aplicar y revertir versiones sobre bases reales',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'blueprints.captures',
    module: 'blueprints',
    level: 'captures',
    label: 'Leer los resultados de SELECT capturados en una migración',
    mutates: false,
    discloses: true,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'schema_diff.read',
    module: 'schema_diff',
    level: 'read',
    label: 'Comparar esquemas y ver el diff',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: true,
    scope_axis: 'environment',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'schema_diff.execute',
    module: 'schema_diff',
    level: 'execute',
    label: 'Adoptar o ejecutar el DDL de una comparación',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'clones.read',
    module: 'clones',
    level: 'read',
    label: 'Ver planes de clonado',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'clones.execute',
    module: 'clones',
    level: 'execute',
    label: 'Ejecutar un clonado de estructura y datos',
    mutates: true,
    discloses: true,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'collation.read',
    module: 'collation',
    level: 'read',
    label: 'Ver planes de conversión de collation',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'collation.execute',
    module: 'collation',
    level: 'execute',
    label: 'Ejecutar una conversión de collation',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'exports.read',
    module: 'exports',
    level: 'read',
    label: 'Ver planes de exportación y su estado',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'exports.execute',
    module: 'exports',
    level: 'execute',
    label: 'Generar el artefacto de una exportación',
    mutates: true,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['operator', 'owner'],
    global_capabilities: [],
  },
  {
    id: 'exports.download',
    module: 'exports',
    level: 'download',
    label: 'Descargar los datos exportados en claro',
    mutates: false,
    discloses: true,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'sql_console.history',
    module: 'sql_console',
    level: 'history',
    label: 'Ver el historial de la consola SQL',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'sql_console.execute',
    module: 'sql_console',
    level: 'execute',
    label: 'Ejecutar SQL ad-hoc contra un motor',
    mutates: true,
    discloses: true,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'environment',
    roles: ['owner'],
    global_capabilities: [],
  },
  {
    id: 'catalogs.read',
    module: 'catalogs',
    level: 'read',
    label: 'Ver los catálogos de privilegios y charsets',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'global',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'catalogs.write',
    module: 'catalogs',
    level: 'write',
    label: 'Editar los catálogos de privilegios, perfiles y charsets',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'global',
    roles: [],
    global_capabilities: ['security_officer'],
  },
  {
    id: 'environments.read',
    module: 'environments',
    level: 'read',
    label: 'Ver los entornos y su política',
    mutates: false,
    discloses: false,
    requires_step_up: false,
    agent_allowed: false,
    scope_axis: 'global',
    roles: ['operator', 'owner', 'viewer'],
    global_capabilities: [],
  },
  {
    id: 'environments.write',
    module: 'environments',
    level: 'write',
    label: 'Crear, editar y borrar entornos, abrir BDs a agentes y reclasificarlas',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'global',
    roles: [],
    global_capabilities: ['security_officer'],
  },
  {
    id: 'access.admin',
    module: 'access',
    level: 'admin',
    label: 'Administrar usuarios del gateway, accesos, capacidades puntuales y tokens',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'global',
    roles: [],
    global_capabilities: ['access_admin'],
  },
  {
    id: 'policy.admin',
    module: 'policy',
    level: 'admin',
    label: 'Administrar la política del gateway: rotación del cifrado',
    mutates: true,
    discloses: false,
    requires_step_up: true,
    agent_allowed: false,
    scope_axis: 'global',
    roles: [],
    global_capabilities: ['security_officer'],
  },
]

/**
 * El catálogo ya parseado por el contrato, como lo ve la app. Las filas no traen `grantable`,
 * `sensitive`, `implies` ni `destructive` (este fixture es el de un backend anterior a las
 * capacidades puntuales), así que salen con los defaults seguros: nada otorgable, nada sensible,
 * nada implícito, y `destructive: null` (sin la marca, `isDestructive` cae a la lista del frontend).
 */
export const CATALOG_FIXTURE: CapabilityDescriptor[] = CATALOG_RAW.map((row) =>
  capabilityDescriptorSchema.parse(row),
)

/**
 * Las siete que `capability_catalog.py` marca `destructive=True` (desde c5edee5 incluye
 * `collation.execute`). No sale de una regla sobre los otros campos, así que se copia tal cual
 * del backend.
 */
export const DESTRUCTIVE_CAPABILITY_IDS: readonly string[] = [
  'databases.drop',
  'engine_users.drop',
  'blueprints.apply',
  'schema_diff.execute',
  'clones.execute',
  'collation.execute',
  'sql_console.execute',
]

/**
 * El mismo catálogo en la forma del backend con capacidades puntuales: `grantable`, `sensitive` e
 * `implies` calculados con las reglas de `capability_catalog.py` (`is_grantable`: todo menos el eje
 * global; `is_sensitive`: desde C3, otorgable y exclusiva de `owner` —la tiene `owner` y no
 * `operator`—, que da las 11 de `_SENSITIVE_POLICY`; `IMPLIED_READ`: la lectura de nivel viewer
 * del mismo módulo para lo otorgable que muta o divulga), y `destructive` según
 * `DESTRUCTIVE_CAPABILITY_IDS`. Los espejos de `authz-model` se prueban contra esto, no contra el
 * fixture viejo, donde nada es otorgable y la marca destructiva no viene.
 */
export const GRANTS_CATALOG_FIXTURE: CapabilityDescriptor[] = (() => {
  const viewerReads = new Map<string, string>()
  for (const row of CATALOG_FIXTURE) {
    if (
      row.roles.includes('viewer') &&
      row.scope_axis !== 'global' &&
      !row.mutates &&
      !row.discloses
    ) {
      viewerReads.set(row.module, row.id)
    }
  }
  return CATALOG_FIXTURE.map((row) => {
    const grantable = row.scope_axis !== 'global'
    const read = viewerReads.get(row.module)
    return {
      ...row,
      grantable,
      sensitive: grantable && row.roles.includes('owner') && !row.roles.includes('operator'),
      implies: grantable && (row.mutates || row.discloses) && read ? [read] : [],
      destructive: DESTRUCTIVE_CAPABILITY_IDS.includes(row.id),
    }
  })
})()

/** Capacidades de un rol según el fixture: lo que el backend mandaría en `/auth/me`. */
export function fixtureRoleCapabilities(role: string): string[] {
  return CATALOG_FIXTURE.filter((row) => row.roles.includes(role)).map((row) => row.id)
}

/** Cuerpo de `/auth/me` coherente con el fixture. `catalog_version` presente = backend nuevo. */
export function meFixture(
  overrides: {
    id?: number
    username?: string
    role?: string
    base_role?: string
    capabilities?: string[]
    global_capabilities?: string[]
    scope_roles?: { scope_type: string; scope_id: number; role: string }[]
  } = {},
) {
  const role = overrides.role ?? 'owner'
  const globals = overrides.global_capabilities ?? []
  const fromGlobals = CATALOG_FIXTURE.filter((row) =>
    row.global_capabilities.some((global) => globals.includes(global)),
  ).map((row) => row.id)
  return {
    id: overrides.id ?? 1,
    username: overrides.username ?? 'admin',
    role,
    base_role: overrides.base_role ?? role,
    capabilities: overrides.capabilities ?? [
      ...new Set([...fixtureRoleCapabilities(role), ...fromGlobals]),
    ],
    global_capabilities: globals,
    scope_roles: overrides.scope_roles ?? [],
    step_up_capabilities: [],
    catalog_version: 'test-v1',
  }
}

const PAGE = { page: 1, size: 100, pages: 1, has_next: false, has_prev: false }

/** Envelope paginado de una lista corta, para los listados que los formularios usan de opciones. */
export function pageOf<T>(items: T[]) {
  return { data: items, pagination: { ...PAGE, total: items.length } }
}

/** Un entorno de `GET /environments`. */
export function environmentFixture(id: number, name: string, rank: number) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    rank,
    color: null,
    is_default: rank === 0,
    is_active: true,
    blocks_destructive_migrations: false,
    allows_agent_access: false,
    database_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** Un servidor de `GET /servers`. */
export function serverFixture(id: number, name: string) {
  return {
    id,
    name,
    host: `${name}.local`,
    port: 3306,
    engine: 'mysql',
    root_username: 'root',
    status: 'active',
    is_active: true,
    notes: null,
    has_root_password: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}
