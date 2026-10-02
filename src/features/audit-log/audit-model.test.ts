import { describe, expect, it } from 'vitest'
import { PAGINATION, type AuditLogEntry } from '@/lib/contracts'
import {
  auditActorLabel,
  auditQueryParams,
  auditStatus,
  auditTargetLabel,
  hasAuditFilters,
  isInvalidRange,
  localInputToUtc,
  parseAuditSearch,
  utcToLocalInput,
  writeAuditSearch,
} from './audit-model'

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    created_at: '2026-10-02T17:04:11',
    actor_type: 'admin',
    admin_id: 3,
    admin_username: 'ana',
    api_token_id: null,
    action: 'gateway_user.access_set',
    target_type: 'user',
    target_id: 9,
    touched_engine: false,
    status: 'success',
    ...overrides,
  }
}

describe('parseAuditSearch / writeAuditSearch', () => {
  it('lee los filtros de la URL con los nombres del backend', () => {
    const state = parseAuditSearch(
      new URLSearchParams(
        'action=access.*&actor_type=api_token&status=denied&request_id=abc&from=2026-10-01T03:00:00.000Z&target_type=user&target_id=9&page=3&size=50',
      ),
    )
    expect(state).toEqual({
      filters: {
        action: 'access.*',
        actor_type: 'api_token',
        status: 'denied',
        request_id: 'abc',
        from: '2026-10-01T03:00:00.000Z',
        target_type: 'user',
        target_id: 9,
      },
      page: 3,
      size: 50,
    })
  })

  it('descarta lo que el backend rechazaría con 422 en vez de mandarlo', () => {
    const state = parseAuditSearch(
      new URLSearchParams('actor_type=robot&page=abc&size=99999&server_id=-1&admin_id=x'),
    )
    expect(state).toEqual({ filters: {}, page: 1, size: PAGINATION.defaultSize })
  })

  it('no escribe los valores por omisión y conserva los parámetros ajenos', () => {
    const next = writeAuditSearch(new URLSearchParams('entrada=5&action=viejo'), {
      filters: { status: 'success' },
      page: 1,
      size: PAGINATION.defaultSize,
    })
    expect(next.toString()).toBe('entrada=5&status=success')
  })

  it('ida y vuelta: lo escrito se lee igual', () => {
    const state = {
      filters: { action: 'auth.*', admin_username: 'ana', server_id: 4 },
      page: 2,
      size: 50,
    }
    expect(parseAuditSearch(writeAuditSearch(new URLSearchParams(), state))).toEqual(state)
  })
})

describe('auditQueryParams', () => {
  it('suma page y size a los filtros, con `from`/`to` tal cual', () => {
    expect(
      auditQueryParams({
        filters: { action: 'access.*', from: '2026-10-01T00:00:00.000Z' },
        page: 2,
        size: 20,
      }),
    ).toEqual({ action: 'access.*', from: '2026-10-01T00:00:00.000Z', page: 2, size: 20 })
  })

  it('hasAuditFilters distingue «sin filtros»', () => {
    expect(hasAuditFilters({})).toBe(false)
    expect(hasAuditFilters({ status: 'success' })).toBe(true)
  })
})

describe('fechas del filtro', () => {
  it('pasa la hora local del input a UTC con Z, y de vuelta', () => {
    const utc = localInputToUtc('2026-10-02T10:30')
    expect(utc).toBe(new Date('2026-10-02T10:30').toISOString())
    expect(utc?.endsWith('Z')).toBe(true)
    expect(utcToLocalInput(utc)).toBe('2026-10-02T10:30')
  })

  it('un input vacío o inválido no es filtro', () => {
    expect(localInputToUtc('')).toBeUndefined()
    expect(localInputToUtc('no-es-fecha')).toBeUndefined()
    expect(utcToLocalInput(undefined)).toBe('')
  })

  it('isInvalidRange: desde >= hasta es el 422 audit.invalid_range', () => {
    expect(isInvalidRange({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toBe(true)
    expect(isInvalidRange({ from: '2026-10-02T00:00:00Z', to: '2026-10-02T00:00:00Z' })).toBe(true)
    expect(isInvalidRange({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' })).toBe(false)
    expect(isInvalidRange({ from: '2026-10-01T00:00:00Z' })).toBe(false)
  })
})

describe('auditActorLabel', () => {
  it('un usuario se nombra por su username', () => {
    expect(auditActorLabel(entry())).toBe('ana')
    expect(auditActorLabel(entry({ admin_username: null }))).toBe('Usuario #3')
  })

  it('un token se nombra por su PK, nunca por el bearer', () => {
    expect(
      auditActorLabel(
        entry({
          actor_type: 'api_token',
          admin_id: null,
          admin_username: 'token:tok_abc',
          api_token_id: 12,
        }),
      ),
    ).toBe('Token #12')
  })

  it('sistema y anónimo se dicen con palabras', () => {
    expect(auditActorLabel(entry({ actor_type: 'system', admin_username: null }))).toBe('Sistema')
    expect(auditActorLabel(entry({ actor_type: 'anonymous', admin_username: null }))).toBe(
      'Anónimo',
    )
  })

  it('un actor_type nuevo cae al username o al valor crudo', () => {
    expect(auditActorLabel(entry({ actor_type: 'robot', admin_username: null }))).toBe('robot')
  })
})

describe('auditTargetLabel y auditStatus', () => {
  it('nombra el destino con su tipo y su id', () => {
    expect(auditTargetLabel(entry())).toBe('Usuario #9')
    expect(auditTargetLabel(entry({ target_type: 'raro', target_id: null }))).toBe('raro')
    expect(auditTargetLabel(entry({ target_type: null }))).toBeNull()
  })

  it('un estado desconocido se muestra crudo en gris, no se descarta', () => {
    expect(auditStatus('success')).toEqual({ label: 'Éxito', tone: 'success' })
    expect(auditStatus('denied').tone).toBe('warning')
    expect(auditStatus('throttled')).toEqual({ label: 'throttled', tone: 'neutral' })
  })
})
