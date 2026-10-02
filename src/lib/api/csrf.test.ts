import { afterEach, describe, expect, it } from 'vitest'
import { readCsrfToken } from './csrf'

/**
 * Borra todas las cookies del documento entre pruebas.
 *
 * Una `__Host-` solo se puede sobrescribir —y por lo tanto borrar— con `Secure`: sin ese atributo
 * el navegador (y jsdom, que sigue la misma regla) descarta la escritura y la cookie sobrevive al
 * test siguiente.
 */
function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (!name) continue
    const secure = name.startsWith('__Host-') ? '; Secure' : ''
    document.cookie = `${name}=; Max-Age=0; path=/${secure}`
  }
}

afterEach(clearCookies)

describe('readCsrfToken', () => {
  it('devuelve null cuando no hay cookie', () => {
    expect(readCsrfToken()).toBeNull()
  })

  it('lee la cookie sin prefijo (desarrollo sobre HTTP)', () => {
    document.cookie = 'gw_csrf=abc123; path=/'
    expect(readCsrfToken()).toBe('abc123')
  })

  it('prefiere `__Host-` sobre la pelada cuando están las dos', () => {
    // El prefijo `__Host-` exige Secure, así que es la que el navegador ató al origen seguro. Sin
    // `Secure` el navegador rechaza la cookie entera: el test tiene que plantarla como la emite
    // el backend (`app/core/csrf.py::cookie_name()` con TLS), no con una forma imposible.
    document.cookie = 'gw_csrf=sin-prefijo; path=/'
    document.cookie = '__Host-gw_csrf=con-prefijo; path=/; Secure'
    expect(document.cookie).toContain('__Host-gw_csrf=con-prefijo')
    expect(readCsrfToken()).toBe('con-prefijo')
  })

  it('no confunde una cookie cuyo nombre CONTIENE al buscado', () => {
    // `otra_gw_csrf` comparte sufijo con `gw_csrf`: un `includes` ingenuo la tomaría.
    document.cookie = 'otra_gw_csrf=no-es-esta; path=/'
    expect(readCsrfToken()).toBeNull()
  })

  it('encuentra la cookie aunque no sea la primera del tarro', () => {
    document.cookie = 'tema=oscuro; path=/'
    document.cookie = 'sidebar-collapsed=true; path=/'
    document.cookie = 'gw_csrf=el-token; path=/'
    expect(readCsrfToken()).toBe('el-token')
  })

  it('ignora una cookie presente pero vacía', () => {
    // Un valor vacío no es un token: mandar el header vacío daría `auth.csrf_invalid` igual, y
    // con `null` al menos el request sale tal como salía antes de v23.
    document.cookie = 'gw_csrf=; path=/'
    expect(readCsrfToken()).toBeNull()
  })
})
