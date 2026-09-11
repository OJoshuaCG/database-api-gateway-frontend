import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'
import { server } from '@/test/server'

/**
 * `VITE_API_BASE_URL` tiene que admitir una ruta RELATIVA (`/api/v1`).
 *
 * No es un capricho de configuración: el despliegue de mismo origen la exige, porque la API se
 * sirve bajo el dominio del frontend para que el JS pueda leer la cookie de CSRF (host-only). Ver
 * `docs/dokploy.md` §3.
 *
 * Esta prueba existe porque el fallo era invisible desde el sitio equivocado. `buildUrl` hacía
 * `new URL(base + path)` sin segundo argumento, que con una base relativa lanza `TypeError`. Y
 * como `buildUrl` se llama DENTRO del `try` que envuelve al `fetch`, el throw lo capturaba el
 * `catch` de red: el usuario veía «Revisa tu conexión o la configuración de CORS» y en las
 * DevTools no había NINGUNA petición, porque nunca se llegaba a emitir. Un mensaje que culpaba a
 * la red y al backend para un error local y síncrono.
 *
 * La suite base no lo detectaba porque `.env.test` define una URL absoluta, donde el segundo
 * argumento de `new URL` es irrelevante.
 */

const schema = z.object({ ok: z.boolean() })

/** URL completa con la que se llamó al servidor en la última petición. */
let requested: string | null = null

afterEach(() => {
  requested = null
  vi.unstubAllEnvs()
  vi.resetModules()
})

/**
 * Recarga el cliente con la base indicada. Hace falta reimportar porque `BASE_URL` se lee una sola
 * vez, al evaluarse el módulo.
 */
async function loadClientWith(base: string) {
  vi.stubEnv('VITE_API_BASE_URL', base)
  vi.resetModules()
  return import('./client')
}

describe('buildUrl con la base de la API', () => {
  it('resuelve una base relativa contra el origen actual en vez de lanzar', async () => {
    server.use(
      http.get(`${location.origin}/api/v1/servers`, ({ request }) => {
        requested = request.url
        return HttpResponse.json({ data: { ok: true } })
      }),
    )

    const { fetchData } = await loadClientWith('/api/v1')
    await expect(fetchData('/servers', schema)).resolves.toEqual({ ok: true })

    expect(requested).toBe(`${location.origin}/api/v1/servers`)
  })

  it('conserva los query params con una base relativa', async () => {
    server.use(
      http.get(`${location.origin}/api/v1/servers`, ({ request }) => {
        requested = request.url
        return HttpResponse.json({ data: { ok: true } })
      }),
    )

    const { fetchData } = await loadClientWith('/api/v1')
    await fetchData('/servers', schema, { query: { page: 2, size: 50 } })

    const url = new URL(requested!)
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('size')).toBe('50')
  })

  it('sigue respetando una base absoluta hacia otro origen', async () => {
    server.use(
      http.get('https://api.ejemplo.test/api/v1/servers', ({ request }) => {
        requested = request.url
        return HttpResponse.json({ data: { ok: true } })
      }),
    )

    const { fetchData } = await loadClientWith('https://api.ejemplo.test/api/v1')
    await fetchData('/servers', schema)

    // Con una base absoluta el origen actual se ignora: el segundo argumento de `new URL` solo
    // entra en juego cuando el primero es relativo.
    expect(requested).toBe('https://api.ejemplo.test/api/v1/servers')
  })
})
