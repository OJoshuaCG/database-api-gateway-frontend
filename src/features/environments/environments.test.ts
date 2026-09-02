import { describe, expect, it } from 'vitest'
import {
  applyAllItemSchema,
  applyAllResultSchema,
  environmentOutSchema,
  managedDatabaseUpdateSchema,
} from '@/lib/contracts'
import {
  toManagedDatabaseCreate,
  toManagedDatabaseUpdate,
  type ManagedDatabaseFormValues,
} from '@/features/managed-databases/components/ManagedDatabaseForm'
import { classifyItem, databaseLabel, describeItemRejection, environmentMessage } from './messages'
import { resolveEnvironmentState } from './logic'

const ENV_BASE = {
  id: 4,
  name: 'Producción',
  slug: 'production',
  rank: 30,
  color: 'error',
  is_default: false,
  is_active: true,
  blocks_destructive_migrations: true,
  database_count: 12,
  created_at: '2026-08-22T00:00:00Z',
  updated_at: '2026-08-22T00:00:00Z',
}

// ─── El test más importante: el PATCH no puede desclasificar por accidente ─── //

describe('toManagedDatabaseUpdate', () => {
  const values: ManagedDatabaseFormValues = {
    name: 'appdb',
    server_id: 1,
    owner_id: 2,
    model_id: 3,
    initialState: 'vacia',
    targetVersion: '',
    environment_id: 4,
    charsetCollation: undefined,
    notes: 'nota nueva',
  }

  it('editar SOLO las notas no manda environment_id (no desclasifica)', () => {
    // Este es el test que sostiene la feature. Con el mapeo anterior —que mandaba siempre todas
    // las claves— editar una nota en una base de `production` le quitaba el entorno, y una base
    // sin entorno PASA el guard de migraciones destructivas. Con toast de éxito.
    const body = toManagedDatabaseUpdate(values, { notes: true })
    expect(body).toEqual({ notes: 'nota nueva' })
    expect('environment_id' in body).toBe(false)
  })

  it('reclasificar explícitamente sí manda environment_id', () => {
    const body = toManagedDatabaseUpdate(values, { environment_id: true })
    expect(body).toEqual({ environment_id: 4 })
  })

  it('desclasificar explícitamente manda null', () => {
    const body = toManagedDatabaseUpdate({ ...values, environment_id: null }, {
      environment_id: true,
    })
    expect(body).toEqual({ environment_id: null })
  })

  it('sin nada tocado, el body va vacío', () => {
    expect(toManagedDatabaseUpdate(values, {})).toEqual({})
  })

  it('el PATCH sigue construyéndose por presencia de la clave', () => {
    const body = toManagedDatabaseUpdate(values, { notes: true })
    expect(body).toEqual({ notes: 'nota nueva' })
    expect(managedDatabaseUpdateSchema.safeParse(body).success).toBe(true)
  })
})

// ─── El alta ya no declara la versión: la ejecuta ──────────────────────────── //

describe('toManagedDatabaseCreate — estado inicial', () => {
  const base = {
    name: 'appdb',
    server_id: 1,
    owner_id: 2,
    model_id: 3,
    initialState: 'vacia' as const,
    targetVersion: '',
    environment_id: 4,
    charsetCollation: undefined,
    notes: '',
  }

  it('nunca manda model_version', () => {
    // Era el agujero: se escribía en el inventario sin tocar el motor, la base quedaba vacía
    // declarando estar migrada, y esa caché decide si una versión del blueprint es borrable.
    // El backend ahora lo rechaza con 422; el formulario no debe llegar a mandarlo.
    expect('model_version' in toManagedDatabaseCreate(base)).toBe(false)
  })

  it('«vacía» no pide migrar', () => {
    const body = toManagedDatabaseCreate(base)
    expect(body.apply_migrations).toBe(false)
    expect(body.target_version).toBeNull()
  })

  it('«última» pide migrar sin versión objetivo', () => {
    const body = toManagedDatabaseCreate({ ...base, initialState: 'ultima' })
    expect(body.apply_migrations).toBe(true)
    expect(body.target_version).toBeNull()
  })

  it('«hasta una versión» manda la versión', () => {
    const body = toManagedDatabaseCreate({
      ...base,
      initialState: 'version',
      targetVersion: '0007',
    })
    expect(body.apply_migrations).toBe(true)
    expect(body.target_version).toBe('0007')
  })

  it('sin blueprint no pide migrar, aunque el radio haya quedado en otra opción', () => {
    // El bloque se oculta al deseleccionar el blueprint, pero el valor del form sobrevive.
    // Mandarlo daría un 422 del backend por un estado que el operador ya no ve.
    const body = toManagedDatabaseCreate({
      ...base,
      model_id: null,
      initialState: 'ultima',
    })
    expect(body.apply_migrations).toBe(false)
  })
})

// ─── Nulabilidad: el defecto que descartaba respuestas enteras ─────────────── //

