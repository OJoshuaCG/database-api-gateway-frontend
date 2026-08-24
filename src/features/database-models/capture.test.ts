import { describe, expect, it } from 'vitest'
import { describeCaptureRejection, splitCaptureVersions } from './capture'

const v = (version: string, capture_selects?: boolean, reviewed?: boolean) => ({
  version,
  capture_selects,
  reviewed,
})

describe('splitCaptureVersions', () => {
  it('`reviewed` ausente cuenta como "va a capturar", no como bloqueada', () => {
    // ESTE es el caso que hizo divergir las dos pantallas: `reviewed` es opcional en el
    // resumen de versiones, y con el predicado estricto el aviso no aparecía NUNCA contra un
    // backend que no lo devuelve. Para un aviso, la dirección segura es informar de más.
    const { willCapture, blockedByReview } = splitCaptureVersions([v('0001', true, undefined)])
    expect(willCapture).toEqual(['0001'])
    expect(blockedByReview).toEqual([])
  })

  it('`reviewed: false` es un bloqueo, y no se anuncia como captura', () => {
    // Al revés que el anterior: afirmar el bloqueo exige que el servidor lo diga.
    const { willCapture, blockedByReview } = splitCaptureVersions([v('0002', true, false)])
    expect(willCapture).toEqual([])
    expect(blockedByReview).toEqual(['0002'])
  })

  it('sin `capture_selects` no entra en ningún cubo', () => {
    const { willCapture, blockedByReview } = splitCaptureVersions([
      v('0003'),
      v('0004', false, false),
    ])
    expect(willCapture).toEqual([])
    expect(blockedByReview).toEqual([])
  })

  it('los dos cubos son disjuntos y cubren todas las de capture_selects', () => {
    // El invariante que impide que el borde vuelva a divergir: con un solo cubo, cada pantalla
    // elegía dónde cortar; con dos complementarios no queda ninguna versión sin clasificar.
    const items = [
      v('0001', true, true),
      v('0002', true, false),
      v('0003', true, undefined),
      v('0004', false, false),
    ]
    const { willCapture, blockedByReview } = splitCaptureVersions(items)
    expect(willCapture.filter((x) => blockedByReview.includes(x))).toEqual([])
    expect([...willCapture, ...blockedByReview].sort()).toEqual(['0001', '0002', '0003'])
  })

  it('`only` acota a las versiones pendientes de esa base', () => {
    // Sin esto el aviso salía por cualquier versión del blueprint aunque la BD ya la tuviera
    // aplicada, y un aviso que sale siempre deja de leerse.
    const items = [v('0001', true, true), v('0009', true, true)]
    expect(splitCaptureVersions(items, { only: ['0009'] }).willCapture).toEqual(['0009'])
    expect(splitCaptureVersions(items, { only: [] }).willCapture).toEqual([])
  })

  it('sin `only` no filtra nada (undefined no es "conjunto vacío")', () => {
    const items = [v('0001', true, true)]
    expect(splitCaptureVersions(items).willCapture).toEqual(['0001'])
    expect(splitCaptureVersions(items, {}).willCapture).toEqual(['0001'])
  })
})

describe('describeCaptureRejection', () => {
  it('lo primero que dice es que no se ejecutó nada', () => {
    // En un apply masivo un ítem en rojo se lee como "rompió algo": la carga útil es que el
    // motor no se tocó. Mismo criterio que `describeItemRejection` para el rechazo por entorno.
    const texto = describeCaptureRejection(['0007'])
    expect(texto).toContain('No se intentó')
    expect(texto).toContain('0007')
  })

  it('sin versiones sigue siendo legible', () => {
    expect(describeCaptureRejection([])).toContain('No se intentó')
  })
})
