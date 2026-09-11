import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'
import { server } from '@/test/server'
import { fetchData, fetchText, mutateData } from './client'
import { CSRF_HEADER } from './csrf'

/**
 * El header CSRF es el cambio de v23 §7.1 que **rompe el 100% de las escrituras** si se implementa
 * mal, y su alcance no es «todo método no seguro» sino «todo método no seguro CON SESIÓN». Estas
 * pruebas fijan las cuatro esquinas de esa regla, porque cada una falla de una forma distinta y
 * ninguna es evidente leyendo el código del cliente.
 */

const schema = z.object({ ok: z.boolean() })
const TOKEN = 'token-de-la-sesion'

/** Captura el header CSRF que llegó en la última petición. */
let received: string | null = null

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  }
}

beforeEach(() => {
  received = null
  document.cookie = `gw_csrf=${TOKEN}; path=/`
  server.use(
    http.post('http://localhost/api/v1/cualquier-cosa', ({ request }) => {
      received = request.headers.get(CSRF_HEADER)
      return HttpResponse.json({ data: { ok: true } })
    }),
    http.get('http://localhost/api/v1/cualquier-cosa', ({ request }) => {
      received = request.headers.get(CSRF_HEADER)
      return HttpResponse.json({ data: { ok: true } })
    }),
    http.get('http://localhost/api/v1/texto', ({ request }) => {
      received = request.headers.get(CSRF_HEADER)
      return HttpResponse.text('contenido')
    }),
  )
})

afterEach(clearCookies)

describe('CSRF en el cliente API', () => {
  it('manda el token en un método NO seguro', async () => {
    await mutateData('POST', '/cualquier-cosa', schema, { body: {} })
    expect(received).toBe(TOKEN)
  })

  it('NO lo manda en un GET normal', async () => {
    await fetchData('/cualquier-cosa', schema)
    expect(received).toBeNull()
  })

  it('lo OMITE cuando el llamador lo pide (los dos POST públicos)', async () => {
    // `/auth/login` y `/gateway-users/invite/accept` se hacen SIN sesión: el token se deriva del
    // identificador de sesión, así que ahí no existe y no podría existir.
    await mutateData('POST', '/cualquier-cosa', schema, { body: {}, csrf: false })
    expect(received).toBeNull()
  })

  it('lo FUERZA en un GET cuando el llamador lo pide (`/content`)', async () => {
    // Ese GET consume el artefacto y una navegación lleva la cookie sola: sin el header, un `<img>`
    // ajeno destruía la exportación.
    await fetchText('/texto', { csrf: true })
    expect(received).toBe(TOKEN)
  })

  it('manda el request IGUAL cuando la cookie no existe, en vez de bloquearlo', async () => {
    // Bloquear localmente dejaría a nadie poder iniciar sesión: en la pantalla de login la cookie
    // todavía no existe. El cliente no es la autoridad de autorización.
    clearCookies()
    await expect(mutateData('POST', '/cualquier-cosa', schema, { body: {} })).resolves.toEqual({
      ok: true,
    })
    expect(received).toBeNull()
  })

  it('relee la cookie en cada request, así que una rotación de sesión se refleja sola', async () => {
    await mutateData('POST', '/cualquier-cosa', schema, { body: {} })
    expect(received).toBe(TOKEN)

    // Un nuevo login rota el identificador de sesión y con él el token. Sin relectura, el cliente
    // seguiría mandando el viejo y comería `auth.csrf_invalid` para siempre.
    document.cookie = 'gw_csrf=token-rotado; path=/'
    await mutateData('POST', '/cualquier-cosa', schema, { body: {} })
    expect(received).toBe('token-rotado')
  })
})
