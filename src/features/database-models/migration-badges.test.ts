import { describe, expect, it } from 'vitest'
import {
  describeMigrationBadges,
  migrationBadgeSpecs,
  migrationBadgeText,
  type MigrationBadgeFacts,
} from './migration-badges'

const keysOf = (facts: MigrationBadgeFacts) => migrationBadgeSpecs(facts).map((spec) => spec.key)

describe('migrationBadgeSpecs', () => {
  it('pinta el NEGATIVO de rollback: la ausencia de la insignia verde no es un aviso', () => {
    // Es el motivo por el que este módulo existe. Un rollback que atraviese una versión sin
    // `down_sql` falla con 409 para TODO el camino, y hasta ahora eso solo se veía en la tabla que
    // se eliminó — el desplegable pintaba `↩` cuando SÍ había y nada cuando no.
    expect(keysOf({ has_rollback: false })).toContain('no-rollback')
    expect(keysOf({ has_rollback: true })).toContain('rollback')
  })

  it('incluye los cuatro que el desplegable omitía', () => {
    const keys = keysOf({
      has_non_portable: true,
      sql_frozen: true,
      sql_diverged: true,
      has_rollback: false,
    })
    expect(keys).toEqual(
      expect.arrayContaining(['non-portable', 'frozen', 'diverged', 'no-rollback']),
    )
  })

  it('captura y revisión son UN eje, no dos insignias que haya que juntar', () => {
    const conCaptura = migrationBadgeSpecs({ capture_selects: true, reviewed: false })
    expect(conCaptura.filter((s) => s.key === 'capture' || s.key === 'unreviewed')).toHaveLength(1)
    expect(conCaptura.find((s) => s.key === 'capture')?.label).toBe('captura sin revisar')

    // Sin captura, «sin revisar» es su propia insignia.
    expect(keysOf({ reviewed: false })).toContain('unreviewed')
  })

  it('`reviewed` ausente NO es «sin revisar»: el campo es opcional en el contrato', () => {
    expect(keysOf({})).not.toContain('unreviewed')
    expect(keysOf({ capture_selects: true })).toContain('capture')
    expect(migrationBadgeSpecs({ capture_selects: true })[0]?.label).toBe('captura aprobada')
  })

  it('lista los collations forzados en `full` y los abrevia en `compact`', () => {
    // El valor importa: es lo que permite compararlo con el collation del blueprint sin abrir el
    // SQL. Pero en el desplegable la fila compite con el nombre de la versión.
    const spec = migrationBadgeSpecs({ forced_collations: ['utf8mb4_bin', 'utf8mb4_general_ci'] })
    const collate = spec.find((s) => s.key === 'collate')
    expect(collate).toBeDefined()
    expect(migrationBadgeText(collate!, 'full')).toBe('collate: utf8mb4_bin, utf8mb4_general_ci')
    expect(migrationBadgeText(collate!, 'compact')).toBe('collate')
  })

  it('nombra el motor del baseline no portable cuando se conoce', () => {
    expect(migrationBadgeSpecs({ has_non_portable: true }, 'postgresql')[0]?.label).toBe(
      'no portable (postgresql)',
    )
    expect(migrationBadgeSpecs({ has_non_portable: true })[0]?.label).toBe('no portable')
  })

  it('en `compact` cae al texto completo cuando no hay abreviatura', () => {
    const destructive = migrationBadgeSpecs({ destructive: true }).find(
      (s) => s.key === 'destructive',
    )
    expect(migrationBadgeText(destructive!, 'compact')).toBe('destructiva')
  })
})

describe('describeMigrationBadges', () => {
  it('devuelve texto plano para el `aria-live`, sin emojis', () => {
    // La región live del navegador anunciaba «3 de 12» y nada más. Estos son los textos que
    // completan el anuncio; los emojis viven en el render, en `aria-hidden`.
    const described = describeMigrationBadges({
      destructive: true,
      reviewed: false,
      has_rollback: false,
    })
    expect(described).toEqual(['destructiva', 'sin revisar', 'sin rollback'])
    expect(described.join(' ')).not.toMatch(/[⚠↩🌱🔒⚑]/u)
  })
})
