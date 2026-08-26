import { describe, expect, it } from 'vitest'
import { COLLATION_ERROR_CODES, classifyBatchItem, collationMessage } from './messages'

/**
 * Tests del vocabulario cerrado del módulo de collation (contrato v17 §5).
 *
 * Lo que se cubre es lo que puede degradar en silencio: la DIRECCIÓN del fallback al clasificar
 * un ítem, y que el mapa de mensajes no tenga huecos. Un código sin texto no rompe nada visible
 * —cae al mensaje del backend— pero pierde el copy revisado, y eso no se nota mirando la pantalla.
 */

describe('collationMessage', () => {
  it('traduce todos los códigos del vocabulario cerrado', () => {
    // Si el backend agrega un código y no se suma acá, el operador ve el mensaje crudo. Este test
    // convierte ese olvido en un rojo.
    for (const code of COLLATION_ERROR_CODES) {
      expect(collationMessage(code), `falta el texto de ${code}`).toBeTruthy()
    }
  })

  it('devuelve null para un código de otro módulo', () => {
    expect(collationMessage('environment.destructive_blocked')).toBeNull()
  })

  it('devuelve null cuando no viene ningún código', () => {
    expect(collationMessage(null)).toBeNull()
    expect(collationMessage(undefined)).toBeNull()
    expect(collationMessage('')).toBeNull()
  })
})

describe('classifyBatchItem', () => {
  it('un ítem ok es ok, sin mirar el código', () => {
    expect(classifyBatchItem({ ok: true, error_code: null })).toBe('ok')
  })

  it('engine_not_applicable NO es un error: es el sistema funcionando', () => {
    // Una base PostgreSQL dentro de un lote con target_charset no está rota — el objetivo no le
    // aplica. Pintarla de rojo junto a las que sí fallaron obliga a leer N frases para saber
    // cuáles necesitan acción.
    expect(
      classifyBatchItem({ ok: false, error_code: 'collation.engine_not_applicable' }),
    ).toBe('not_applicable')
  })

  it('DIRECCIÓN DEL FALLBACK: sin código cae en failed, nunca en not_applicable', () => {
    // Ante la duda, la lectura más grave. Decir "no aplicaba" sobre algo que en realidad falló
    // sería peor que lo contrario: esconde un fallo real detrás de un tono tranquilizador.
    expect(classifyBatchItem({ ok: false, error_code: null })).toBe('failed')
    expect(classifyBatchItem({ ok: false })).toBe('failed')
  })

  it('un código desconocido también cae en failed', () => {
    expect(classifyBatchItem({ ok: false, error_code: 'collation.algo_nuevo' })).toBe('failed')
  })
})
