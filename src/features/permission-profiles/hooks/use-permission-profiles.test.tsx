import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/server'
import { AllProviders, createTestQueryClient } from '@/test/utils'
import { useCreatePermissionProfile, usePermissionProfiles } from './use-permission-profiles'

function wrapper({ children }: { children: ReactNode }) {
  return <AllProviders queryClient={createTestQueryClient()}>{children}</AllProviders>
}

const profileFixture = {
  id: 3,
  name: 'app-readwrite',
  engine: 'mysql',
  description: null,
  is_active: true,
  items: [
    { level: 'database', privileges: ['SELECT', 'INSERT'], requires_confirmation: false },
  ],
  created_at: '2026-06-23T10:00:00Z',
  updated_at: '2026-06-23T10:00:00Z',
}

describe('usePermissionProfiles', () => {
  it('mapea la lista NO paginada de perfiles', async () => {
    server.use(
      http.get('http://localhost/api/v1/permission-profiles', () =>
        HttpResponse.json({ data: [profileFixture] }),
      ),
    )

    const { result } = renderHook(() => usePermissionProfiles({}), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0]?.items[0]?.requires_confirmation).toBe(false)
  })
})

describe('useCreatePermissionProfile', () => {
  it('crea un perfil de permisos', async () => {
    server.use(
      http.post('http://localhost/api/v1/permission-profiles', () =>
        HttpResponse.json({ data: profileFixture, message: 'Perfil de permisos creado.' }),
      ),
    )

    const { result } = renderHook(() => useCreatePermissionProfile(), { wrapper })

    act(() => {
      result.current.mutate({
        name: 'app-readwrite',
        engine: 'mysql',
        items: [{ level: 'database', privileges: ['SELECT', 'INSERT'] }],
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.name).toBe('app-readwrite')
  })
})