describe('applyAllItemSchema', () => {
  const okItem = {
    managed_database_id: 7,
    database_name: 'appdb',
    server_id: 1,
    ok: true,
    error_code: null,
    environment_slug: null,
  }

  it('acepta error_code y environment_slug en null (el caso de TODOS los ítems OK)', () => {
    // Con `.optional()` en vez de `.nullish()` esto fallaba, y como el `safeParse` es del
    // envelope completo, se descartaba la respuesta de CADA apply-all.
    expect(applyAllItemSchema.safeParse(okItem).success).toBe(true)
  })

  it('acepta database_name y server_id en null sin descartar el ítem', () => {
    const parsed = applyAllItemSchema.safeParse({
      ...okItem,
      database_name: null,
      server_id: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('un lote con un ítem sin nombre sigue parseando completo', () => {
    // El modo de fallo real: 1 ítem raro no puede costar el resultado de las otras 49.
    const parsed = applyAllResultSchema.safeParse({
      model_id: 1,
      total_databases: 2,
      processed: 2,
      results: [okItem, { ...okItem, managed_database_id: 8, database_name: null, ok: false }],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.results).toHaveLength(2)
    // Y `matched_databases` cae al default en vez de romper contra un backend que no lo manda.
    expect(parsed.success && parsed.data.matched_databases).toBe(0)
  })
})

describe('environmentOutSchema', () => {
  it('un color desconocido degrada a null en vez de tumbar el catálogo', () => {
    // Con un `z.enum` duro esto rechazaba la respuesta ENTERA: desaparecían todos los badges y
    // el filtro quedaba vacío. El color es decoración; el nombre y la política no.
    const parsed = environmentOutSchema.safeParse({ ...ENV_BASE, color: 'chartreuse' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.color).toBeNull()
    expect(parsed.success && parsed.data.blocks_destructive_migrations).toBe(true)
  })

  it('acepta color en null (el PATCH del backend permite limpiarlo)', () => {
    expect(environmentOutSchema.safeParse({ ...ENV_BASE, color: null }).success).toBe(true)
  })
})

// ─── Los cuatro estados del badge no se colapsan ───────────────────────────── //

describe('resolveEnvironmentState', () => {
  const env = environmentOutSchema.parse(ENV_BASE)
  const loaded = { byId: new Map([[env.id, env]]), isPending: false, isError: false }

  it('sin entorno es una afirmación explícita, no un vacío', () => {
    expect(resolveEnvironmentState(null, loaded)).toEqual({ kind: 'unassigned' })
  })

  it('resuelve el entorno con su política', () => {
    expect(resolveEnvironmentState(4, loaded)).toEqual({
      kind: 'assigned',
      name: 'Producción',
      color: 'error',
      blocksDestructive: true,
    })
  })

  it('mientras carga NO muestra el id', () => {
    const pending = { byId: new Map(), isPending: true, isError: false }
    expect(resolveEnvironmentState(4, pending)).toEqual({ kind: 'loading' })
  })

  it('distingue catálogo caído de id desconocido', () => {
    const failed = { byId: new Map(), isPending: false, isError: true }
    expect(resolveEnvironmentState(4, failed)).toMatchObject({ reason: 'error' })
    expect(resolveEnvironmentState(99, loaded)).toMatchObject({ reason: 'unknown' })
  })
})

// ─── Clasificación por código, nunca por prosa ─────────────────────────────── //

describe('classifyItem', () => {
  it('bloqueada por política no es un error', () => {
    expect(classifyItem({ ok: false, error_code: 'environment.destructive_blocked' })).toBe(
      'blocked',
    )
  })

  it('un ok:false SIN código cae en failed, nunca en blocked', () => {
    // Dirección del fallback: ante la duda, la lectura MÁS grave. Decir "no se intentó" sobre
    // algo que sí se intentó sería peor que lo contrario.
    expect(classifyItem({ ok: false, error_code: null })).toBe('failed')
    expect(classifyItem({ ok: false })).toBe('failed')
    expect(classifyItem({ ok: false, error_code: 'algo.nuevo' })).toBe('failed')
  })

  it('ok es ok', () => {
    expect(classifyItem({ ok: true, error_code: null })).toBe('ok')
  })
})

describe('environmentMessage', () => {
  it('traduce los códigos del módulo', () => {
    expect(environmentMessage('environment.has_databases')).toContain('bases de datos asignadas')
  })

  it('un código desconocido cae en null en vez de romper', () => {
    expect(environmentMessage('environment.inventado')).toBeNull()
    expect(environmentMessage(null)).toBeNull()
    expect(environmentMessage(undefined)).toBeNull()
  })
})

describe('describeItemRejection', () => {
  it('dice que NO se intentó, que es la distinción que importa', () => {
    const text = describeItemRejection({
      environment_slug: 'production',
      blocked_by: ['0007', '0009'],
    })
    expect(text).toContain('No se intentó')
    expect(text).toContain('production')
    expect(text).toContain('0007, 0009')
  })
})

describe('databaseLabel', () => {
  it('cae al id cuando el nombre viene null: una fila sin nombre es inaccionable', () => {
    expect(databaseLabel({ managed_database_id: 7, database_name: null })).toBe('#7')
    expect(databaseLabel({ managed_database_id: 7 })).toBe('#7')
    expect(databaseLabel({ managed_database_id: 7, database_name: 'appdb' })).toBe('appdb')
  })
})
