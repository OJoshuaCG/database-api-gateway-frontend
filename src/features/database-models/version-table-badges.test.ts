import { describe, expect, it } from 'vitest'
import type { VersionTableStatus } from '@/lib/contracts'
import {
  isBlockingVersionTable,
  isHealthyVersionTable,
  isVersionTableStatus,
  VERSION_TABLE_STATUS_ORDER,
  versionTableBadge,
  versionTableStatusRank,
} from './version-table-badges'

const TODOS: VersionTableStatus[] = ['ok', 'orphaned', 'mixed', 'none', 'unreachable']

describe('versionTableBadge', () => {
  it('`none` NO se pinta como aviso: es lo normal en una base sin posicionar', () => {
    // La trampa nº1 del enum. En ámbar, el informe grita en blueprints perfectamente sanos y deja
    // de leerse — que es perder la señal de `orphaned`, la única que de verdad bloquea.
    const badge = versionTableBadge('none')
    expect(badge.tone).toBe('neutral')
    expect(badge.label).toBe('Sin posicionar')
  })

  it('`unreachable` NO se pinta como «está bien»: es indeterminado', () => {
    // La trampa nº2. Ni error (no sabemos que esté mal) ni éxito (no sabemos que esté bien).
    const badge = versionTableBadge('unreachable')
    expect(badge.tone).toBe('neutral')
    expect(badge.tone).not.toBe('success')
    expect(badge.label).toBe('No se pudo leer')
  })

  it('`orphaned` es el caso del incidente y va en rojo; `mixed` avisa sin bloquear', () => {
    expect(versionTableBadge('orphaned').tone).toBe('error')
    expect(versionTableBadge('orphaned').label).toBe('Fuera de sitio')
    expect(versionTableBadge('mixed').tone).toBe('warning')
    expect(versionTableBadge('mixed').label).toBe('Correcta + residuo')
  })

  it('cubre los cinco estados con etiquetas distintas entre sí', () => {
    const labels = TODOS.map((status) => versionTableBadge(status).label)
    expect(new Set(labels).size).toBe(TODOS.length)
    // El `title` es la CONSECUENCIA, no la definición: si alguno se queda vacío, la columna
    // «Estado» vuelve a ser una palabra sin nada detrás.
    for (const status of TODOS) expect(versionTableBadge(status).title.length).toBeGreaterThan(20)
  })
})

describe('isVersionTableStatus', () => {
  it('reconoce las cinco claves conocidas y rechaza una desconocida', () => {
    // `summary` es un dict ABIERTO: la UI usa esto para pintar lo conocido con su vocabulario y
    // mostrar lo desconocido tal cual, en vez de descartarlo en silencio.
    for (const status of TODOS) expect(isVersionTableStatus(status)).toBe(true)
    expect(isVersionTableStatus('quarantined')).toBe(false)
    expect(isVersionTableStatus('')).toBe(false)
  })
})

describe('versionTableStatusRank', () => {
  it('ordena lo bloqueante primero y deja `ok` al final', () => {
    const ordenado = [...TODOS].sort(
      (a, b) => versionTableStatusRank(a) - versionTableStatusRank(b),
    )
    expect(ordenado).toEqual(['orphaned', 'mixed', 'unreachable', 'none', 'ok'])
  })

  it('`unreachable` va ANTES que `none` y `ok`: lo que no se sabe se mira primero', () => {
    expect(versionTableStatusRank('unreachable')).toBeLessThan(versionTableStatusRank('none'))
    expect(versionTableStatusRank('unreachable')).toBeLessThan(versionTableStatusRank('ok'))
  })

  it('el orden declarado contiene los cinco estados, sin repetidos ni ausentes', () => {
    expect([...VERSION_TABLE_STATUS_ORDER].sort()).toEqual([...TODOS].sort())
  })
})

describe('isHealthyVersionTable', () => {
  it('`unreachable` NO cuenta como sana', () => {
    // Sumarlo a las sanas convertiría «no pudimos leer 3 bases» en «3 bases están bien».
    expect(isHealthyVersionTable('unreachable')).toBe(false)
    expect(isHealthyVersionTable('ok')).toBe(true)
    expect(isHealthyVersionTable('none')).toBe(true)
    expect(isHealthyVersionTable('orphaned')).toBe(false)
    expect(isHealthyVersionTable('mixed')).toBe(false)
  })
})

describe('isBlockingVersionTable', () => {
  it('replica `needs_attention` del backend: solo `orphaned` y `mixed`', () => {
    expect(TODOS.filter(isBlockingVersionTable)).toEqual(['orphaned', 'mixed'])
    expect(isBlockingVersionTable('unreachable')).toBe(false)
  })
})
