import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { createTestQueryClient, renderWithProviders } from '@/test/utils'
import type { ModelMigrationSummary } from '@/lib/contracts'
import { VersionFactsCard } from './VersionFactsCard'

const DETAIL_URL = 'http://localhost/api/v1/database-models/3/migrations/0007'
const DATABASES_URL = 'http://localhost/api/v1/database-models/3/databases'
/** `updated_at` 2026-08-20 formateado, con o sin datos de locale `es` en el ICU de Node. */
const EDITED_AT = /(20 ago|Aug 20),? 2026/

function summary(overrides: Partial<ModelMigrationSummary> = {}): ModelMigrationSummary {
  return {
    id: 7,
    model_id: 3,
    version: '0007',
    name: 'Añade índices',
    has_mysql_override: false,
    has_postgresql_override: false,
    has_rollback: true,
    capture_selects: false,
    is_latest: false,
    sql_frozen: false,
    deletable: true,
    delete_requires_stamps: false,
    block_reason: null,
    sql_diverged: false,
    has_seed: false,
    forced_collations: [],
    destructive: false,
    checksum: 'abcdef0123456789',
    created_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    model_id: 3,
    version: '0007',
    name: 'Añade índices',
    up_sql: 'CREATE INDEX idx_orders ON orders (id)',
    up_sql_mysql: null,
    up_sql_postgresql: null,
    down_sql: 'DROP INDEX idx_orders ON orders;',
    down_sql_suggested: null,
    translated: { mysql: 'CREATE INDEX idx_orders ON orders (id)' },
    checksum: 'abcdef0123456789',
    reviewed: true,
    capture_selects: false,
    sql_frozen: false,
    deletable: true,
    block_reason: null,
    has_seed: false,
    forced_collations: [],
    destructive: false,
    sql_diverged: false,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

function database(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'app_prod',
    server_id: 1,
    owner_id: 1,
    model_id: 3,
    model_version: '0006',
    environment_id: null,
    status: 'active',
    pending_count: 1,
    pending_versions: ['0007'],
    has_partial_application: false,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

interface MountOptions {
  summaryOverrides?: Partial<ModelMigrationSummary>
  detailOverrides?: Record<string, unknown>
  databases?: Record<string, unknown>[]
  detailStatus?: number
  latestVersion?: string | null
  onRequestDelete?: (version: string) => void
}

function mount({
  summaryOverrides = {},
  detailOverrides = {},
  databases = [database()],
  detailStatus,
  latestVersion = '0007',
  onRequestDelete = vi.fn(),
}: MountOptions = {}) {
  server.use(
    http.get(DETAIL_URL, () =>
      detailStatus
        ? HttpResponse.json({ detail: { message: 'No existe' } }, { status: detailStatus })
        : HttpResponse.json({ data: detail(detailOverrides) }),
    ),
    http.get(DATABASES_URL, () => HttpResponse.json({ data: databases })),
    http.get('http://localhost/api/v1/environments', () => HttpResponse.json({ data: [] })),
  )
  renderWithProviders(
    <VersionFactsCard
      modelId={3}
      summary={summary(summaryOverrides)}
      blueprintCurrentVersion="0007"
      blueprintCollation="utf8mb4_general_ci"
      latestVersion={latestVersion}
      onRequestDelete={onRequestDelete}
    />,
  )
}

describe('VersionFactsCard', () => {
  it('pinta identidad e insignias sin esperar al detalle', () => {
    // Casi todo sale del resumen que ya está en memoria: al cambiar de versión la ficha no espera
    // ninguna petición para decir qué versión es y en qué estado está.
    mount({ summaryOverrides: { destructive: true, has_rollback: false } })
    expect(screen.getByText('0007')).toBeInTheDocument()
    expect(screen.getByText('Añade índices')).toBeInTheDocument()
    expect(screen.getByText('destructiva')).toBeInTheDocument()
    expect(screen.getByText('sin rollback')).toBeInTheDocument()
    // Y el checksum, que también viene en el resumen.
    expect(screen.getByTitle('abcdef0123456789')).toBeInTheDocument()
  })

  it('marca cuando la versión es la vigente del blueprint', () => {
    mount()
    expect(screen.getByText('versión actual del blueprint')).toBeInTheDocument()
  })

  it('la fila «editada» EXISTE mientras carga: la ausencia no puede codificar un hecho', async () => {
    // Si la fila solo se pintara cuando `updated_at !== created_at`, mientras carga el operador
    // leería «no se editó nunca» — justo lo contrario de lo que hay que decir si hay una insignia
    // «SQL editado tras aplicarse» al lado.
    mount()
    expect(screen.getByText('Editada:')).toBeInTheDocument()
    expect(await screen.findByText('sin ediciones')).toBeInTheDocument()
  })

  it('muestra quién creó la versión, leído del resumen sin esperar al detalle', () => {
    mount({
      summaryOverrides: {
        created_by_admin_id: 4,
        created_by_username: 'ocarrasco',
        created_by_actor_type: 'admin',
      },
    })
    expect(screen.getByText('Creada por:')).toBeInTheDocument()
    expect(screen.getByText('ocarrasco')).toBeInTheDocument()
    // A un admin humano no se le añade la pista de tipo.
    expect(screen.queryByText(/token de agente/)).not.toBeInTheDocument()
  })

  it('si la creó un token de agente, lo dice junto al nombre', () => {
    mount({
      summaryOverrides: {
        created_by_admin_id: 9,
        created_by_username: 'ci-bot',
        created_by_actor_type: 'api_token',
      },
    })
    expect(screen.getByText('ci-bot')).toBeInTheDocument()
    expect(screen.getByText(/token de agente/)).toBeInTheDocument()
  })

  it('con el autor en null dice «desconocido» como texto visible, no en un `title`', () => {
    mount({
      summaryOverrides: {
        created_by_admin_id: null,
        created_by_username: null,
        created_by_actor_type: null,
      },
    })
    expect(screen.getByText('Creada por:')).toBeInTheDocument()
    expect(screen.getByText('desconocido')).toBeInTheDocument()
  })

  it('sin los campos de autor (backend anterior) también dice «desconocido»', () => {
    // El `summary()` base no trae los campos: es lo que manda un gateway sin actualizar.
    mount()
    expect(screen.getByText('desconocido')).toBeInTheDocument()
  })

  it('muestra la fecha de edición cuando de verdad se editó', async () => {
    mount({ detailOverrides: { updated_at: '2026-08-20T12:30:00Z' } })
    expect(await screen.findByText(EDITED_AT)).toBeInTheDocument()
  })

  it('sin el conteo del backend cuenta PENDIENTES, y nunca deriva un «aplicada en N»', async () => {
    mount({
      databases: [
        database({ id: 1, pending_versions: ['0007'] }),
        database({ id: 2, pending_versions: [] }),
      ],
    })
    expect(await screen.findByText(/pendiente en 1 de 2/)).toBeInTheDocument()
    expect(screen.queryByText(/aplicada en/)).not.toBeInTheDocument()
  })

  it('con `applied_database_count` dice «aplicada en N de M», leído tal cual del backend', async () => {
    mount({
      summaryOverrides: { applied_database_count: 1 },
      databases: [
        database({ id: 1, pending_versions: ['0007'] }),
        database({ id: 2, pending_versions: [], model_version: '0007' }),
      ],
    })
    expect(await screen.findByText(/aplicada en 1 de 2/)).toBeInTheDocument()
    expect(screen.queryByText(/pendiente en/)).not.toBeInTheDocument()
  })

  it('sin `applied_database_count` (backend anterior) conserva el «pendiente en N de M»', async () => {
    // Ausente no es cero: un «aplicada en 0» inventado diría que no se aplicó en ninguna.
    mount({ databases: [database({ id: 1, pending_versions: ['0007'] })] })
    expect(await screen.findByText(/pendiente en 1 de 1/)).toBeInTheDocument()
    expect(screen.queryByText(/aplicada en/)).not.toBeInTheDocument()
  })

  it('dice que es la copia local del gateway, no una lectura del motor', async () => {
    mount()
    expect(await screen.findByText(/sin haber ejecutado este SQL/)).toBeInTheDocument()
  })

  it('si la adopción falla NO pinta ningún número', async () => {
    // Un contador a cero por un 502 se lee como «ya está en todas partes»: es la peor mentira
    // posible en esta pantalla.
    server.use(
      http.get(DATABASES_URL, () => HttpResponse.json({ detail: {} }, { status: 502 })),
      http.get(DETAIL_URL, () => HttpResponse.json({ data: detail() })),
      http.get('http://localhost/api/v1/environments', () => HttpResponse.json({ data: [] })),
    )
    renderWithProviders(
      <VersionFactsCard
        modelId={3}
        summary={summary()}
        latestVersion="0007"
        onRequestDelete={vi.fn()}
      />,
    )
    expect(await screen.findByText(/No se pudo leer el estado en las BDs/)).toBeInTheDocument()
    expect(screen.queryByText(/pendiente en/)).not.toBeInTheDocument()
  })

  it('sin BDs activas no inventa un «0 de 0»', async () => {
    mount({ databases: [database({ status: 'pending' })] })
    expect(
      await screen.findByText(/Ninguna BD activa usa este blueprint todavía/),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 BD\(s\) quedan fuera del conteo/)).toBeInTheDocument()
  })

  it('el aviso de SQL editado va como banda, no escondido en un `title`', () => {
    // `Badge` pone el `title` en un `<span>` no interactivo: no es nombre accesible y en táctil no
    // existe. Un aviso con consecuencia no puede vivir ahí.
    mount({ summaryOverrides: { sql_diverged: true } })
    expect(
      screen.getByText('El SQL se editó después de que alguna base lo aplicara'),
    ).toBeInTheDocument()
  })

  it('avisa cuando el COLLATE forzado difiere del del blueprint', () => {
    mount({ summaryOverrides: { forced_collations: ['utf8mb4_bin'] } })
    expect(
      screen.getByText('Esta versión fuerza un COLLATE distinto al del blueprint'),
    ).toBeInTheDocument()
  })

  it('no avisa cuando el COLLATE forzado coincide con el del blueprint', () => {
    mount({ summaryOverrides: { forced_collations: ['UTF8MB4_GENERAL_CI'] } })
    expect(
      screen.queryByText('Esta versión fuerza un COLLATE distinto al del blueprint'),
    ).not.toBeInTheDocument()
  })

  it('deshabilita eliminar según `deletable` y explica el motivo VISIBLE', async () => {
    mount({ summaryOverrides: { deletable: false, block_reason: 'partial' } })
    expect(await screen.findByRole('button', { name: 'Eliminar la versión 0007' })).toBeDisabled()
    // Antes el motivo era el `title` de un `<span>` envolviendo el botón: no llegaba por teclado
    // ni en táctil, y es la única forma de saber cuál de las tres reglas se incumplió.
    // El texto va COMPLETO y no como fragmento: «aplicación parcial sin resolver» aparece también
    // en la insignia de la fila de adopción, y un match parcial encuentra las dos.
    expect(
      screen.getByText(
        'Tiene una aplicación parcial sin resolver: reconciliá esa BD o completá el apply antes de eliminarla.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('aplicación parcial sin resolver')).toBeInTheDocument()
  })

  it('`in_use` explica que la base está EXACTAMENTE en esta versión', async () => {
    // El motivo de v18, y el único vigente para el borrado: el criterio es `==`, no `>=`. Una BD
    // más adelante ya no bloquea nada — el borrado le mueve el puntero.
    mount({ summaryOverrides: { deletable: false, block_reason: 'in_use', sql_frozen: true } })
    expect(await screen.findByRole('button', { name: 'Eliminar la versión 0007' })).toBeDisabled()
    expect(
      screen.getByText(
        'Alguna base de datos está exactamente en esta versión. Movela con un apply o un rollback antes de eliminarla.',
      ),
    ).toBeInTheDocument()
    // Y la insignia, que comparte con el legado `applied` porque describen el mismo hecho.
    expect(screen.getByText('vigente en alguna BD')).toBeInTheDocument()
  })

  it('`delete_requires_stamps` marca el borrado con 🔌 y avisa de la escritura en el motor', async () => {
    mount({ summaryOverrides: { delete_requires_stamps: true } })
    // La pista sale de la caché del inventario y sirve para avisar ANTES de pulsar; el veredicto
    // autoritativo lo da el `delete-plan`, que abre conexión a cada base.
    expect(
      await screen.findByRole('button', { name: 'Eliminar la versión 0007 🔌' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Eliminarla implicaría escribir en el motor de alguna BD/),
    ).toBeInTheDocument()
  })

  it('con el borrado bloqueado, el motivo manda sobre el aviso de escritura', () => {
    // Los dos ocupan el mismo hueco: avisar de una escritura que no va a llegar a ocurrir solo
    // taparía la razón por la que no se puede borrar.
    mount({
      summaryOverrides: {
        deletable: false,
        block_reason: 'in_use',
        delete_requires_stamps: true,
      },
    })
    expect(screen.getByText(/está exactamente en esta versión/)).toBeInTheDocument()
    expect(
      screen.queryByText(/Eliminarla implicaría escribir en el motor de alguna BD/),
    ).not.toBeInTheDocument()
  })

  it('LEGADO `not_tip`: sin saber cuál es la punta, la pista no nombra ninguna versión', () => {
    // Desde v18 se puede eliminar cualquier versión, punta o intermedia: `not_tip` YA NO describe
    // una regla vigente. Se conserva porque es lo que un gateway sin actualizar sigue diciendo, y
    // traducirlo a la regla nueva le pondría en la boca algo que no dijo.
    // Catálogo recortado por el tope de página: `latestVersion` llega `null`.
    mount({
      summaryOverrides: { deletable: false, block_reason: 'not_tip' },
      latestVersion: null,
    })
    expect(screen.getByText('Solo se puede eliminar la última versión.')).toBeInTheDocument()
  })

  it('el borrado lleva el número de versión en el texto', async () => {
    const onRequestDelete = vi.fn()
    mount({ onRequestDelete })
    const button = await screen.findByRole('button', { name: 'Eliminar la versión 0007' })
    button.click()
    expect(onRequestDelete).toHaveBeenCalledWith('0007')
  })

  it('si el detalle 404ea, lo dice y CIERRA las acciones de la versión', async () => {
    // Las insignias pueden vivir del resumen; las mutaciones no. La versión pudo borrarse en otra
    // pestaña y el listado tarda un round-trip en enterarse.
    mount({ detailStatus: 404, summaryOverrides: { reviewed: false } })
    expect(await screen.findByText('Esta versión ya no existe en el servidor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar la versión 0007' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Revisar y aprobar' })).toBeDisabled()
  })

  it('un baseline sin revisar ofrece aprobarlo, con la consecuencia del 409', async () => {
    mount({
      summaryOverrides: { reviewed: false },
      detailOverrides: { reviewed: false },
    })
    expect(await screen.findByText('Este baseline todavía no se revisó')).toBeInTheDocument()
    expect(screen.getByText(/el backend responde 409/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revisar y aprobar' })).toBeEnabled()
  })

  it('una versión con captura enlaza a los resultados de cada BD', async () => {
    mount({
      summaryOverrides: { capture_selects: true },
      detailOverrides: { capture_selects: true },
    })
    const link = await screen.findByRole('link', { name: /app_prod/ })
    expect(link).toHaveAttribute('href', '/managed-databases/1/migrations/0007/select-results')
  })

  it('con el detalle de la versión ANTERIOR a la vista, cierra las mutaciones y no pinta sus datos', async () => {
    // `keepPreviousData` sostiene el detalle de 0007 mientras llega el de 0008. Ese detalle no
    // describe esta ficha: su `updated_at` y su tamaño serían de otra versión, y `isSuccess`
    // seguiría en `true` habilitando acciones sobre una versión de la que todavía no se sabe nada.
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json({ data: detail({ updated_at: '2026-08-20T12:30:00Z' }) }),
      ),
      http.get('http://localhost/api/v1/database-models/3/migrations/0008', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: detail({ version: '0008' }) })
      }),
      http.get(DATABASES_URL, () => HttpResponse.json({ data: [database()] })),
      http.get('http://localhost/api/v1/environments', () => HttpResponse.json({ data: [] })),
    )
    // `queryClient` explícito: sin él, el `rerender` crearía otro y perdería la caché.
    const queryClient = createTestQueryClient()
    const view = renderWithProviders(
      <VersionFactsCard
        modelId={3}
        summary={summary({ reviewed: false })}
        latestVersion="0008"
        onRequestDelete={vi.fn()}
      />,
      { queryClient },
    )
    // El formato depende del ICU de Node: sin datos de `es` sale «Aug 20, 2026».
    expect(await screen.findByText(EDITED_AT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar la versión 0007' })).toBeEnabled()

    view.rerender(
      <VersionFactsCard
        modelId={3}
        summary={summary({ id: 8, version: '0008', reviewed: false })}
        latestVersion="0008"
        onRequestDelete={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Eliminar la versión 0008' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Revisar y aprobar' })).toBeDisabled()
    expect(screen.queryByText(EDITED_AT)).not.toBeInTheDocument()
  })

  it('una versión sin captura no ofrece resultados capturados', async () => {
    mount()
    await screen.findByText(/pendiente en/)
    expect(screen.queryByText(/Resultados capturados/)).not.toBeInTheDocument()
  })
})
