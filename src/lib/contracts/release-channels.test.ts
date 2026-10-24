import { describe, expect, it } from 'vitest'
import {
  channelPointerEventOutSchema,
  channelPromoteInSchema,
  channelResolutionOutSchema,
  RELEASE_CHANNEL_ERROR_CODES,
  releaseChannelCreateSchema,
  releaseChannelOutSchema,
  releaseChannelUpdateSchema,
} from './release-channels'

const channelRow = {
  id: 1,
  name: 'Estable',
  slug: 'stable',
  resolution_mode: 'manual',
  environment_id: 4,
  pointer_count: 2,
  created_at: '2026-10-24T10:00:00Z',
  updated_at: '2026-10-24T10:00:00Z',
}

describe('releaseChannelOutSchema', () => {
  it('lee un canal completo', () => {
    expect(releaseChannelOutSchema.parse(channelRow)).toMatchObject({
      slug: 'stable',
      environment_id: 4,
      pointer_count: 2,
    })
  })

  it('acepta environment_id null o ausente y pointer_count ausente', () => {
    const { environment_id: _environmentId, pointer_count: _pointerCount, ...bare } = channelRow
    const parsed = releaseChannelOutSchema.parse(bare)
    expect(parsed.environment_id).toBeNull()
    expect(parsed.pointer_count).toBe(0)
    expect(
      releaseChannelOutSchema.parse({ ...channelRow, environment_id: null }).environment_id,
    ).toBeNull()
  })

  it('NO rechaza un modo que esta SPA no conoce: el catálogo no puede desaparecer entero', () => {
    const parsed = releaseChannelOutSchema.parse({ ...channelRow, resolution_mode: 'pinned' })
    expect(parsed.resolution_mode).toBe('pinned')
  })
})

describe('releaseChannelCreateSchema', () => {
  const valid = {
    name: 'RC',
    slug: 'release-candidate',
    resolution_mode: 'manual',
    environment_id: null,
  }

  it('acepta un alta manual sin entorno', () => {
    expect(releaseChannelCreateSchema.safeParse(valid).success).toBe(true)
  })

  it('normaliza el slug (recorte y minúsculas) antes de validar el patrón', () => {
    const parsed = releaseChannelCreateSchema.parse({ ...valid, slug: '  Stable ' })
    expect(parsed.slug).toBe('stable')
  })

  it.each(['-stable', 'stable-', 'con espacios', 'under_score', 'a'.repeat(61)])(
    'rechaza el slug %s',
    (slug) => {
      expect(releaseChannelCreateSchema.safeParse({ ...valid, slug }).success).toBe(false)
    },
  )

  it('acepta un slug de un solo carácter', () => {
    expect(releaseChannelCreateSchema.safeParse({ ...valid, slug: 'a' }).success).toBe(true)
  })

  it('rechaza un modo fuera del vocabulario cerrado', () => {
    expect(
      releaseChannelCreateSchema.safeParse({ ...valid, resolution_mode: 'pinned' }).success,
    ).toBe(false)
  })

  it('un canal derivado exige entorno y el error cuelga del campo environment_id', () => {
    const result = releaseChannelCreateSchema.safeParse({ ...valid, resolution_mode: 'derived' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['environment_id'])
    expect(
      releaseChannelCreateSchema.safeParse({
        ...valid,
        resolution_mode: 'derived',
        environment_id: 4,
      }).success,
    ).toBe(true)
  })

  it('rechaza un nombre que es solo espacios', () => {
    expect(releaseChannelCreateSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false)
  })
})

describe('releaseChannelUpdateSchema', () => {
  it('no declara slug: es inmutable', () => {
    const parsed = releaseChannelUpdateSchema.parse({
      name: 'Estable',
      slug: 'otro',
      resolution_mode: 'latest',
      environment_id: null,
    })
    expect('slug' in parsed).toBe(false)
  })

  it('un canal derivado sin entorno no pasa', () => {
    expect(
      releaseChannelUpdateSchema.safeParse({
        name: 'Estable',
        resolution_mode: 'derived',
        environment_id: null,
      }).success,
    ).toBe(false)
  })
})

describe('RELEASE_CHANNEL_ERROR_CODES', () => {
  it('todos los códigos de canal van bajo release_channel.', () => {
    const outsideNamespace = Object.values(RELEASE_CHANNEL_ERROR_CODES).filter(
      (code) => !code.startsWith('release_channel.'),
    )
    expect(outsideNamespace).toEqual([])
  })
})

describe('channelResolutionOutSchema', () => {
  const resolved = {
    channel_slug: 'stable',
    channel_name: 'Estable',
    resolution_mode: 'manual',
    environment_slug: null,
    resolved: true,
    code: null,
    version: '0002',
    model_migration_id: 12,
    source: 'pointer',
    databases: [],
    derived_reference: null,
  }

  it('acepta los nulos explícitos de `data` y un canal sin resolver', () => {
    expect(channelResolutionOutSchema.safeParse(resolved).success).toBe(true)
    const unresolved = {
      ...resolved,
      resolved: false,
      version: null,
      model_migration_id: null,
      code: 'release_channel.no_released_version',
    }
    expect(channelResolutionOutSchema.safeParse(unresolved).success).toBe(true)
  })

  it('tolera claves omitidas y un modo o un origen que esta SPA no conoce', () => {
    const parsed = channelResolutionOutSchema.parse({
      channel_slug: 'x',
      channel_name: 'X',
      resolution_mode: 'futuro',
      resolved: false,
      source: 'otro',
    })
    expect(parsed.databases).toEqual([])
  })
})

describe('channelPromoteInSchema', () => {
  it('acepta de cuatro a diez dígitos y rechaza el resto', () => {
    expect(channelPromoteInSchema.safeParse({ version: '0007' }).success).toBe(true)
    expect(channelPromoteInSchema.safeParse({ version: '7' }).success).toBe(false)
    expect(channelPromoteInSchema.safeParse({ version: '00a7' }).success).toBe(false)
  })
})

describe('channelPointerEventOutSchema', () => {
  it('acepta un evento de movimiento automático sin versión destino', () => {
    const parsed = channelPointerEventOutSchema.safeParse({
      id: 1,
      event_type: 'version_deleted',
      from_version: '0007',
      to_version: null,
      actor_username: 'system',
      actor_type: 'system',
      created_at: '2026-10-24T10:00:00Z',
    })
    expect(parsed.success).toBe(true)
  })
})
